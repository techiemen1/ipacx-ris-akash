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

    const matchSeriesByCount = (totalImages) => {
      if (!totalImages || !Array.isArray(studySeriesList)) return null;
      const candidates = studySeriesList.filter(s =>
        parseInt(s.total_slices, 10) === totalImages ||
        (Array.isArray(s.instances) && s.instances.length === totalImages)
      );
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) return candidates[0]; // Best effort
      return null;
    };

    // =====================================================================
    // STRATEGY A: Cornerstone3D getRenderingEngines API (OHIF v3)
    // =====================================================================
    try {
      const cs = iframeWin && iframeWin.cornerstone;
      if (cs && typeof cs.getRenderingEngines === 'function') {
        const engines = cs.getRenderingEngines();
        let bestVp = null;
        let bestArea = 0;

        for (const engine of engines) {
          const viewports = engine.getViewports ? engine.getViewports() : [];
          for (const vp of viewports) {
            try {
              const el = vp.element;
              if (!el) continue;
              const area = (el.clientWidth || 0) * (el.clientHeight || 0);
              if (area < 40000) continue; // Skip tiny thumbnails
              if (area > bestArea) { bestArea = area; bestVp = vp; }
            } catch (e) { /* skip */ }
          }
        }

        if (bestVp) {
          let idx = null;
          let total = null;
          if (typeof bestVp.getCurrentImageIdIndex === 'function') idx = bestVp.getCurrentImageIdIndex();
          if (typeof bestVp.getImageIds === 'function') {
            const ids = bestVp.getImageIds();
            total = ids ? ids.length : null;
          }
          if (idx !== null && total !== null) {
            const sliceNumber = idx + 1;
            console.log('[ViewerBridge] CS3D API → slice', sliceNumber, '/', total);
            const matched = matchSeriesByCount(total);
            return {
              instanceNumber: null,
              sliceNumber,
              totalSlices: total,
              matchedSeriesId: matched ? (matched.series_id || matched.orthanc_series_id || matched.series_instance_uid) : null,
              seriesDescription: matched ? matched.series_description : null
            };
          }
        }
      }
    } catch (e) {
      console.log('[ViewerBridge] CS3D not available:', e.message);
    }

    // =====================================================================
    // STRATEGY B: Legacy cornerstoneTools (OHIF v2)
    // =====================================================================
    try {
      const ct = iframeWin && iframeWin.cornerstoneTools;
      if (ct && ct.state && ct.state.enabledElements) {
        let bestArea = 0;
        let bestResult = null;
        for (const elData of ct.state.enabledElements) {
          const stackState = ct.getToolState && ct.getToolState(elData.element, 'stack');
          if (stackState && stackState.data && stackState.data[0]) {
            const sd = stackState.data[0];
            const el = elData.element;
            const area = el ? (el.clientWidth || 0) * (el.clientHeight || 0) : 0;
            if (area < 40000) continue;
            if (area > bestArea) {
              bestArea = area;
              const total = sd.imageIds ? sd.imageIds.length : null;
              const idx = sd.currentImageIdIndex;
              if (idx !== null && total) {
                bestResult = { sliceNumber: idx + 1, total };
              }
            }
          }
        }
        if (bestResult) {
          console.log('[ViewerBridge] cornerstoneTools → slice', bestResult.sliceNumber, '/', bestResult.total);
          const matched = matchSeriesByCount(bestResult.total);
          return {
            instanceNumber: null,
            sliceNumber: bestResult.sliceNumber,
            totalSlices: bestResult.total,
            matchedSeriesId: matched ? (matched.series_id || matched.orthanc_series_id) : null,
            seriesDescription: matched ? matched.series_description : null
          };
        }
      }
    } catch (e) {
      // cornerstoneTools not available
    }

    // =====================================================================
    // STRATEGY C: DOM text overlay from LARGEST canvas only
    // =====================================================================

    // Attach click tracker (only once) to track which canvas user last interacted with
    try {
      if (iframeDoc && !iframeDoc._activeViewportTrackerAttached) {
        iframeDoc._activeViewportTrackerAttached = true;
        const trackActive = (e) => {
          try {
            const target = e.target;
            if (!target) return;
            const c = target.tagName === 'CANVAS' ? target : target.closest('canvas');
            if (c) {
              const area = (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0);
              if (area > 10000) iframeDoc._lastActiveCanvas = c;
            }
          } catch (err) { /* ignore */ }
        };
        iframeDoc.addEventListener('pointerdown', trackActive, true);
        iframeDoc.addEventListener('click', trackActive, true);
      }
    } catch (e) { /* ignore */ }

    // Find all visible canvases, sorted largest first
    const allCanvases = Array.from(iframeDoc.querySelectorAll('canvas'))
      .map(c => ({ c, area: (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0) }))
      .filter(({ area }) => area > 5000)
      .sort((a, b) => b.area - a.area)
      .map(({ c }) => c);

    if (allCanvases.length === 0) {
      console.log('[ViewerBridge] No visible canvases in iframe');
      return null;
    }

    const largestArea = (() => {
      const c = allCanvases[0];
      return (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0);
    })();

    // Thumbnail threshold: anything < 20% of largest canvas is a thumbnail
    const thumbThreshold = largestArea * 0.20;

    // Prefer the user's last-clicked canvas if it's large enough
    const lastActive = iframeDoc._lastActiveCanvas;
    const lastActiveArea = lastActive ? ((lastActive.clientWidth || lastActive.width || 0) * (lastActive.clientHeight || lastActive.height || 0)) : 0;
    const mainCanvas = (lastActive && lastActiveArea >= thumbThreshold) ? lastActive : allCanvases[0];

    const mainArea = (mainCanvas.clientWidth || mainCanvas.width || 0) * (mainCanvas.clientHeight || mainCanvas.height || 0);
    console.log('[ViewerBridge] Strategy C: largestArea=', largestArea, 'mainArea=', mainArea, 'thumbThreshold=', thumbThreshold);

    // Walk UP from mainCanvas, stopping when we encounter a parent that contains
    // another large canvas (= a grid container). Everything below that level
    // belongs to the single active viewport.
    let mainVpEl = mainCanvas;
    let par = mainCanvas.parentElement;
    while (par && par !== bodyEl) {
      const otherBigCanvases = Array.from(par.querySelectorAll('canvas')).filter(c => {
        if (c === mainCanvas) return false;
        const a = (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0);
        return a >= thumbThreshold;
      });
      if (otherBigCanvases.length > 0) break;
      mainVpEl = par;
      par = par.parentElement;
    }

    console.log('[ViewerBridge] Single-viewport container:', mainVpEl.tagName,
      (mainVpEl.className || '').toString().substring(0, 80));

    // Collect all text from single-viewport container AND iframe body
    const allTexts = [];

    // 1. Text nodes (raw text)
    const tw = iframeDoc.createTreeWalker(mainVpEl, NodeFilter.SHOW_TEXT, null, false);
    let tn;
    while ((tn = tw.nextNode())) {
      const v = tn.nodeValue && tn.nodeValue.trim();
      if (v && v.length > 0 && v.length <= 150) {
        allTexts.push({ val: v });
      }
    }

    // 2. Element innerText & textContent across all child nodes in mainVpEl
    const allDescendants = Array.from(mainVpEl.querySelectorAll('*'));
    for (const el of allDescendants) {
      const txt = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
      if (txt && txt.length > 0 && txt.length <= 150 && !allTexts.some(t => t.val === txt)) {
        allTexts.push({ val: txt });
      }
    }

    // 3. Main container innerText
    const mainVpText = (mainVpEl.innerText || mainVpEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (mainVpText && !allTexts.some(t => t.val === mainVpText)) {
      allTexts.push({ val: mainVpText });
    }

    // 4. Iframe body innerText fallback
    if (iframeDoc.body) {
      const bodyText = (iframeDoc.body.innerText || iframeDoc.body.textContent || '').replace(/\s+/g, ' ').trim();
      if (bodyText && !allTexts.some(t => t.val === bodyText)) {
        allTexts.push({ val: bodyText });
      }
    }

    console.log('[ViewerBridge] All texts from single-VP:', allTexts.map(t => t.val).filter(v => /\d/.test(v)).slice(0, 30).join(' | '));

    // Parse for slice info - Prioritize multi-slice series (totalSlices > 1) over 1/1 scout/localizer overlays
    const parseSlice = (texts) => {
      const candidates = [];

      // P1: "(73/313)" or "I: 73 (73/313)" or "Im: 73/313" or "Slice 73 of 313"
      for (const { val } of texts) {
        const m = val.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/) || 
                  val.match(/(?:slice|image|im|frame|i|sl)\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i) ||
                  val.match(/\b(\d+)\s*\/\s*(\d+)\b/);
        if (m) {
          const sn = parseInt(m[1], 10), tn2 = parseInt(m[2], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, text: val });
          }
        }
      }

      // P2: "I: 73" or "Sl: 73"
      if (candidates.length === 0) {
        for (const { val } of texts) {
          const m = val.match(/(?:^|\s)(?:i|sl|slice|im|image)\s*:?\s*(\d+)(?:\s|$)/i);
          if (m) {
            const sn = parseInt(m[1], 10);
            if (sn > 0) {
              candidates.push({ sliceNumber: sn, totalSlices: null, text: val });
            }
          }
        }
      }

      if (candidates.length === 0) return null;

      // Prefer candidate where totalSlices > 1 (main diagnostic stack) over 1/1 scout
      const multiSliceCandidate = candidates.find(c => c.totalSlices && c.totalSlices > 1);
      if (multiSliceCandidate) {
        console.log('[ViewerBridge] Multi-slice match:', multiSliceCandidate.text, '->', multiSliceCandidate.sliceNumber, '/', multiSliceCandidate.totalSlices);
        return multiSliceCandidate;
      }

      console.log('[ViewerBridge] Best-effort match:', candidates[0].text, '->', candidates[0].sliceNumber, '/', candidates[0].totalSlices);
      return candidates[0];
    };

    const sliceResult = parseSlice(allTexts);
    if (!sliceResult) {
      console.log('[ViewerBridge] No slice text found in single-viewport container');
      return null;
    }

    const { sliceNumber, totalSlices } = sliceResult;

    // Resolve series
    let matchedSeriesObj = matchSeriesByCount(totalSlices);

    if (!matchedSeriesObj && Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      const vpText = allTexts.map(t => t.val).join(' ').toLowerCase();
      let bestScore = -1;
      for (const s of studySeriesList) {
        const tokens = normalize(s.series_description).split(' ').filter(t => t.length >= 3);
        let score = 0;
        for (const tok of tokens) {
          if (vpText.includes(tok)) score += tok.length >= 5 ? 100 : 10;
        }
        if (score > bestScore) { bestScore = score; matchedSeriesObj = s; }
      }
      if (bestScore <= 0) matchedSeriesObj = null;
    }

    console.log('[ViewerBridge] Result → slice:', sliceNumber, '/', totalSlices, '| series:', matchedSeriesObj?.series_description);

    return {
      instanceNumber: null,
      sliceNumber,
      totalSlices: totalSlices || null,
      matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
      seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null
    };

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
