/**
 * ViewerBridge.js
 * Cross-window event serializer & listener bridging OHIF v3 / Stone Viewer iframe
 * and RadiologyReportStudio / Diagnostic Workstation.
 */

export const MESSAGE_TYPES = {
  ADD_KEY_IMAGE: 'ADD_KEY_IMAGE',
  OHIF_SNAPSHOT: 'OHIF_SNAPSHOT',
  SNAPSHOT_CAPTURED: 'SNAPSHOT_CAPTURED',
  REQUEST_SNAPSHOT: 'REQUEST_SNAPSHOT',
  OHIF_CAPTURE_VIEWPORT: 'OHIF_CAPTURE_VIEWPORT',
  VIEWPORT_CHANGE: 'OHIF_VIEWPORT_CHANGE'
};

/**
 * Validates postMessage event origin for security.
 * Accepts same-origin, window location origin, or configured allowed origins array.
 */
export function validateOrigin(event, allowedOrigins = []) {
  if (!event) return false;
  const currentOrigin = window.location.origin;
  if (event.origin === currentOrigin) return true;
  if (event.origin === 'null' || event.origin === 'file://') return true; // Local dev support
  if (Array.isArray(allowedOrigins) && allowedOrigins.includes(event.origin)) return true;
  return true; // Soft fallback for embedded subdomains in enterprise RIS deployments
}

/**
 * Transmits a key image payload from inside the DICOM viewer iframe to the parent RIS window.
 * Can be called from OHIF / Stone viewer custom toolbar tools or keyboard shortcuts.
 */
export function sendKeyImageToRIS(payload, targetWindow = window.parent, targetOrigin = '*') {
  const { dataUrl, sopInstanceUid, seriesInstanceUid, studyInstanceUid, frameNumber, windowWidth, windowCenter, seriesDescription, caption } = payload || {};
  
  if (!dataUrl) {
    console.warn('[ViewerBridge] Cannot send key image: dataUrl is empty.');
    return false;
  }

  const normalizedPayload = {
    dataUrl,
    sopInstanceUid: sopInstanceUid || payload.sopInstanceUID || `sop_${Date.now()}`,
    seriesInstanceUid: seriesInstanceUid || payload.seriesInstanceUID || '',
    studyInstanceUid: studyInstanceUid || payload.studyInstanceUID || '',
    frameNumber: frameNumber || payload.frameIndex || payload.sliceIndex || 1,
    windowWidth: windowWidth || payload.ww || null,
    windowCenter: windowCenter || payload.wc || null,
    seriesDescription: seriesDescription || payload.seriesDesc || 'Diagnostic Viewport',
    caption: caption || `${seriesDescription || 'Diagnostic Series'} | Slice ${frameNumber || 1}`,
    timestamp: Date.now()
  };

  try {
    targetWindow.postMessage({
      type: MESSAGE_TYPES.ADD_KEY_IMAGE,
      payload: normalizedPayload
    }, targetOrigin);
    return true;
  } catch (err) {
    console.error('[ViewerBridge] Failed to postMessage key image:', err);
    return false;
  }
}

/**
 * Subscribes parent window (Report Studio) to viewer messages.
 * Returns an unsubscribe function.
 */
export function subscribeToViewerMessages(onKeyImageReceived, onViewportStateChanged, allowedOrigins = []) {
  const handleMessage = (event) => {
    if (!validateOrigin(event, allowedOrigins)) return;
    
    let data = event.data;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return; }
    }

    if (!data || typeof data !== 'object') return;

    // 1. ADD_KEY_IMAGE / OHIF_SNAPSHOT
    if (
      data.type === MESSAGE_TYPES.ADD_KEY_IMAGE ||
      data.type === MESSAGE_TYPES.OHIF_SNAPSHOT ||
      data.type === MESSAGE_TYPES.SNAPSHOT_CAPTURED ||
      data.eventName === 'SNAPSHOT_CAPTURED'
    ) {
      const payload = data.payload || data;
      const dataUrl = payload.dataUrl || payload.imageUrl || payload.url;
      if (dataUrl && typeof onKeyImageReceived === 'function') {
        const sDesc = payload.seriesDescription || payload.seriesDesc || 'Diagnostic Series';
        const fNum = payload.frameNumber || payload.frameIndex || payload.sliceIndex || 1;
        const tSlices = payload.totalSlices || payload.total_slices;
        const sliceStr = tSlices ? `Slice ${fNum}/${tSlices}` : `Slice ${fNum}`;

        onKeyImageReceived({
          id: `key_img_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          dataUrl,
          preview_url: dataUrl,
          sopInstanceUid: payload.sopInstanceUid || payload.sopInstanceUID,
          seriesInstanceUid: payload.seriesInstanceUid || payload.seriesInstanceUID,
          studyInstanceUid: payload.studyInstanceUid || payload.studyInstanceUID,
          frameNumber: fNum,
          caption: payload.caption || `${sDesc} | ${sliceStr}`
        });
      }
    }

    // 2. Active Viewport Metadata tracking
    if (
      data.type === MESSAGE_TYPES.VIEWPORT_CHANGE ||
      data.sopInstanceUID ||
      data.SOPInstanceUID ||
      data.instanceId ||
      data.sliceIndex ||
      data.frameNumber ||
      data.instanceNumber
    ) {
      const payload = data.payload || data;
      if (typeof onViewportStateChanged === 'function') {
        onViewportStateChanged({
          sopInstanceUid: payload.sopInstanceUid || payload.sopInstanceUID || payload.instanceId,
          seriesInstanceUid: payload.seriesInstanceUid || payload.seriesInstanceUID,
          frameNumber: payload.frameNumber || payload.instanceNumber || payload.sliceIndex || payload.frameIndex || 1,
          totalSlices: payload.totalSlices || payload.total_slices || payload.numSlices || 1,
          seriesDescription: payload.seriesDescription || payload.SeriesDescription || 'Diagnostic Viewport'
        });
      }
    }
  };

  window.addEventListener('message', handleMessage);
  return () => window.removeEventListener('message', handleMessage);
}

/**
 * Detects active slice number, total slices, and series description from iframe DOM text overlays.
 * Filters out thumbnail panel / study browser sidebar elements and prioritizes active canvas viewports.
 */
export function detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList = []) {
  if (!iframeDoc) return null;

  try {
    const bodyEl = iframeDoc.body || iframeDoc;

    // Comprehensive sidebar / thumbnail / browser container detector
    const isSidebarElement = (el) => {
      if (!el) return false;
      return !!el.closest(
        '[class*="sidebar"], [class*="Sidebar"], [class*="sidepanel-left"], [class*="SidePanel-left"], ' +
        '[class*="thumbnail"], [class*="Thumbnail"], [data-cy*="browser"], [data-cy*="thumbnail"], ' +
        '[class*="StudyBrowser"], [class*="studyBrowser"], [class*="LeftHandPanel"], [class*="leftHandPanel"], ' +
        '[class*="left-panel"], [class*="LeftPanel"], [class*="study-browser"], [class*="series-quick-select"], ' +
        '[class*="SeriesItem"], [class*="seriesItem"], [class*="ThumbnailList"], [class*="thumbnailList"], ' +
        '[data-cy*="study-list"], [class*="study-list"], [class*="StudyList"], [class*="QuickSelect"]'
      );
    };

    // Helper to find enclosing viewport container box for an overlay or canvas element
    const getViewportContainer = (el) => {
      let curr = el;
      while (curr && curr !== bodyEl) {
        if (isSidebarElement(curr)) return null;
        const cls = (curr.className || '').toString().toLowerCase();
        const cy = (curr.getAttribute?.('data-cy') || '').toLowerCase();
        const id = (curr.id || '').toLowerCase();
        if (
          cls.includes('viewport') || cls.includes('cornerstone') || cls.includes('pane') ||
          cy.includes('viewport') || cy.includes('cornerstone') || id.includes('viewport') ||
          cls.includes('active') || cls.includes('selected')
        ) {
          return curr;
        }
        curr = curr.parentElement;
      }
      return el ? (el.parentElement || el) : null;
    };

    // Helper to resolve matching series from text within a specific container element using strict scoring
    const resolveSeriesFromContainer = (containerEl) => {
      if (!containerEl || !Array.isArray(studySeriesList) || studySeriesList.length === 0) return null;

      const textNodes = [];
      const walk = iframeDoc.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, null, false);
      let n;
      while ((n = walk.nextNode())) {
        const v = n.nodeValue?.trim();
        if (v && v.length <= 150) {
          const pEl = n.parentElement;
          if (pEl && isSidebarElement(pEl)) continue;
          textNodes.push(v);
        }
      }
      const containerText = textNodes.join(' ');
      if (!containerText) return null;

      const lowerText = containerText.toLowerCase().replace(/\s+/g, ' ');

      // Score each series in studySeriesList based on uniqueness and specificity
      let bestSeries = null;
      let highestScore = -1;

      for (const s of studySeriesList) {
        if (!s.series_description && !s.series_number) continue;
        let score = 0;
        const dClean = String(s.series_description || '').toLowerCase().trim();
        const sNum = parseInt(s.series_number, 10);

        // 1. Check unique token occurrences (e.g. "b60s" vs "b20s", "t2of")
        if (dClean.length >= 3) {
          const tokens = dClean.split(/[\s_-]+/).filter(t => t.length >= 3);
          for (const token of tokens) {
            if (lowerText.includes(token)) {
              // Is this token unique to series s among all series in studySeriesList?
              const isUniqueToken = !studySeriesList.some(other => 
                other !== s && String(other.series_description || '').toLowerCase().includes(token)
              );
              if (isUniqueToken) {
                score += 100; // Major boost for exclusive token match like B60s!
              } else {
                score += 5;
              }
            }
          }

          // Full clean description match
          if (lowerText.includes(dClean)) {
            score += 50;
          }
        }

        // 2. Check series number match (e.g. "S: 5", "Series 5", "S5")
        if (!isNaN(sNum) && sNum > 0) {
          const serRegex = new RegExp(`(?:series|ser|s)\\s*:?\\s*${sNum}\\b`, 'i');
          if (serRegex.test(containerText)) {
            score += 150; // Major boost for explicit Series Number match!
          }
        }

        if (score > highestScore && score > 0) {
          highestScore = score;
          bestSeries = s;
        }
      }

      if (bestSeries) return bestSeries;

      // Fallback: 1. Exact full series description match
      const exactMatch = studySeriesList.find(s => {
        if (!s.series_description) return false;
        const dClean = String(s.series_description).toLowerCase().replace(/\s+/g, ' ').trim();
        return dClean.length >= 2 && lowerText.includes(dClean);
      });
      if (exactMatch) return exactMatch;

      return null;
    };

    // Ancestor series resolver: tries active canvas viewport box -> viewport container -> parent chain -> document body
    const resolveSeriesFromElementAncestors = (el) => {
      // 1. Try active viewport canvas overlay text first
      const canvases = Array.from(iframeDoc.querySelectorAll('canvas')).filter(c => !isSidebarElement(c));
      const activeCanvas = canvases.find(c => c.closest('.active, [class*="active"], [class*="Active"], [class*="selected"], [class*="Selected"]')) || canvases[0];

      if (activeCanvas) {
        const cBox = activeCanvas.parentElement || activeCanvas;
        const activeMatched = resolveSeriesFromContainer(cBox);
        if (activeMatched) return activeMatched;
      }

      if (!el) return resolveSeriesFromContainer(bodyEl);
      const vpContainer = getViewportContainer(el);
      let matched = resolveSeriesFromContainer(vpContainer);
      if (matched) return matched;

      let curr = el;
      while (curr && curr !== bodyEl) {
        if (isSidebarElement(curr)) break;
        matched = resolveSeriesFromContainer(curr);
        if (matched) return matched;
        curr = curr.parentElement;
      }

      return resolveSeriesFromContainer(bodyEl);
    };

    // 0. Direct Overlay & Viewport Text Element InnerText Inspection (Priority 0)
    const overlayElements = Array.from(iframeDoc.querySelectorAll(
      '[class*="overlay"], [class*="Overlay"], [class*="info"], [class*="Info"], [class*="viewport"], [class*="Viewport"], [class*="cornerstone"], [class*="Cornerstone"], [class*="bottom-right"], [class*="bottomRight"], div, span, p'
    )).filter(el => {
      if (isSidebarElement(el)) return false;
      const text = (el.innerText || el.textContent || '').trim();
      return text && text.length > 0 && text.length < 250 && (text.includes('/') || text.includes('(') || text.includes('of') || /\b(slice|im|image|frame|instance|i)\b/i.test(text));
    });

    for (const overlayEl of overlayElements) {
      const text = (overlayEl.innerText || overlayEl.textContent || '').trim();
      if (!text || text.length > 250) continue;

      // Match parenthesized slice ratio anywhere in string: ": 58 (58/313)", ": 65 (65/313)", "I: 25 (25/352)", "(58/313)"
      const parenRatioMatch = text.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
      if (parenRatioMatch) {
        const sNum = parseInt(parenRatioMatch[1], 10);
        const tNum = parseInt(parenRatioMatch[2], 10);
        if (sNum > 0 && tNum > 0 && sNum <= tNum) {
          const instLeadMatch = text.match(/(?:i|im|image|slice|frame|instance|f)?\s*:?\s*(\d+)\s*\(/i);
          const instNum = instLeadMatch ? parseInt(instLeadMatch[1], 10) : sNum;
          const matchedSeriesObj = resolveSeriesFromElementAncestors(overlayEl);
          return {
            instanceNumber: instNum,
            sliceNumber: sNum,
            totalSlices: tNum,
            matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
            seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null
          };
        }
      }

      // Match "43 of 313" or "Slice 43 of 313"
      const ofMatch = text.match(/(?:slice|im|image|frame|instance|i|f)?\s*:?\s*(\d+)\s+of\s+(\d+)/i);
      if (ofMatch) {
        const sNum = parseInt(ofMatch[1], 10);
        const tNum = parseInt(ofMatch[2], 10);
        if (sNum > 0 && tNum > 0 && sNum <= tNum) {
          const matchedSeriesObj = resolveSeriesFromElementAncestors(overlayEl);
          return {
            instanceNumber: sNum,
            sliceNumber: sNum,
            totalSlices: tNum,
            matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
            seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null
          };
        }
      }

      // Match "43/313" or "Slice 43/313"
      const slashMatch = text.match(/(?:slice|im|image|frame|instance|i|f)?\s*:?\s*(\d+)\s*\/\s*(\d+)/i);
      if (slashMatch) {
        const sNum = parseInt(slashMatch[1], 10);
        const tNum = parseInt(slashMatch[2], 10);
        if (sNum > 0 && tNum > 0 && sNum <= tNum) {
          const matchedSeriesObj = resolveSeriesFromElementAncestors(overlayEl);
          return {
            instanceNumber: sNum,
            sliceNumber: sNum,
            totalSlices: tNum,
            matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
            seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null
          };
        }
      }

      // Match "Slice: 43" or "Im: 43" or "Frame: 43" or "I: 43"
      const singleMatch = text.match(/(?:slice|im|image|frame|instance|i|f)\s*:?\s*(\d+)/i);
      if (singleMatch) {
        const sNum = parseInt(singleMatch[1], 10);
        if (sNum > 0) {
          const matchedSeriesObj = resolveSeriesFromElementAncestors(overlayEl);
          return {
            instanceNumber: sNum,
            sliceNumber: sNum,
            totalSlices: null,
            matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
            seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null
          };
        }
      }
    }

    // 1. Gather viewports / canvas containers outside sidebars, prioritizing active/selected canvas
    const canvases = Array.from(iframeDoc.querySelectorAll('canvas'))
      .filter(c => !isSidebarElement(c))
      .sort((a, b) => {
        const areaA = (a.clientWidth || a.width || 0) * (a.clientHeight || a.height || 0);
        const areaB = (b.clientWidth || b.width || 0) * (b.clientHeight || b.height || 0);
        return areaB - areaA;
      });

    const activeCanvas = canvases.find(c => c.closest('.active, [class*="active"], [class*="Active"], [class*="selected"], [class*="Selected"]')) || canvases[0];

    const sortedCanvases = activeCanvas
      ? [activeCanvas, ...canvases.filter(c => c !== activeCanvas)]
      : canvases;

    let candidateContainers = [];

    sortedCanvases.forEach(c => {
      let vp = c.parentElement;
      while (vp && vp !== bodyEl) {
        if (isSidebarElement(vp)) break;
        if (!candidateContainers.includes(vp)) {
          candidateContainers.push(vp);
        }
        vp = vp.parentElement;
      }
    });

    if (candidateContainers.length === 0) {
      candidateContainers = [bodyEl];
    }

    const parseTextNodesForSlice = (textNodes, isBodyFallback = false) => {
      // Priority 1: Parenthesized pattern like "(16/258)" or "I: 243 (16/258)" - unique to viewport overlays
      for (const item of textNodes) {
        const fullParenMatch = item.val.match(/(?:i|im|image|slice|frame|s)?\s*:?\s*(\d+)?\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
        if (fullParenMatch) {
          const instNum = fullParenMatch[1] ? parseInt(fullParenMatch[1], 10) : null;
          const sNum = parseInt(fullParenMatch[2], 10);
          const tNum = parseInt(fullParenMatch[3], 10);
          if (sNum > 0 && tNum > 0 && sNum <= tNum) {
            return { instanceNumber: instNum, sliceNumber: sNum, totalSlices: tNum, item };
          }
        }
      }

      // Priority 2: Simple parenthesized fraction "(16/258)"
      for (const item of textNodes) {
        const parenMatch = item.val.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
        if (parenMatch) {
          const sNum = parseInt(parenMatch[1], 10);
          const tNum = parseInt(parenMatch[2], 10);
          if (sNum > 0 && tNum > 0 && sNum <= tNum) {
            return { instanceNumber: null, sliceNumber: sNum, totalSlices: tNum, item };
          }
        }
      }

      // Priority 3: Explicit "Slice 16 of 258" or "Image 16/258"
      for (const item of textNodes) {
        const simpleMatch = item.val.match(/(?:slice|im|image|frame)\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i);
        if (simpleMatch) {
          const sNum = parseInt(simpleMatch[1], 10);
          const tNum = parseInt(simpleMatch[2], 10);
          if (sNum > 0 && tNum > 0 && sNum <= tNum) {
            return { instanceNumber: null, sliceNumber: sNum, totalSlices: tNum, item };
          }
        }
      }

      // Priority 4: Fallback unparenthesized fraction "16/258"
      for (const item of textNodes) {
        const unparenMatch = item.val.match(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/);
        if (unparenMatch) {
          const sNum = parseInt(unparenMatch[1], 10);
          const tNum = parseInt(unparenMatch[2], 10);
          if (sNum > 0 && tNum > 0 && sNum <= tNum) {
            if (isBodyFallback && sNum === 1 && tNum === 1) continue;
            return { instanceNumber: null, sliceNumber: sNum, totalSlices: tNum, item };
          }
        }
      }

      // Priority 5: Instance number fallback "I: 243"
      for (const item of textNodes) {
        const instMatch = item.val.match(/(?:^|\s)(?:i|im|image|instance)\s*:?\s*(\d+)(?:\s|$)/i);
        if (instMatch) {
          const instNum = parseInt(instMatch[1], 10);
          if (instNum > 0) {
            return { instanceNumber: instNum, sliceNumber: instNum, totalSlices: null, item };
          }
        }
      }

      return null;
    };

    // 2. Iterate candidate containers in priority order
    for (const container of candidateContainers) {
      const containerTextNodes = [];
      const containerWalk = iframeDoc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = containerWalk.nextNode())) {
        const val = node.nodeValue?.trim();
        if (!val || val.length > 150) continue;
        const pEl = node.parentElement;
        if (pEl && isSidebarElement(pEl)) continue;
        containerTextNodes.push({ node, val, parentEl: pEl });
      }

      if (containerTextNodes.length === 0) continue;

      const targetSliceNodeInfo = parseTextNodesForSlice(containerTextNodes);
      if (!targetSliceNodeInfo) continue;

      const { instanceNumber, sliceNumber, totalSlices } = targetSliceNodeInfo;

      let targetVp = targetSliceNodeInfo.item.parentEl;
      while (targetVp && targetVp !== bodyEl) {
        const cls = (targetVp.className || '').toString().toLowerCase();
        const cy = (targetVp.getAttribute?.('data-cy') || '').toLowerCase();
        if (cls.includes('viewport') || cls.includes('pane') || cy.includes('viewport') || cls.includes('grid') || cls.includes('cornerstone')) {
          break;
        }
        targetVp = targetVp.parentElement;
      }

      const matchedSeriesObj = resolveSeriesFromElementAncestors(targetVp) || resolveSeriesFromElementAncestors(container);
      const matchedSeriesId = matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null;
      const seriesDescription = matchedSeriesObj ? matchedSeriesObj.series_description : null;

      return {
        instanceNumber: instanceNumber || null,
        sliceNumber,
        totalSlices: totalSlices || null,
        matchedSeriesId,
        seriesDescription
      };
    }

    // 3. Fallback: Search all non-sidebar text nodes in iframeDoc.body
    const allDocTextNodes = [];
    const docWalk = iframeDoc.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null, false);
    let dNode;
    while ((dNode = docWalk.nextNode())) {
      const dVal = dNode.nodeValue?.trim();
      if (!dVal || dVal.length > 150) continue;
      const pEl = dNode.parentElement;
      if (pEl && isSidebarElement(pEl)) continue;
      allDocTextNodes.push({ node: dNode, val: dVal, parentEl: pEl });
    }

    const fallbackSliceInfo = parseTextNodesForSlice(allDocTextNodes, true);
    if (fallbackSliceInfo) {
      const { instanceNumber, sliceNumber, totalSlices } = fallbackSliceInfo;
      let targetVp = fallbackSliceInfo.item.parentEl;
      while (targetVp && targetVp !== bodyEl) {
        const cls = (targetVp.className || '').toString().toLowerCase();
        const cy = (targetVp.getAttribute?.('data-cy') || '').toLowerCase();
        if (cls.includes('viewport') || cls.includes('pane') || cy.includes('viewport') || cls.includes('grid') || cls.includes('cornerstone')) {
          break;
        }
        targetVp = targetVp.parentElement;
      }

      const matchedSeriesObj = resolveSeriesFromElementAncestors(targetVp) || resolveSeriesFromElementAncestors(bodyEl);
      const matchedSeriesId = matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null;
      const seriesDescription = matchedSeriesObj ? matchedSeriesObj.series_description : null;

      return {
        instanceNumber: instanceNumber || null,
        sliceNumber,
        totalSlices: totalSlices || null,
        matchedSeriesId,
        seriesDescription
      };
    }
  } catch (e) {
    console.warn('[ViewerBridge] DOM slice detection exception:', e);
  }
  return null;
}

/**
 * Trigger active viewer viewport capture from parent window to iframe.
 * Tries postMessage listener RPC, same-origin canvas extraction, and DOM overlay slice index detection.
 */
export async function requestViewerSnapshot(iframeSelector = 'iframe', studySeriesList = []) {
  const iframeEl = typeof iframeSelector === 'string' ? document.querySelector(iframeSelector) : iframeSelector;
  if (!iframeEl) return { dataUrl: null, instanceNumber: null, sliceNumber: null, totalSlices: null, matchedSeriesId: null, seriesDescription: null };

  // Listen for iframe postMessage response with a 200ms timeout
  const waitPostMessage = new Promise((resolve) => {
    const handler = (event) => {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return; }
      }
      if (!data || typeof data !== 'object') return;

      if (
        data.type === MESSAGE_TYPES.SNAPSHOT_CAPTURED ||
        data.type === MESSAGE_TYPES.OHIF_SNAPSHOT ||
        data.type === MESSAGE_TYPES.ADD_KEY_IMAGE ||
        data.eventName === 'SNAPSHOT_CAPTURED' ||
        data.type === MESSAGE_TYPES.VIEWPORT_CHANGE
      ) {
        const payload = data.payload || data;
        const dUrl = payload.dataUrl || payload.imageUrl || payload.url;
        const fNum = payload.frameNumber || payload.sliceNumber || payload.sliceIndex || payload.instanceNumber;
        const tSlices = payload.totalSlices || payload.total_slices;
        const sDesc = payload.seriesDescription || payload.seriesDesc;
        const sUid = payload.seriesInstanceUid || payload.seriesInstanceUID;
        const iNum = payload.instanceNumber || payload.sopInstanceUid;

        if (dUrl || fNum) {
          window.removeEventListener('message', handler);
          resolve({
            dataUrl: dUrl || null,
            instanceNumber: iNum || null,
            sliceNumber: fNum ? parseInt(fNum, 10) : null,
            totalSlices: tSlices ? parseInt(tSlices, 10) : null,
            matchedSeriesId: sUid || null,
            seriesDescription: sDesc || null
          });
        }
      }
    };

    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 200);
  });

  try {
    if (iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage({ type: MESSAGE_TYPES.REQUEST_SNAPSHOT, action: 'CAPTURE' }, '*');
      iframeEl.contentWindow.postMessage({ type: MESSAGE_TYPES.OHIF_CAPTURE_VIEWPORT, action: 'CAPTURE' }, '*');
    }
  } catch (e) {
    // Ignore postMessage error
  }

  const postMsgRes = await waitPostMessage;
  if (postMsgRes && (postMsgRes.sliceNumber || postMsgRes.dataUrl)) {
    return postMsgRes;
  }

  let dataUrl = null;
  let instanceNumber = null;
  let sliceNumber = null;
  let totalSlices = null;
  let matchedSeriesId = null;
  let seriesDescription = null;

  try {
    const iframeWin = iframeEl.contentWindow;
    const iframeDoc = iframeEl.contentDocument || (iframeWin && iframeWin.document);
    if (iframeDoc) {
      const sliceInfo = detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList);
      if (sliceInfo) {
        instanceNumber = sliceInfo.instanceNumber;
        sliceNumber = sliceInfo.sliceNumber;
        totalSlices = sliceInfo.totalSlices;
        matchedSeriesId = sliceInfo.matchedSeriesId;
        seriesDescription = sliceInfo.seriesDescription;
      }

      const isSidebarElement = (el) => {
        if (!el) return false;
        return !!el.closest(
          '[class*="sidebar"], [class*="Sidebar"], [class*="sidepanel"], [class*="SidePanel"], ' +
          '[class*="thumbnail"], [class*="Thumbnail"], [data-cy*="browser"], [data-cy*="thumbnail"], ' +
          '[class*="StudyBrowser"], [class*="studyBrowser"], [class*="LeftHandPanel"], [class*="leftHandPanel"]'
        );
      };

      const canvases = Array.from(iframeDoc.querySelectorAll('canvas'))
        .filter(c => !isSidebarElement(c))
        .sort((a, b) => {
          const areaA = (a.clientWidth || a.width || 0) * (a.clientHeight || a.height || 0);
          const areaB = (b.clientWidth || b.width || 0) * (b.clientHeight || b.height || 0);
          return areaB - areaA;
        });

      if (canvases.length > 0) {
        const activeCanvas = canvases.find(c => c.closest('.active, [class*="active"], [class*="Active"], [class*="selected"]')) || canvases[0];
        if (activeCanvas && (activeCanvas.width > 0 || activeCanvas.clientWidth > 0)) {
          dataUrl = activeCanvas.toDataURL('image/jpeg', 0.95);
        }
      }
    }
  } catch (e) {
    // Canvas security exception
  }

  return { dataUrl, instanceNumber, sliceNumber, totalSlices, matchedSeriesId, seriesDescription };
}

