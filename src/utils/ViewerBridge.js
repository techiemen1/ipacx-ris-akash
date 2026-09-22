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
 */
export function validateOrigin(event, allowedOrigins = []) {
  if (!event) return false;
  const currentOrigin = window.location.origin;
  if (event.origin === currentOrigin) return true;
  if (event.origin === 'null' || event.origin === 'file://') return true;
  if (Array.isArray(allowedOrigins) && allowedOrigins.includes(event.origin)) return true;
  return false;
}

/**
 * Transmits a key image payload from inside the DICOM viewer iframe to the parent RIS window.
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
    targetWindow.postMessage({ type: MESSAGE_TYPES.ADD_KEY_IMAGE, payload: normalizedPayload }, targetOrigin);
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
 * Detects active slice number, total slices, and series description.
 * 
 * Strategy A: Cornerstone3D JavaScript API (most reliable, same-origin)
 * Strategy B: Legacy cornerstoneTools stack state
 * Strategy C: DOM text parsing from LARGEST canvas overlay ONLY
 */
export function detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList = []) {
  if (!iframeDoc) return null;

  try {
    const bodyEl = iframeDoc.body || iframeDoc;
    const iframeWin = iframeDoc.defaultView || iframeDoc.parentWindow;

    const normalize = (str) => String(str || '').toLowerCase().replace(/[\s_\-/\\,.:;]+/g, ' ').trim();

    // 1. Identify active viewport container element
    let activeContainer = null;

    // A. Check for explicit active/selected CSS classes or data attributes in OHIF DOM
    const activeCandidates = Array.from(iframeDoc.querySelectorAll(
      '.viewport-element.active, .viewport-wrapper.active, [data-viewport-uid].active, .cornerstone-canvas-wrapper.active, .viewport-container.active, .viewport-grid-item.active, .active-viewport, .viewport-element.selected, .viewport-wrapper.selected, .active'
    )).filter(el => {
      // Must contain a canvas or image viewport
      return el.querySelector('canvas') || el.classList.contains('viewport-element') || el.classList.contains('viewport-wrapper');
    });

    if (activeCandidates.length > 0) {
      activeContainer = activeCandidates[0];
    } else {
      // B. Check iframeDoc._lastActiveCanvas or any clicked canvas container
      const lastActive = iframeDoc._lastActiveCanvas;
      if (lastActive) {
        activeContainer = lastActive.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container') || lastActive.parentElement;
      }
    }

    // C. Fallback to largest canvas container if no active container explicitly marked
    if (!activeContainer) {
      const canvases = Array.from(iframeDoc.querySelectorAll('canvas'))
        .map(c => ({
          c,
          area: (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0),
          container: c.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container') || c.parentElement
        }))
        .filter(({ area }) => area > 5000)
        .sort((a, b) => b.area - a.area);

      if (canvases.length > 0) {
        activeContainer = canvases[0].container || canvases[0].c;
      }
    }

    // Collect text nodes specifically from activeContainer vs global document
    const activeTexts = [];
    const globalTexts = [];

    const collectFromNode = (root, targetArray) => {
      if (!root) return;
      // 1. TreeWalker text nodes
      const tw = iframeDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
      let tn;
      while ((tn = tw.nextNode())) {
        const v = tn.nodeValue && tn.nodeValue.trim();
        if (v && v.length > 0 && v.length <= 150) {
          targetArray.push(v);
        }
      }
      // 2. Elements textContent
      const elems = Array.from(root.querySelectorAll('*'));
      for (const el of elems) {
        // Exclude left sidebar / thumbnail panel text when collecting global text
        if (root !== activeContainer && el.closest('.study-browser, .series-quick-switch, .thumbnail-list, .sidebar, .study-browser-container')) {
          continue;
        }
        const txt = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
        if (txt && txt.length > 0 && txt.length <= 150 && !targetArray.includes(txt)) {
          targetArray.push(txt);
        }
      }
    };

    if (activeContainer) {
      collectFromNode(activeContainer, activeTexts);
    }
    collectFromNode(bodyEl, globalTexts);

    console.log('[ViewerBridge] Active viewport DOM texts:', activeTexts.filter(v => /\d/.test(v)).slice(0, 30).join(' | '));

    // Parse slice candidates with pattern scoring
    const parseSliceCandidates = (textList, basePriority = 100) => {
      const candidates = [];
      for (const val of textList) {
        // Pattern 0: "I : 208 (48/255)", "1 : 52 (52/313)" -> 3 numbers: InstNum, SliceNum, TotalSlices
        let m = val.match(/(?:\d+|I|Im|Slice|Image)\s*:\s*(\d+)\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
        if (m) {
          const instNum = parseInt(m[1], 10);
          const sn = parseInt(m[2], 10);
          const tn2 = parseInt(m[3], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, instanceNumber: instNum, text: val, priority: basePriority + 200 });
            continue;
          }
        }

        // Pattern 1: "(48/255)" -> 2 numbers: SliceNum, TotalSlices
        m = val.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
        if (m) {
          const sn = parseInt(m[1], 10);
          const tn2 = parseInt(m[2], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, text: val, priority: basePriority + 150 });
            continue;
          }
        }

        // Pattern 2: "Im: 48/255", "Slice 48 of 255", "48/255"
        m = val.match(/(?:slice|image|im|frame|i|sl)\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i) || val.match(/\b(\d+)\s*\/\s*(\d+)\b/);
        if (m) {
          const sn = parseInt(m[1], 10);
          const tn2 = parseInt(m[2], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, text: val, priority: basePriority + 100 });
            continue;
          }
        }

        // Pattern 3: "I: 48" or "Sl: 48"
        m = val.match(/(?:^|\s)(?:i|sl|slice|im|image)\s*:\s*(\d+)(?:\s|$)/i);
        if (m) {
          const sn = parseInt(m[1], 10);
          if (sn > 0 && sn <= 2000) {
            candidates.push({ sliceNumber: sn, totalSlices: null, text: val, priority: basePriority + 40 });
          }
        }
      }
      return candidates;
    };

    let sliceCandidates = parseSliceCandidates(activeTexts, 200);
    if (sliceCandidates.length === 0) {
      sliceCandidates = parseSliceCandidates(globalTexts, 100);
    }

    sliceCandidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const bMulti = (b.totalSlices && b.totalSlices > 1) ? 1 : 0;
      const aMulti = (a.totalSlices && a.totalSlices > 1) ? 1 : 0;
      return bMulti - aMulti;
    });

    let sliceResult = sliceCandidates.length > 0 ? sliceCandidates[0] : null;

    // 2. Resolve matching Series Object
    let matchedSeriesObj = null;
    const activeTextStr = activeTexts.join(' ').toLowerCase();

    if (Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      let bestScore = -1;

      for (const s of studySeriesList) {
        if (!s.series_description) continue;
        const normDesc = normalize(s.series_description);
        if (!normDesc) continue;

        let score = 0;

        // Check text matching against ACTIVE viewport text overlay
        if (activeTextStr) {
          if (activeTextStr.includes(normDesc)) score += 1000;
          const tokens = normDesc.split(' ').filter(t => t.length >= 2);
          for (const tok of tokens) {
            if (activeTextStr.includes(tok)) score += tok.length >= 4 ? 200 : 50;
          }
          if (s.series_number && (activeTextStr.includes(`s: ${s.series_number}`) || activeTextStr.includes(`s:${s.series_number}`) || activeTextStr.includes(`series ${s.series_number}`))) {
            score += 800;
          }
        }

        // If no match in activeTexts, check globalTexts (excluding sidebar thumbnail panel)
        if (score === 0 && globalTexts.length > 0) {
          const globalTextStr = globalTexts.join(' ').toLowerCase();
          if (globalTextStr.includes(normDesc)) score += 100;
          const tokens = normDesc.split(' ').filter(t => t.length >= 3);
          for (const tok of tokens) {
            if (globalTextStr.includes(tok)) score += 20;
          }
        }

        if (score > bestScore && score > 30) {
          bestScore = score;
          matchedSeriesObj = s;
        }
      }
    }

    // Check Cornerstone3D API for active viewport seriesInstanceUID / imageId
    try {
      const cs = iframeWin && iframeWin.cornerstone;
      if (cs && typeof cs.getRenderingEngines === 'function') {
        const engines = cs.getRenderingEngines();
        for (const engine of engines) {
          const viewports = engine.getViewports ? engine.getViewports() : [];
          for (const vp of viewports) {
            try {
              const el = vp.element;
              const isVpActive = el && (
                el === activeContainer ||
                el.classList.contains('active') ||
                el.closest('.active') ||
                el.classList.contains('selected')
              );
              
              if (isVpActive || (!matchedSeriesObj && viewports.length === 1)) {
                const idx = typeof vp.getCurrentImageIdIndex === 'function' ? vp.getCurrentImageIdIndex() : null;
                const imageIds = typeof vp.getImageIds === 'function' ? vp.getImageIds() : [];

                if (idx !== null && idx >= 0 && imageIds && imageIds[idx]) {
                  const imgId = imageIds[idx];
                  const seriesUidMatch = imgId.match(/series\/([0-9.]+)/i) || imgId.match(/seriesInstanceUID=([0-9.]+)/i);
                  if (seriesUidMatch) {
                    const uid = seriesUidMatch[1];
                    const found = studySeriesList.find(s =>
                      String(s.series_instance_uid) === uid ||
                      String(s.series_id) === uid ||
                      String(s.orthanc_series_id) === uid
                    );
                    if (found) {
                      matchedSeriesObj = found;
                    }
                  }

                  if (!sliceResult && idx >= 0) {
                    sliceResult = {
                      sliceNumber: idx + 1,
                      totalSlices: imageIds.length || (matchedSeriesObj?.total_slices) || null,
                      priority: 50
                    };
                  }
                }
              }
            } catch (e) { /* skip */ }
          }
        }
      }
    } catch (e) { /* ignore CS3D */ }

    // Fallback: match series by total slice count ONLY if exactly 1 series matches that slice count
    if (!matchedSeriesObj && sliceResult?.totalSlices && Array.isArray(studySeriesList)) {
      const countCandidates = studySeriesList.filter(s =>
        parseInt(s.total_slices, 10) === sliceResult.totalSlices ||
        (Array.isArray(s.instances) && s.instances.length === sliceResult.totalSlices)
      );
      if (countCandidates.length === 1) {
        matchedSeriesObj = countCandidates[0];
      }
    }

    if (sliceResult || matchedSeriesObj) {
      console.log('[ViewerBridge] Parsed slice info -> slice:', sliceResult?.sliceNumber, '/', sliceResult?.totalSlices, '| series:', matchedSeriesObj?.series_description);
      return {
        instanceNumber: null,
        sliceNumber: sliceResult ? sliceResult.sliceNumber : 1,
        totalSlices: sliceResult?.totalSlices || matchedSeriesObj?.total_slices || null,
        matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
        seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null
      };
    }

  } catch (e) {
    console.warn('[ViewerBridge] detectViewportSliceInfoFromDOM exception:', e);
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

  try {
    if (iframeEl && iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage({ type: MESSAGE_TYPES.REQUEST_SNAPSHOT, action: 'CAPTURE' }, '*');
      iframeEl.contentWindow.postMessage({ type: MESSAGE_TYPES.OHIF_CAPTURE_VIEWPORT, action: 'CAPTURE' }, '*');
    }
  } catch (e) {
    // Ignore postMessage error
  }

  // Listen for iframe postMessage response with a 1200ms timeout
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
        data.type === MESSAGE_TYPES.VIEWPORT_CHANGE ||
        data.type === 'OHIF_VIEWPORT_CHANGE'
      ) {
        const payload = data.payload || data;
        const dUrl = payload.dataUrl || payload.imageUrl || payload.url;
        const fNum = payload.frameNumber || payload.sliceNumber || (payload.sliceIndex !== undefined ? payload.sliceIndex + 1 : null) || payload.instanceNumber;
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
    }, 1200);
  });

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

      // Try to capture canvas image
      const canvases = Array.from(iframeDoc.querySelectorAll('canvas'))
        .map(c => ({ c, area: (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0) }))
        .filter(({ area }) => area > 5000)
        .sort((a, b) => b.area - a.area)
        .map(({ c }) => c);

      const lastActive = iframeDoc._lastActiveCanvas;
      const lastActiveArea = lastActive ? ((lastActive.clientWidth || lastActive.width || 0) * (lastActive.clientHeight || lastActive.height || 0)) : 0;
      const bigThreshold = canvases.length > 0 ? ((canvases[0].clientWidth || canvases[0].width || 0) * (canvases[0].clientHeight || canvases[0].height || 0)) * 0.20 : 0;
      const activeCanvas = (lastActive && lastActiveArea >= bigThreshold) ? lastActive : (canvases[0] || null);

      if (activeCanvas && (activeCanvas.width > 0 || activeCanvas.clientWidth > 0)) {
        try {
          dataUrl = activeCanvas.toDataURL('image/jpeg', 0.95);
        } catch (e) {
          // CORS taint - canvas from cross-origin content
        }
      }
    }
  } catch (e) {
    // Cross-origin error
  }

  return { dataUrl, instanceNumber, sliceNumber, totalSlices, matchedSeriesId, seriesDescription };
}
