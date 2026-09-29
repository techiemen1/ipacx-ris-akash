/**
 * ViewerBridge.js
 * Cross-window event serializer & listener bridging OHIF v3 / Stone Viewer iframe
 * and RadiologyReportStudio / Diagnostic Workstation.
 * 
 * SECURITY: All postMessage events validated against strict origin checks.
 * No wildcard ('*') targetOrigin used in sensitive transmissions.
 */

export const MESSAGE_TYPES = {
  ADD_KEY_IMAGE: 'ADD_KEY_IMAGE',
  OHIF_SNAPSHOT: 'OHIF_SNAPSHOT',
  SNAPSHOT_CAPTURED: 'SNAPSHOT_CAPTURED',
  REQUEST_SNAPSHOT: 'REQUEST_SNAPSHOT',
  OHIF_CAPTURE_VIEWPORT: 'OHIF_CAPTURE_VIEWPORT',
  VIEWPORT_CHANGE: 'OHIF_VIEWPORT_CHANGE',
  KEY_IMAGE_REQUEST: 'KEY_IMAGE_REQUEST',
  DICOM_TAGS_RECEIVED: 'DICOM_TAGS_RECEIVED'
};

/**
 * Validates postMessage event origin for security.
 * STRICT VALIDATION: Only allows:
 *  1. Same origin (window.location.origin)
 *  2. Configured allowed origins (DCM4CHEE, OHIF hosts)
 *  3. Private LAN IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 * 
 * @param {MessageEvent} event - postMessage event
 * @param {string[]} allowedOrigins - Additional whitelisted origins
 * @returns {boolean} True if origin is authorized
 */
export function validateOrigin(event, allowedOrigins = []) {
  if (!event) {
    console.warn('[ViewerBridge] validateOrigin: event is null/undefined');
    return false;
  }

  const currentOrigin = window.location.origin;
  
  // 1. Same origin (most common, most secure)
  if (event.origin === currentOrigin) {
    return true;
  }

  // 2. Explicit whitelist match
  if (Array.isArray(allowedOrigins) && allowedOrigins.length > 0) {
    if (allowedOrigins.includes(event.origin)) {
      return true;
    }
  }

  // 3. Private LAN origins only (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  // Hospital networks typically use these ranges
  const isPrivateLanOrigin = /^https?:\/\/(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(event.origin);
  if (isPrivateLanOrigin) {
    return true;
  }

  // REJECTED
  console.warn(`[ViewerBridge] Origin validation FAILED: ${event.origin}`, {
    currentOrigin,
    allowedCount: (allowedOrigins || []).length,
    timestamp: new Date().toISOString()
  });
  return false;
}

/**
 * Transmits a key image payload from inside the DICOM viewer iframe to the parent RIS window.
 * SECURITY: Uses explicit targetOrigin, never wildcard ('*')
 * 
 * @param {Object} payload - Key image data (dataUrl, DICOM UIDs, slice info)
 * @param {Window} targetWindow - Target window (default: parent)
 * @param {string} targetOrigin - Explicit target origin (NOT '*')
 * @returns {boolean} Success flag
 */
export function sendKeyImageToRIS(payload, targetWindow = window.parent, targetOrigin = null) {
  const { 
    dataUrl, 
    sopInstanceUid, 
    seriesInstanceUid, 
    studyInstanceUid, 
    frameNumber, 
    windowWidth, 
    windowCenter, 
    seriesDescription, 
    modality,
    caption 
  } = payload || {};

  if (!dataUrl) {
    console.warn('[ViewerBridge] Cannot send key image: dataUrl is empty.');
    return false;
  }

  // Default to same origin if not specified
  const finalTargetOrigin = targetOrigin || window.location.origin;

  const normalizedPayload = {
    dataUrl,
    sopInstanceUid: sopInstanceUid || payload.sopInstanceUID || `sop_${Date.now()}`,
    seriesInstanceUid: seriesInstanceUid || payload.seriesInstanceUID || '',
    studyInstanceUid: studyInstanceUid || payload.studyInstanceUID || '',
    frameNumber: frameNumber || payload.frameIndex || payload.sliceIndex || 1,
    windowWidth: windowWidth || payload.ww || null,
    windowCenter: windowCenter || payload.wc || null,
    seriesDescription: seriesDescription || payload.seriesDesc || 'Diagnostic Viewport',
    modality: modality || payload.modality || 'CT',
    caption: caption || `${seriesDescription || 'Diagnostic Series'} | Slice ${frameNumber || 1}`,
    timestamp: Date.now(),
    sourceOrigin: window.location.origin
  };

  try {
    targetWindow.postMessage(
      { type: MESSAGE_TYPES.ADD_KEY_IMAGE, payload: normalizedPayload },
      finalTargetOrigin  // STRICT: explicit origin, not wildcard
    );
    console.log('[ViewerBridge] Key image sent to', finalTargetOrigin);
    return true;
  } catch (err) {
    console.error('[ViewerBridge] Failed to postMessage key image:', err);
    return false;
  }
}

/**
 * Subscribes parent window (Report Studio) to viewer messages.
 * SECURITY: Validates every incoming message origin before processing.
 * Returns an unsubscribe function for cleanup.
 * 
 * @param {Function} onKeyImageReceived - Callback for key image events
 * @param {Function} onViewportStateChanged - Callback for viewport state updates
 * @param {string[]} allowedOrigins - Whitelist of allowed iframe origins
 * @returns {Function} Unsubscribe function
 */
export function subscribeToViewerMessages(onKeyImageReceived, onViewportStateChanged, allowedOrigins = []) {
  const handleMessage = (event) => {
    // SECURITY: Validate origin FIRST, before processing any data
    if (!validateOrigin(event, allowedOrigins)) {
      console.warn(`[ViewerBridge] Message rejected from unauthorized origin: ${event.origin}`);
      return;
    }

    let data = event.data;
    if (typeof data === 'string') {
      try { 
        data = JSON.parse(data); 
      } catch (e) { 
        console.warn('[ViewerBridge] Failed to parse message data as JSON');
        return; 
      }
    }
    if (!data || typeof data !== 'object') {
      console.warn('[ViewerBridge] Message data is null or not an object');
      return;
    }

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
          modality: payload.modality || 'CT',
          caption: payload.caption || `${sDesc} | ${sliceStr}`,
          sourceOrigin: event.origin,
          timestamp: payload.timestamp || Date.now()
        });
        
        console.log('[ViewerBridge] Key image received from', event.origin);
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
          seriesDescription: payload.seriesDescription || payload.SeriesDescription || 'Diagnostic Viewport',
          modality: payload.modality || 'CT',
          sourceOrigin: event.origin,
          timestamp: Date.now()
        });
      }
    }
  };

  window.addEventListener('message', handleMessage);
  console.log('[ViewerBridge] Subscribed to viewer messages');
  
  return () => {
    window.removeEventListener('message', handleMessage);
    console.log('[ViewerBridge] Unsubscribed from viewer messages');
  };
}

/**
 * Detects active slice number, total slices, and series description.
 * 
 * Strategy Priority (in order):
 * 1. OHIF v3 Services Manager (most reliable for OHIF Viewer)
 * 2. Cornerstone3D JavaScript API (fallback for direct CS3D usage)
 * 3. DOM text overlay parsing (last resort, least reliable)
 */
export function detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList = [], hintSeriesId = null) {
  if (!iframeDoc) return null;

  try {
    const bodyEl = iframeDoc.body || iframeDoc;
    const iframeWin = iframeDoc.defaultView || iframeDoc.parentWindow;

    const isSidebarOrThumbnail = (el) => {
      if (!el) return false;
      try {
        return !!(el.closest && el.closest('.study-browser, .thumbnail-list, .sidebar, .study-list, .series-quick-switch, nav, header, aside, [class*="thumbnail"], [class*="Thumbnail"], [class*="SeriesItem"]'));
      } catch(e) {
        return false;
      }
    };

    // Attach interaction listeners to track active clicked/scrolled viewport
    if (!iframeDoc._hasInteractionListeners) {
      iframeDoc._hasInteractionListeners = true;
      const markActive = (ev) => {
        try {
          const target = ev.target;
          if (!target) return;
          const cv = target.tagName === 'CANVAS' ? target : (target.querySelector ? target.querySelector('canvas') : null);
          if (cv && !isSidebarOrThumbnail(cv)) iframeDoc._lastActiveCanvas = cv;
          const vpEl = target.closest ? target.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"]') : null;
          if (vpEl && !isSidebarOrThumbnail(vpEl)) iframeDoc._lastActiveViewport = vpEl;
        } catch (e) {
          /* ignore interaction tracking error */
        }
      };
      iframeDoc.addEventListener('pointerdown', markActive, true);
      iframeDoc.addEventListener('mousedown', markActive, true);
      iframeDoc.addEventListener('wheel', markActive, true);
      iframeDoc.addEventListener('focusin', markActive, true);
    }

    // Identify OHIF v3 Active Viewport ID from Services Manager if available
    let ohifActiveVpId = null;
    let sm = null;
    try {
      sm = iframeWin && (iframeWin.servicesManager || (iframeWin.ohif && iframeWin.ohif.servicesManager) || (iframeWin.ohifApp && iframeWin.ohifApp.servicesManager));
      if (sm && sm.services && sm.services.viewportGridService) {
        const vpgs = sm.services.viewportGridService;
        const gridState = typeof vpgs.getState === 'function' ? vpgs.getState() : null;
        ohifActiveVpId = (gridState && gridState.activeViewportId) || (typeof vpgs.getActiveViewportId === 'function' ? vpgs.getActiveViewportId() : null);
      }
    } catch (e) { /* ignore */ }

    // Helper: Determine if a DOM element is the active viewport
    const isElementActive = (el) => {
      if (!el || isSidebarOrThumbnail(el)) return false;
      if (el === iframeDoc._lastActiveViewport || el === iframeDoc._lastActiveCanvas || (iframeDoc._lastActiveCanvas && el.contains(iframeDoc._lastActiveCanvas))) return true;
      if (iframeDoc.activeElement && (el === iframeDoc.activeElement || el.contains(iframeDoc.activeElement))) return true;
      if (ohifActiveVpId && (el.getAttribute('data-viewport-uid') === ohifActiveVpId || el.id === ohifActiveVpId || el.getAttribute('data-cy')?.includes(ohifActiveVpId))) return true;

      if (el.classList.contains('active') || el.classList.contains('focused') || el.classList.contains('selected') || el.classList.contains('active-viewport') || el.classList.contains('border-primary')) return true;

      try {
        const style = iframeWin.getComputedStyle ? iframeWin.getComputedStyle(el) : null;
        if (style && style.borderColor) {
          const bc = style.borderColor.toLowerCase();
          if (bc.includes('0, 132, 199') || bc.includes('2, 132, 199') || bc.includes('56, 189, 248') || bc.includes('#0284c7') || bc.includes('#0084c7') || bc.includes('#38bdf8')) return true;
        }
      } catch (e) { /* ignore style check */ }

      return false;
    };

    // STRATEGY 0: OHIF v3 Services Manager (PRIMARY for OHIF Viewer)
    try {
      if (sm && sm.services && sm.services.viewportGridService && ohifActiveVpId) {
        const vpgs = sm.services.viewportGridService;
        const cvps = sm.services.cornerstoneViewportService;
        const dss = sm.services.displaySetService;
        const gridState = typeof vpgs.getState === 'function' ? vpgs.getState() : null;

        let activeVp = null;
        if (gridState && gridState.viewports) {
          const vps = gridState.viewports;
          if (typeof vps.get === 'function') activeVp = vps.get(ohifActiveVpId);
          else if (Array.isArray(vps)) activeVp = vps.find(v => v.id === ohifActiveVpId || v.viewportId === ohifActiveVpId);
          else if (typeof vps === 'object') activeVp = vps[ohifActiveVpId];
        }

        if (!activeVp && typeof vpgs.getViewport === 'function') {
          try { activeVp = vpgs.getViewport(ohifActiveVpId); } catch (e) { /* ignore */ }
        }

        let csvp = null;
        let csSlice = null;
        let csTotal = null;
        let windowCenter = null;
        let windowWidth = null;

        if (cvps && typeof cvps.getCornerstoneViewport === 'function') {
          try {
            csvp = cvps.getCornerstoneViewport(ohifActiveVpId);
            if (csvp) {
              let idx = null;
              try {
                if (typeof csvp.getCurrentImageIdIndex === 'function') idx = csvp.getCurrentImageIdIndex();
                else if (typeof csvp.getSliceIndex === 'function') idx = csvp.getSliceIndex();
                else if (typeof csvp.sliceIndex === 'number') idx = csvp.sliceIndex;
              } catch (e) { /* ignore */ }

              try {
                if (typeof csvp.getProperties === 'function') {
                  const props = csvp.getProperties();
                  if (props && props.voiRange) {
                    windowWidth = props.voiRange.upper - props.voiRange.lower;
                    windowCenter = (props.voiRange.upper + props.voiRange.lower) / 2;
                  }
                }
              } catch (e) { /* ignore */ }

              const ids = typeof csvp.getImageIds === 'function' ? csvp.getImageIds() : [];
              if (idx !== null && idx >= 0) {
                csSlice = idx + 1;
                csTotal = ids ? ids.length : null;
              }
            }
          } catch (e) { /* ignore */ }
        }

        const dsUid = activeVp ? (activeVp.displaySetInstanceUID || (Array.isArray(activeVp.displaySetInstanceUIDs) ? activeVp.displaySetInstanceUIDs[0] : null)) : null;
        const ds = (dss && dsUid && typeof dss.getDisplaySetByUID === 'function') ? dss.getDisplaySetByUID(dsUid) : null;

        const seriesUid = ds ? (ds.SeriesInstanceUID || ds.seriesInstanceUid) : null;
        const seriesDesc = ds ? (ds.SeriesDescription || ds.seriesDescription) : null;
        const modality = ds ? (ds.Modality || ds.modality) : "CT";
        let sopUid = null;
        if (ds && ds.images && csSlice && ds.images[csSlice - 1]) {
          sopUid = ds.images[csSlice - 1].SOPInstanceUID || ds.images[csSlice - 1].sopInstanceUid;
        } else if (ds && ds.images && ds.images[0]) {
          sopUid = ds.images[0].SOPInstanceUID || ds.images[0].sopInstanceUid;
        }

        let matchedSeriesObj = null;
        if (seriesUid && Array.isArray(studySeriesList)) {
          matchedSeriesObj = studySeriesList.find(s => 
            String(s.series_instance_uid) === String(seriesUid) ||
            String(s.series_id) === String(seriesUid) ||
            String(s.orthanc_series_id) === String(seriesUid)
          );
        }
        if (!matchedSeriesObj && seriesDesc && Array.isArray(studySeriesList)) {
          matchedSeriesObj = studySeriesList.find(s => 
            s.series_description && String(s.series_description).trim().toLowerCase() === String(seriesDesc).trim().toLowerCase()
          );
        }

        const activeCanvas = csvp?.element?.querySelector('canvas') || null;

        if (csSlice || seriesUid || seriesDesc) {
          console.log("✅ [VIEWERBRIDGE] Strategy 0 (OHIF Services) -> Matched active series:", matchedSeriesObj?.series_description || seriesDesc, "slice:", csSlice, "/", csTotal);
          return {
            instanceNumber: csSlice || null,
            sliceNumber: csSlice || 1,
            totalSlices: csTotal || ds?.numImageFrames || matchedSeriesObj?.total_slices || 1,
            seriesInstanceUid: seriesUid || matchedSeriesObj?.series_instance_uid || matchedSeriesObj?.series_id || null,
            matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : seriesUid,
            seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : seriesDesc,
            modality: modality || matchedSeriesObj?.modality || "CT",
            sopInstanceUid: sopUid || null,
            windowCenter,
            windowWidth,
            activeCanvas
          };
        }
      }
    } catch (e) { /* skip Strategy 0 */ }

    // STRATEGY 1: Cornerstone3D API (Filtered for ACTIVE viewport element)
    try {
      const cs = iframeWin && (iframeWin.cornerstone3D || iframeWin.cornerstone || iframeWin.cornerstoneCore);
      if (cs && typeof cs.getRenderingEngines === 'function') {
        const engines = cs.getRenderingEngines();
        let bestCSResult = null;
        let highestScore = -1;

        for (const engine of engines) {
          const viewports = engine.getViewports ? engine.getViewports() : [];
          for (const vp of viewports) {
            try {
              const el = vp.element;
              if (!el || isSidebarOrThumbnail(el)) continue;

              const activeFlag = isElementActive(el);
              const score = (activeFlag ? 1000000 : 0) + (ohifActiveVpId && (vp.id === ohifActiveVpId || vp.viewportId === ohifActiveVpId) ? 5000000 : 0);

              let idx = null;
              try {
                if (typeof vp.getCurrentImageIdIndex === 'function') idx = vp.getCurrentImageIdIndex();
                else if (typeof vp.getSliceIndex === 'function') idx = vp.getSliceIndex();
                else if (typeof vp.sliceIndex === 'number') idx = vp.sliceIndex;
              } catch (e) { /* ignore */ }

              const imageIds = typeof vp.getImageIds === 'function' ? vp.getImageIds() : [];

              if (idx !== null && idx >= 0 && imageIds && imageIds.length > 0) {
                const imgId = imageIds[idx] || imageIds[0] || '';
                let foundSeries = null;

                const seriesUidMatch = imgId.match(/series\/([a-zA-Z0-9._-]+)/i) || imgId.match(/seriesInstanceUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/seriesUID=([a-zA-Z0-9._-]+)/i);
                if (seriesUidMatch) {
                  const uid = seriesUidMatch[1];
                  foundSeries = studySeriesList.find(s =>
                    String(s.series_instance_uid) === String(uid) ||
                    String(s.series_id) === String(uid) ||
                    String(s.orthanc_series_id) === String(uid)
                  );
                }

                if (!foundSeries && cs.metaData && typeof cs.metaData.get === 'function') {
                  try {
                    const seriesMod = cs.metaData.get('generalSeriesModule', imgId) || cs.metaData.get('seriesModule', imgId);
                    if (seriesMod) {
                      const metaUid = seriesMod.seriesInstanceUID || seriesMod.seriesInstanceUid;
                      if (metaUid) {
                        foundSeries = studySeriesList.find(s =>
                          String(s.series_instance_uid) === String(metaUid) ||
                          String(s.series_id) === String(metaUid) ||
                          String(s.orthanc_series_id) === String(metaUid)
                        );
                      }
                      if (!foundSeries && (seriesMod.seriesDescription || seriesMod.seriesDesc)) {
                        const sDesc = seriesMod.seriesDescription || seriesMod.seriesDesc;
                        foundSeries = studySeriesList.find(s => s.series_description === sDesc);
                      }
                    }
                  } catch (e) { /* ignore */ }
                }

                let windowCenter = null;
                let windowWidth = null;
                try {
                  if (typeof vp.getProperties === 'function') {
                    const props = vp.getProperties();
                    if (props && props.voiRange) {
                      windowWidth = props.voiRange.upper - props.voiRange.lower;
                      windowCenter = (props.voiRange.upper + props.voiRange.lower) / 2;
                    }
                  }
                } catch (e) { /* ignore */ }

                if (score > highestScore) {
                  highestScore = score;
                  const targetSop = (foundSeries && foundSeries.instances && foundSeries.instances[idx]) ? (foundSeries.instances[idx].sop_instance_uid || foundSeries.instances[idx].instance_id) : null;
                  bestCSResult = {
                    instanceNumber: idx + 1,
                    sliceNumber: idx + 1,
                    totalSlices: imageIds.length || (foundSeries?.total_slices) || null,
                    seriesInstanceUid: foundSeries ? (foundSeries.series_instance_uid || foundSeries.series_id) : null,
                    matchedSeriesId: foundSeries ? (foundSeries.series_id || foundSeries.orthanc_series_id || foundSeries.series_instance_uid) : null,
                    seriesDescription: foundSeries ? foundSeries.series_description : null,
                    modality: foundSeries?.modality || "CT",
                    sopInstanceUid: targetSop || null,
                    windowCenter,
                    windowWidth,
                    activeCanvas: el?.querySelector('canvas') || el
                  };
                }
              }
            } catch (e) { /* ignore */ }
          }
        }

        if (bestCSResult && highestScore > 0) {
          console.log("✅ [VIEWERBRIDGE] Strategy 1 (Cornerstone3D API) -> Matched active series:", bestCSResult.seriesDescription || bestCSResult.matchedSeriesId, "slice:", bestCSResult.sliceNumber);
          return bestCSResult;
        }
      }
    } catch (e) { /* ignore CS3D */ }

    // STRATEGY 2: DOM Text Overlay Inspection strictly inside ACTIVE viewport container
    let activeContainer = null;
    if (iframeDoc._lastActiveViewport && !isSidebarOrThumbnail(iframeDoc._lastActiveViewport)) {
      activeContainer = iframeDoc._lastActiveViewport;
    } else if (iframeDoc._lastActiveCanvas && !isSidebarOrThumbnail(iframeDoc._lastActiveCanvas)) {
      activeContainer = iframeDoc._lastActiveCanvas.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"]');
    }

    if (!activeContainer) {
      const allViewportContainers = Array.from(iframeDoc.querySelectorAll(
        '.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"], div[class*="viewport"], div[class*="Viewport"]'
      )).filter(el => !isSidebarOrThumbnail(el) && (el.querySelector('canvas') || el.clientHeight > 100));

      const activeCandidate = allViewportContainers.find(el => isElementActive(el));
      if (activeCandidate) activeContainer = activeCandidate;
      else if (allViewportContainers.length > 0) activeContainer = allViewportContainers[0];
    }

    if (activeContainer && activeContainer.tagName === 'CANVAS') {
      activeContainer = activeContainer.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"]');
    }

    if (!activeContainer || isSidebarOrThumbnail(activeContainer)) return null;

    // Collect text ONLY from the activeContainer (DO NOT search bodyEl / sidebar!)
    const activeTexts = [];
    const isDemographicOrDate = (str) => {
      if (!str) return true;
      const s = str.trim();
      if (/^\d{1,2}[Yy]\s*\/\s*[MFmf]$/.test(s)) return true;
      if (/^\d{1,2}\s*[A-Za-z]{3}\s*\d{4}$/.test(s)) return true;
      if (/^(ID|ACC|PID|Patient)\s*:\s*/i.test(s)) return true;
      if (/\bkey image\b/i.test(s) || /attached to report/i.test(s) || /cite in report/i.test(s)) return true;
      return false;
    };

    const tw = iframeDoc.createTreeWalker(activeContainer, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
        const val = node.nodeValue ? node.nodeValue.trim() : '';
        if (isDemographicOrDate(val)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    let tn;
    while ((tn = tw.nextNode())) {
      const v = tn.nodeValue && tn.nodeValue.trim();
      if (v && v.length > 0 && v.length <= 150) activeTexts.push(v);
    }

    // 1. Direct Series Description Matching from active viewport visible text nodes
    let matchedSeriesObj = null;
    if (Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      for (const s of studySeriesList) {
        if (!s.series_description) continue;
        const cleanDesc = String(s.series_description).trim().toLowerCase();
        if (!cleanDesc) continue;
        const matchesActive = activeTexts.some(txt => {
          const tNorm = String(txt).trim().toLowerCase();
          return tNorm === cleanDesc || (cleanDesc.length >= 3 && tNorm.includes(cleanDesc));
        });
        if (matchesActive) {
          matchedSeriesObj = s;
          break;
        }
      }
    }

    // Dynamic Series Description regex extraction if studySeriesList match wasn't found
    let dynamicSeriesDesc = null;
    if (!matchedSeriesObj) {
      for (const txt of activeTexts) {
        const clean = txt.trim();
        if (/^[A-Za-z0-9][A-Za-z0-9\s._\-/\\]{2,60}$/.test(clean) && !/^(CT|MR|US|CR|DX|XA|W:|L:|I:|\d+)/i.test(clean)) {
          dynamicSeriesDesc = clean;
          break;
        }
      }
    }

    // 2. Parse Slice Number and Total Slices strictly from activeTexts or activeContainer.textContent
    const containerText = activeContainer.textContent || activeContainer.innerText || '';
    const searchStrings = [...activeTexts, containerText];
    let sliceNumber = null;
    let totalSlices = null;
    let instanceNumber = null;

    for (const val of searchStrings) {
      if (isDemographicOrDate(val)) continue;

      // Pattern 0A: "I: 134 190/223", "I:173 (51/223)", "Im: 134 190/223", "I: 134 (190/223)"
      let m = val.match(/(?:I|Im|Instance|Image)\s*:?\s*(\d+)\s*\(?\s*(\d+)\s*\/\s*(\d+)\s*\)?/i);
      if (m) {
        instanceNumber = parseInt(m[1], 10);
        sliceNumber = parseInt(m[2], 10);
        totalSlices = parseInt(m[3], 10);
        break;
      }

      // Pattern 0B: "(39/245)", " ( 190 / 223 ) "
      m = val.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
      if (m) {
        sliceNumber = parseInt(m[1], 10);
        totalSlices = parseInt(m[2], 10);
        break;
      }

      // Pattern 1: "Slice 39 of 245", "Image 190 of 223"
      m = val.match(/(?:slice|image|im|frame|sl)\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i);
      if (m) {
        sliceNumber = parseInt(m[1], 10);
        totalSlices = parseInt(m[2], 10);
        break;
      }

      // Pattern 2: Standalone "190/223" or "1/1"
      m = val.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        sliceNumber = parseInt(m[1], 10);
        totalSlices = parseInt(m[2], 10);
        break;
      }
    }

    if (!matchedSeriesObj && totalSlices && Array.isArray(studySeriesList)) {
      const countCandidates = studySeriesList.filter(s =>
        parseInt(s.total_slices, 10) === totalSlices ||
        (Array.isArray(s.instances) && s.instances.length === totalSlices)
      );
      if (countCandidates.length === 1) {
        matchedSeriesObj = countCandidates[0];
      }
    }

    if (sliceNumber || matchedSeriesObj || dynamicSeriesDesc) {
      console.log("✅ [VIEWERBRIDGE] Strategy 2 (Active DOM Overlay) -> Matched active series:", matchedSeriesObj?.series_description || dynamicSeriesDesc || "NONE", "slice:", sliceNumber);
      return {
        instanceNumber: instanceNumber || sliceNumber || 1,
        sliceNumber: sliceNumber || 1,
        totalSlices: totalSlices || matchedSeriesObj?.total_slices || 1,
        matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
        seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : (dynamicSeriesDesc || "Diagnostic Viewport"),
        activeCanvas: activeContainer.querySelector('canvas') || iframeDoc._lastActiveCanvas || null
      };
    }

  } catch (e) {
    console.warn('[ViewerBridge] detectViewportSliceInfoFromDOM exception:', e);
  }
  return null;
}

/**
 * Find a matching series from the study series list.
 * Attempts multiple matching strategies with fallback priorities.
 */
export function findSeriesInList(studySeriesList = [], target, hintSliceNum = null, hintTotalSlices = null, hintActiveSeriesId = null) {
  if (!Array.isArray(studySeriesList) || studySeriesList.length === 0) {
    return target ? { series_id: 'synthetic', series_description: String(target), total_slices: hintTotalSlices || 1 } : null;
  }

  const isScout = (s) => /topogram|localizer|scout|survey|plan|planner|positioning|loc/i.test(s?.series_description || s?.seriesDescription || '');

  const cleanTarget = String(target || '').trim();
  const normalize = (str) => String(str || '').toLowerCase().replace(/[\s_\-/\\,.:;]+/g, ' ').trim();
  const normTarget = normalize(cleanTarget);

  const getSliceCount = (s) => parseInt(s?.total_slices || s?.totalSlices || (Array.isArray(s?.instances) ? s.instances.length : 0) || 0, 10);

  let found = null;

  if (cleanTarget) {
    // 1. Direct ID / UID / Orthanc Series ID / Instance ID equality across full studySeriesList
    found = studySeriesList.find(s => 
      String(s.series_id) === cleanTarget ||
      String(s.series_instance_uid) === cleanTarget ||
      String(s.orthanc_series_id) === cleanTarget ||
      (Array.isArray(s.instances) && s.instances.some(inst => 
        String(inst.sop_instance_uid) === cleanTarget || 
        String(inst.orthanc_instance_id) === cleanTarget || 
        String(inst.id) === cleanTarget
      ))
    );
    if (found) return found;

    // 2. Exact Series Description Equality across full studySeriesList
    found = studySeriesList.find(s => (s.series_description || s.seriesDescription) && normalize(s.series_description || s.seriesDescription) === normTarget);
    if (found) return found;

    // 3. Parse Series Number (e.g. "S:15 - i_AASpine_Scout", "Series 15", "S15", "15")
    const sNumMatch = cleanTarget.match(/(?:S:|Series\s*|S:?)\s*(\d+)/i) || (cleanTarget.length <= 4 && cleanTarget.match(/^(\d+)$/));
    if (sNumMatch) {
      const sNum = parseInt(sNumMatch[1], 10);
      found = studySeriesList.find(s => parseInt(s.series_number, 10) === sNum || parseInt(s.series_id, 10) === sNum);
      if (found) return found;
    }
  }

  // Filter candidates by slice count hints for fuzzy token matching
  let candidates = [...studySeriesList];
  if (hintTotalSlices && hintTotalSlices > 1) {
    const matchingCount = studySeriesList.filter(s => getSliceCount(s) === parseInt(hintTotalSlices, 10));
    if (matchingCount.length > 0) {
      candidates = matchingCount;
    } else {
      candidates = studySeriesList.filter(s => getSliceCount(s) > 1);
    }
  } else if (hintSliceNum && hintSliceNum > 1) {
    candidates = studySeriesList.filter(s => getSliceCount(s) >= hintSliceNum);
  }
  if (candidates.length === 0) candidates = [...studySeriesList];

  // Sort candidates by slice count descending (diagnostic main series first)
  candidates.sort((a, b) => getSliceCount(b) - getSliceCount(a));

  if (!cleanTarget) {
    if (hintActiveSeriesId) {
      const activeMatch = candidates.find(s => 
        String(s.series_id) === String(hintActiveSeriesId) ||
        String(s.series_instance_uid) === String(hintActiveSeriesId) ||
        String(s.orthanc_series_id) === String(hintActiveSeriesId)
      );
      if (activeMatch) return activeMatch;
    }
    const nonScout = candidates.filter(s => !isScout(s));
    return nonScout.length > 0 ? nonScout[0] : candidates[0];
  }

  // 4. Substring match on normalized series_description
  found = candidates.find(s => {
    const desc = s.series_description || s.seriesDescription;
    if (!desc) return false;
    const normDesc = normalize(desc);
    return normTarget.includes(normDesc) || normDesc.includes(normTarget);
  });
  if (found) return found;

  // 5. Match by token overlap
  const targetTokens = normTarget.split(' ').filter(t => t.length >= 2 && !/^(s|\d+)$/.test(t));
  if (targetTokens.length > 0) {
    let bestMatch = null;
    let maxTokens = 0;
    for (const s of candidates) {
      const desc = s.series_description || s.seriesDescription;
      if (!desc) continue;
      const sDescNorm = normalize(desc);
      const matches = targetTokens.filter(t => sDescNorm.includes(t)).length;
      if (matches > maxTokens) {
        maxTokens = matches;
        bestMatch = s;
      }
    }
    if (bestMatch && maxTokens > 0) return bestMatch;
  }

  // 6. Fallback to first non-scout candidate in real studySeriesList (sorted by slice count desc)
  const nonScout = candidates.filter(s => !isScout(s));
  if (nonScout.length > 0) return nonScout[0];
  if (candidates.length > 0) return candidates[0];

  // 7. Synthetic series ONLY if studySeriesList is completely empty
  if (cleanTarget && cleanTarget.length >= 2) {
    return {
      series_id: 'synthetic_desc',
      series_description: cleanTarget,
      total_slices: hintTotalSlices || 1
    };
  }

  return null;
}

/**
 * Trigger active viewer viewport capture from parent window to iframe.
 * Uses OHIF PostMessage State Bridge to query active viewport directly.
 * 
 * @param {string|Element} iframeSelector - CSS selector or iframe element
 * @param {Array} studySeriesList - Available study series for matching
 * @returns {Promise} Resolves to viewport snapshot result
 */
export async function requestViewerSnapshot(iframeSelector = 'iframe', studySeriesList = []) {
  console.log("📸 [ViewerBridge] Requesting viewer snapshot via PostMessage bridge...");
  return new Promise((resolve) => {
    const iframeEl = typeof iframeSelector === 'string' ? document.querySelector(iframeSelector) : iframeSelector;
    if (!iframeEl || !iframeEl.contentWindow) {
      console.warn("⚠️ [ViewerBridge] No iframe element found.");
      return resolve({ status: "failed", reason: "No iframe found" });
    }

    const listener = (event) => {
      // Validate origin of response
      if (!validateOrigin(event)) {
        console.warn(`⚠️ [ViewerBridge] Snapshot response from unauthorized origin: ${event.origin}`);
        return;
      }

      if (event.data && event.data.type === 'OHIF_VIEWPORT_STATE') {
        window.removeEventListener('message', listener);
        
        if (event.data.error) {
          console.warn("⚠️ [ViewerBridge] OHIF returned state error:", event.data.error);
          return resolve({ status: "failed", reason: event.data.error });
        }

        const ohifData = event.data;
        console.log("✅ [ViewerBridge] OHIF_VIEWPORT_STATE received:", ohifData);

        let matchedSeriesObj = (studySeriesList || []).find(s => 
          String(s.series_instance_uid) === String(ohifData.seriesInstanceUID) ||
          String(s.series_id) === String(ohifData.seriesInstanceUID) ||
          String(s.orthanc_series_id) === String(ohifData.seriesInstanceUID)
        );

        if (!matchedSeriesObj && ohifData.seriesDescription && Array.isArray(studySeriesList)) {
          matchedSeriesObj = studySeriesList.find(s => 
            s.series_description && String(s.series_description).trim().toLowerCase() === String(ohifData.seriesDescription).trim().toLowerCase()
          );
        }

        const result = {
          status: "success",
          matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : ohifData.seriesInstanceUID,
          seriesInstanceUid: ohifData.seriesInstanceUID || (matchedSeriesObj ? matchedSeriesObj.series_instance_uid : null),
          seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : ohifData.seriesDescription,
          sliceNumber: ohifData.sliceNumber || 1,
          totalSlices: ohifData.totalSlices || 1,
          sopInstanceUid: ohifData.sopInstanceUid || null,
          modality: ohifData.modality || "CT",
          timestamp: Date.now()
        };
        console.log("✅ [ViewerBridge] Resolved snapshot result:", result);
        resolve(result);
      }
    };

    window.addEventListener('message', listener);
    
    try {
      // Use explicit targetOrigin (iframe's origin) for security
      iframeEl.contentWindow.postMessage(
        { type: 'OHIF_GET_ACTIVE_VIEWPORT' }, 
        iframeEl.src ? new URL(iframeEl.src).origin : window.location.origin
      );
    } catch (e) {
      console.warn("⚠️ [ViewerBridge] postMessage failed:", e);
    }

    // Timeout after 2 seconds
    setTimeout(() => {
      window.removeEventListener('message', listener);
      console.warn("⏱️ [ViewerBridge] OHIF postMessage timeout after 2000ms");
      resolve({ status: "failed", reason: "OHIF timeout" });
    }, 2000);
  });
}
