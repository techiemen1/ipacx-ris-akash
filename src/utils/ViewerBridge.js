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

  // Allow internal LAN origins (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const isLanOrigin = /^http:\/\/(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(event.origin);
  if (isLanOrigin) return true;

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
export function detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList = [], hintSeriesId = null) {
  if (!iframeDoc) return null;

  try {
    const bodyEl = iframeDoc.body || iframeDoc;
    const iframeWin = iframeDoc.defaultView || iframeDoc.parentWindow;

    const isSidebarOrThumbnail = (el) => {
      if (!el) return false;
      try {
        return !!(el.closest && el.closest('.study-browser, .thumbnail-list, .sidebar, .study-list, .series-quick-switch, nav, header, [class*="thumbnail"], [class*="Thumbnail"], [class*="SeriesItem"], [class*="sidebar"], [class*="Sidebar"], [class*="StudyBrowser"], [data-cy*="study-browser"], [data-cy*="thumbnail"]'));
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
          const vpEl = target.closest ? target.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"], div[class*="viewport"], div[class*="Viewport"]') : null;
          if (vpEl && !isSidebarOrThumbnail(vpEl)) iframeDoc._lastActiveViewport = vpEl;
        } catch (e) {
          /* ignore interaction tracking error */
        }
      };
      iframeDoc.addEventListener('pointerdown', markActive, true);
      iframeDoc.addEventListener('mousedown', markActive, true);
      iframeDoc.addEventListener('wheel', markActive, true);
    }

    // STRATEGY 0: OHIF v3 Services Manager (PRIMARY & MOST ACCURATE for OHIF Viewer)
    try {
      const sm = iframeWin && (iframeWin.servicesManager || (iframeWin.ohif && iframeWin.ohif.servicesManager) || (iframeWin.ohifApp && iframeWin.ohifApp.servicesManager));
      if (sm && sm.services && sm.services.viewportGridService) {
        const vpgs = sm.services.viewportGridService;
        const cvps = sm.services.cornerstoneViewportService;
        const dss = sm.services.displaySetService;

        const gridState = typeof vpgs.getState === 'function' ? vpgs.getState() : null;
        const activeVpId = (gridState && gridState.activeViewportId) || (typeof vpgs.getActiveViewportId === 'function' ? vpgs.getActiveViewportId() : null);

        if (activeVpId) {
          let csSlice = null;
          let csTotal = null;
          let csvp = null;
          let windowCenter = null;
          let windowWidth = null;

          if (cvps && typeof cvps.getCornerstoneViewport === 'function') {
            try {
              csvp = cvps.getCornerstoneViewport(activeVpId);
              if (csvp) {
                let idx = null;
                try {
                  if (typeof csvp.getCurrentImageIdIndex === 'function') {
                    idx = csvp.getCurrentImageIdIndex();
                  } else if (typeof csvp.getSliceIndex === 'function') {
                    idx = csvp.getSliceIndex();
                  } else if (typeof csvp.sliceIndex === 'number') {
                    idx = csvp.sliceIndex;
                  }
                } catch (e) {
                  if (typeof csvp.getSliceIndex === 'function') {
                    try { idx = csvp.getSliceIndex(); } catch (e2) { /* ignore sliceIndex error */ }
                  }
                }
                try {
                  if (typeof csvp.getProperties === 'function') {
                    const props = csvp.getProperties();
                    if (props && props.voiRange) {
                      windowWidth = props.voiRange.upper - props.voiRange.lower;
                      windowCenter = (props.voiRange.upper + props.voiRange.lower) / 2;
                    }
                  } else if (typeof csvp.getVOILUT === 'function') {
                    const voi = csvp.getVOILUT();
                    windowCenter = voi?.windowCenter;
                    windowWidth = voi?.windowWidth;
                  }
                } catch (e) {
                  /* ignore VOI LUT error */
                }

                const ids = typeof csvp.getImageIds === 'function' ? csvp.getImageIds() : [];
                if (idx !== null && idx >= 0) {
                  csSlice = idx + 1;
                  csTotal = ids ? ids.length : null;
                }
              }
            } catch (e) {
              /* ignore csvp error */
            }
          }

          let activeVp = null;
          if (gridState && gridState.viewports) {
            const vps = gridState.viewports;
            if (typeof vps.get === 'function') activeVp = vps.get(activeVpId);
            else if (Array.isArray(vps)) activeVp = vps.find(v => v.id === activeVpId || v.viewportId === activeVpId);
            else if (typeof vps === 'object') activeVp = vps[activeVpId];
          }

          if (!activeVp && typeof vpgs.getViewport === 'function') {
            try {
              activeVp = vpgs.getViewport(activeVpId);
            } catch (e) {
              /* ignore vpgs getViewport error */
            }
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
            matchedSeriesObj = studySeriesList.find(s => s.series_description === seriesDesc);
          }

          const activeCanvas = csvp?.element?.querySelector('canvas') || null;

          if (csSlice || seriesUid || seriesDesc) {
            console.log('[ViewerBridge] Strategy 0 (OHIF Services) -> slice:', csSlice, '/', csTotal, '| series:', seriesDesc || seriesUid);
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
      }
    } catch (e) { /* skip Strategy 0 */ }

    // STRATEGY 1: Cornerstone3D JavaScript API (Direct, 100% exact slice & series UID)
    try {
      const cs = iframeWin && (iframeWin.cornerstone3D || iframeWin.cornerstone || iframeWin.cornerstoneCore);
      if (cs && typeof cs.getRenderingEngines === 'function') {
        const engines = cs.getRenderingEngines();
        let bestCSResult = null;
        let highestPriority = -1;

        for (const engine of engines) {
          const viewports = engine.getViewports ? engine.getViewports() : [];
          for (const vp of viewports) {
            try {
              const el = vp.element;
              if (!el || isSidebarOrThumbnail(el)) continue;

              let idx = null;
              try {
                if (typeof vp.getCurrentImageIdIndex === 'function') {
                  idx = vp.getCurrentImageIdIndex();
                } else if (typeof vp.getSliceIndex === 'function') {
                  idx = vp.getSliceIndex();
                } else if (typeof vp.sliceIndex === 'number') {
                  idx = vp.sliceIndex;
                }
              } catch (e) {
                if (typeof vp.getSliceIndex === 'function') {
                  try { idx = vp.getSliceIndex(); } catch (e2) { /* ignore sliceIndex error */ }
                }
              }

              const imageIds = typeof vp.getImageIds === 'function' ? vp.getImageIds() : [];

              if (idx !== null && idx >= 0 && imageIds && imageIds.length > 0) {
                const imgId = imageIds[idx] || imageIds[0] || '';
                let foundSeries = null;

                // 1. Match series UID from URL regex
                const seriesUidMatch = imgId.match(/series\/([a-zA-Z0-9._-]+)/i) || imgId.match(/seriesInstanceUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/seriesUID=([a-zA-Z0-9._-]+)/i);
                if (seriesUidMatch) {
                  const uid = seriesUidMatch[1];
                  foundSeries = studySeriesList.find(s =>
                    String(s.series_instance_uid) === String(uid) ||
                    String(s.series_id) === String(uid) ||
                    String(s.orthanc_series_id) === String(uid)
                  );
                }

                // 2. Check Cornerstone3D metaData module
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
                  } catch (e) { /* ignore metaData error */ }
                }

                // 3. Match instance ID from URL against studySeriesList.instances
                if (!foundSeries) {
                  const instIdMatch = imgId.match(/instances\/([a-zA-Z0-9._-]+)/i) || imgId.match(/sopInstanceUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/objectUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/instanceUID=([a-zA-Z0-9._-]+)/i);
                  if (instIdMatch) {
                    const instId = instIdMatch[1];
                    foundSeries = studySeriesList.find(s =>
                      Array.isArray(s.instances) && s.instances.some(inst =>
                        String(inst.id) === String(instId) ||
                        String(inst.instance_id) === String(instId) ||
                        String(inst.sop_instance_uid) === String(instId) ||
                        String(inst.orthanc_instance_id) === String(instId)
                      )
                    );
                  }
                }

                // Extract VOI LUT (Window Center / Window Width) if available
                let windowCenter = null;
                let windowWidth = null;
                try {
                  if (typeof vp.getProperties === 'function') {
                    const props = vp.getProperties();
                    if (props && props.voiRange) {
                      windowWidth = props.voiRange.upper - props.voiRange.lower;
                      windowCenter = (props.voiRange.upper + props.voiRange.lower) / 2;
                    }
                  } else if (typeof vp.getVOILUT === 'function') {
                    const voi = vp.getVOILUT();
                    windowCenter = voi?.windowCenter;
                    windowWidth = voi?.windowWidth;
                  }
                } catch (e) {
                  /* ignore VOI LUT error */
                }

                const isLastActive = (
                  el === iframeDoc._lastActiveViewport ||
                  el === iframeDoc._lastActiveCanvas ||
                  (iframeDoc._lastActiveCanvas && el.contains(iframeDoc._lastActiveCanvas))
                );

                const isVpActive = el && (
                  isLastActive ||
                  el.classList.contains('active') ||
                  el.closest('.active') ||
                  el.classList.contains('selected') ||
                  el.classList.contains('border-primary') ||
                  el.getAttribute('data-active') === 'true'
                );

                const priority = (isLastActive ? 1000000 : 0) + (isVpActive ? 100000 : 0) + (idx > 0 ? 500 : 0) + (imageIds.length > 1 ? 50 : 0);
                if (priority > highestPriority) {
                  highestPriority = priority;
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
            } catch (e) { /* ignore viewport error */ }
          }
        }

        if (bestCSResult && (highestPriority >= 50 || bestCSResult.sliceNumber > 0)) {
          console.log('[ViewerBridge] Strategy 1 (Cornerstone3D API) -> slice:', bestCSResult.sliceNumber, '/', bestCSResult.totalSlices, '| series:', bestCSResult.seriesDescription || bestCSResult.matchedSeriesId);
          return bestCSResult;
        }
      }
    } catch (e) { /* ignore CS3D */ }

    // STRATEGY 0: OHIF v3 Services Manager (Fallback)
    try {
      const sm = iframeWin && (iframeWin.servicesManager || (iframeWin.ohif && iframeWin.ohif.servicesManager) || (iframeWin.ohifApp && iframeWin.ohifApp.servicesManager));
      if (sm && sm.services && sm.services.viewportGridService) {
        const vpgs = sm.services.viewportGridService;
        const cvps = sm.services.cornerstoneViewportService;
        const dss = sm.services.displaySetService;

        const gridState = typeof vpgs.getState === 'function' ? vpgs.getState() : null;
        const activeVpId = (gridState && gridState.activeViewportId) || (typeof vpgs.getActiveViewportId === 'function' ? vpgs.getActiveViewportId() : null);

        if (activeVpId) {
          let csSlice = null;
          let csTotal = null;
          let csvp = null;

          if (cvps && typeof cvps.getCornerstoneViewport === 'function') {
            try {
              csvp = cvps.getCornerstoneViewport(activeVpId);
              if (csvp) {
                let idx = null;
                try {
                  if (typeof csvp.getCurrentImageIdIndex === 'function') {
                    idx = csvp.getCurrentImageIdIndex();
                  } else if (typeof csvp.getSliceIndex === 'function') {
                    idx = csvp.getSliceIndex();
                  } else if (typeof csvp.sliceIndex === 'number') {
                    idx = csvp.sliceIndex;
                  }
                } catch (e) {
                  if (typeof csvp.getSliceIndex === 'function') {
                    try { idx = csvp.getSliceIndex(); } catch (e2) { /* ignore sliceIndex error */ }
                  }
                }
                const ids = typeof csvp.getImageIds === 'function' ? csvp.getImageIds() : [];
                if (idx !== null && idx >= 0) {
                  csSlice = idx + 1;
                  csTotal = ids ? ids.length : null;
                }
              }
            } catch (e) {
              /* ignore csvp error */
            }
          }

          let activeVp = null;
          if (gridState && gridState.viewports) {
            const vps = gridState.viewports;
            if (typeof vps.get === 'function') activeVp = vps.get(activeVpId);
            else if (Array.isArray(vps)) activeVp = vps.find(v => v.id === activeVpId || v.viewportId === activeVpId);
            else if (typeof vps === 'object') activeVp = vps[activeVpId];
          }

          if (!activeVp && typeof vpgs.getViewport === 'function') {
            try {
              activeVp = vpgs.getViewport(activeVpId);
            } catch (e) {
              /* ignore vpgs getViewport error */
            }
          }

          const dsUid = activeVp ? (activeVp.displaySetInstanceUID || (Array.isArray(activeVp.displaySetInstanceUIDs) ? activeVp.displaySetInstanceUIDs[0] : null)) : null;
          const ds = (dss && dsUid && typeof dss.getDisplaySetByUID === 'function') ? dss.getDisplaySetByUID(dsUid) : null;

          const seriesUid = ds ? (ds.SeriesInstanceUID || ds.seriesInstanceUid) : null;
          const seriesDesc = ds ? (ds.SeriesDescription || ds.seriesDescription) : null;
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
            matchedSeriesObj = studySeriesList.find(s => s.series_description === seriesDesc);
          }

          if (csSlice || seriesUid || seriesDesc) {
            console.log('[ViewerBridge] Strategy 0 (OHIF Services) -> slice:', csSlice, '/', csTotal, '| series:', seriesDesc || seriesUid);
            return {
              instanceNumber: csSlice || null,
              sliceNumber: csSlice || null,
              totalSlices: csTotal || ds?.numImageFrames || matchedSeriesObj?.total_slices || null,
              matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : seriesUid,
              seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : seriesDesc,
              sopInstanceUid: sopUid || null,
              activeCanvas: csvp?.element?.querySelector('canvas') || null
            };
          }
        }
      }
    } catch (e) { /* skip Strategy 0 */ }

    // STRATEGY 2: DOM Text Overlay Parsing (Hybrid DOM Inspection)
    let activeContainer = null;
    if (iframeDoc._lastActiveViewport && !isSidebarOrThumbnail(iframeDoc._lastActiveViewport)) {
      activeContainer = iframeDoc._lastActiveViewport;
    } else if (iframeDoc._lastActiveCanvas && !isSidebarOrThumbnail(iframeDoc._lastActiveCanvas)) {
      activeContainer = iframeDoc._lastActiveCanvas.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"], div[class*="viewport"], div[class*="Viewport"]') || iframeDoc._lastActiveCanvas.parentElement;
    }

    if (!activeContainer) {
      const activeCandidates = Array.from(iframeDoc.querySelectorAll(
        '.viewport-element.active, .viewport-wrapper.active, [data-viewport-uid].active, .cornerstone-canvas-wrapper.active, .viewport-container.active, .viewport-grid-item.active, .active-viewport, .viewport-element.selected, .viewport-wrapper.selected, [data-cy="viewport-container"][data-active="true"], [data-cy="viewport-container"].active, [data-cy="viewport-container"].border-primary, div[class*="border-primary"]'
      )).filter(el => {
        return !isSidebarOrThumbnail(el) && (el.querySelector('canvas') || el.classList.contains('viewport-element') || el.classList.contains('viewport-wrapper'));
      });

      if (activeCandidates.length > 0) activeContainer = activeCandidates[0];
    }

    if (!activeContainer || isSidebarOrThumbnail(activeContainer)) {
      const canvases = Array.from(iframeDoc.querySelectorAll('canvas'))
        .filter(c => !isSidebarOrThumbnail(c))
        .map(c => ({
          c,
          area: (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0),
          container: c.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"], div[class*="viewport"], div[class*="Viewport"]') || c.parentElement
        }))
        .filter(({ area, container }) => area > 5000 && !isSidebarOrThumbnail(container))
        .sort((a, b) => b.area - a.area);

      if (canvases.length > 0) activeContainer = canvases[0].container || canvases[0].c.parentElement;
    }

    if (activeContainer && activeContainer.tagName === 'CANVAS') {
      activeContainer = activeContainer.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"], div[class*="viewport"], div[class*="Viewport"]') || activeContainer.parentElement;
    }

    const activeTexts = [];
    const globalTexts = [];

    const isDemographicOrDate = (str) => {
      if (!str) return true;
      const s = str.trim();
      if (/^\d{1,2}[Yy]\s*\/\s*[MFmf]$/.test(s)) return true;
      if (/^\d{1,2}\s*[A-Za-z]{3}\s*\d{4}$/.test(s)) return true;
      if (/^(ID|ACC|PID|Patient)\s*:\s*/i.test(s)) return true;
      if (/\bkey image\b/i.test(s) || /attached to report/i.test(s) || /cite in report/i.test(s)) return true;
      return false;
    };

    const collectFromNode = (root, targetArray) => {
      if (!root) return;
      const tw = iframeDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
          if (root !== activeContainer && (isSidebarOrThumbnail(node.parentElement) || node.parentElement.closest('.key-images, .rs-print-key-images, [class*="key-image"]'))) {
            return NodeFilter.FILTER_REJECT;
          }
          const val = node.nodeValue ? node.nodeValue.trim() : '';
          if (isDemographicOrDate(val)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }, false);
      let tn;
      while ((tn = tw.nextNode())) {
        const v = tn.nodeValue && tn.nodeValue.trim();
        if (v && v.length > 0 && v.length <= 150) targetArray.push(v);
      }
    };

    if (activeContainer) collectFromNode(activeContainer, activeTexts);
    collectFromNode(bodyEl, globalTexts);

    // 1. Direct Series Description Matching from active viewport visible text nodes
    let matchedSeriesObj = null;
    if (Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      for (const s of studySeriesList) {
        if (!s.series_description) continue;
        const cleanDesc = String(s.series_description).trim().toLowerCase();
        if (!cleanDesc) continue;
        const matchesActive = activeTexts.some(txt => {
          const tNorm = String(txt).trim().toLowerCase();
          return tNorm === cleanDesc || (cleanDesc.length >= 4 && tNorm.includes(cleanDesc));
        });
        if (matchesActive) {
          matchedSeriesObj = s;
          break;
        }
      }
    }

    // 2. Parse Slice Number and Total Slices from activeTexts AND activeContainer.textContent
    const parseSliceCandidates = (textList, containerText = '', basePriority = 100) => {
      const candidates = [];
      
      const searchStrings = [...textList];
      if (containerText) searchStrings.push(containerText);

      for (const val of searchStrings) {
        if (isDemographicOrDate(val)) continue;

        // Pattern 0A: "I: 134 190/223", "I:173 (51/223)", "Im: 134 190/223", "I: 134 (190/223)"
        let m = val.match(/(?:I|Im|Instance|Image)\s*:?\s*(\d+)\s*\(?\s*(\d+)\s*\/\s*(\d+)\s*\)?/i);
        if (m) {
          const instNum = parseInt(m[1], 10);
          const sn = parseInt(m[2], 10);
          const tn2 = parseInt(m[3], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, instanceNumber: instNum, text: val, priority: basePriority + 400 });
            continue;
          }
        }

        // Pattern 0B: "(39/245)", " ( 190 / 223 ) "
        m = val.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
        if (m) {
          const sn = parseInt(m[1], 10);
          const tn2 = parseInt(m[2], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, text: val, priority: basePriority + 300 });
            continue;
          }
        }

        // Pattern 1: "Slice 39 of 245", "Image 190 of 223"
        m = val.match(/(?:slice|image|im|frame|sl)\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i);
        if (m) {
          const sn = parseInt(m[1], 10);
          const tn2 = parseInt(m[2], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, text: val, priority: basePriority + 200 });
            continue;
          }
        }

        // Pattern 2: Standalone "190/223" or "190 / 223"
        m = val.match(/(\d+)\s*\/\s*(\d+)/);
        if (m) {
          const sn = parseInt(m[1], 10);
          const tn2 = parseInt(m[2], 10);
          if (sn > 0 && tn2 > 0 && sn <= tn2) {
            candidates.push({ sliceNumber: sn, totalSlices: tn2, text: val, priority: basePriority + 100 });
            continue;
          }
        }
      }
      return candidates;
    };

    const containerFullText = activeContainer ? (activeContainer.textContent || activeContainer.innerText || '') : '';
    let sliceCandidates = parseSliceCandidates(activeTexts, containerFullText, 200);
    if (sliceCandidates.length === 0) sliceCandidates = parseSliceCandidates(globalTexts, '', 100);

    sliceCandidates.sort((a, b) => b.priority - a.priority);
    const sliceResult = sliceCandidates.length > 0 ? sliceCandidates[0] : null;

    if (!matchedSeriesObj && sliceResult?.totalSlices && Array.isArray(studySeriesList)) {
      const countCandidates = studySeriesList.filter(s =>
        parseInt(s.total_slices, 10) === sliceResult.totalSlices ||
        (Array.isArray(s.instances) && s.instances.length === sliceResult.totalSlices)
      );
      if (countCandidates.length === 1) {
        matchedSeriesObj = countCandidates[0];
      }
    }

    if (!matchedSeriesObj && hintSeriesId && Array.isArray(studySeriesList)) {
      matchedSeriesObj = studySeriesList.find(s =>
        String(s.series_id) === String(hintSeriesId) ||
        String(s.series_instance_uid) === String(hintSeriesId) ||
        String(s.orthanc_series_id) === String(hintSeriesId)
      ) || null;
    }

    if (sliceResult || matchedSeriesObj) {
      console.log('[ViewerBridge] Parsed slice info -> slice:', sliceResult?.sliceNumber, '/', sliceResult?.totalSlices, '| series:', matchedSeriesObj?.series_description);
      return {
        instanceNumber: sliceResult?.instanceNumber || null,
        sliceNumber: sliceResult ? sliceResult.sliceNumber : null,
        totalSlices: sliceResult?.totalSlices || matchedSeriesObj?.total_slices || null,
        matchedSeriesId: matchedSeriesObj ? (matchedSeriesObj.series_id || matchedSeriesObj.orthanc_series_id || matchedSeriesObj.series_instance_uid) : null,
        seriesDescription: matchedSeriesObj ? matchedSeriesObj.series_description : null,
        activeCanvas: (activeContainer ? activeContainer.querySelector('canvas') : null) || iframeDoc._lastActiveCanvas || null
      };
    }

  } catch (e) {
    console.warn('[ViewerBridge] detectViewportSliceInfoFromDOM exception:', e);
  }
  return null;
}

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
 * Tries postMessage listener RPC, same-origin canvas extraction, and DOM overlay slice index detection.
 */
export async function requestViewerSnapshot(iframeSelector = 'iframe', studySeriesList = [], hintSeriesId = null) {
  console.log("🚨 [ViewerBridge] STATE: Requesting viewer snapshot...");
  const iframeEl = typeof iframeSelector === 'string' ? document.querySelector(iframeSelector) : iframeSelector;
  if (!iframeEl) {
    console.warn("🚨 [ViewerBridge] No iframe element found.");
    return { status: "failed", reason: "no iframe element" };
  }

  // FAST PATH: Check same-origin iframe directly
  try {
    const iframeWin = iframeEl.contentWindow;
    const iframeDoc = iframeEl.contentDocument || (iframeWin && iframeWin.document);
    if (iframeDoc) {
      const sliceInfo = detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList, hintSeriesId);

      let dataUrl = null;
      let activeCanvas = sliceInfo?.activeCanvas;
      if (!activeCanvas) {
        const canvases = Array.from(iframeDoc.querySelectorAll('canvas'))
          .map(c => ({ c, area: (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0) }))
          .filter(({ area }) => area > 5000)
          .sort((a, b) => b.area - a.area)
          .map(({ c }) => c);

        const lastActive = iframeDoc._lastActiveCanvas;
        const lastActiveArea = lastActive ? ((lastActive.clientWidth || lastActive.width || 0) * (lastActive.clientHeight || lastActive.height || 0)) : 0;
        const bigThreshold = canvases.length > 0 ? ((canvases[0].clientWidth || canvases[0].width || 0) * (canvases[0].clientHeight || canvases[0].height || 0)) * 0.20 : 0;
        activeCanvas = (lastActive && lastActiveArea >= bigThreshold) ? lastActive : (canvases[0] || null);
      }

      if (activeCanvas && (activeCanvas.width > 0 || activeCanvas.clientWidth > 0)) {
        try {
          if (iframeWin && iframeWin.cornerstone3D && typeof iframeWin.cornerstone3D.getRenderingEngines === 'function') {
            try {
              const engines = iframeWin.cornerstone3D.getRenderingEngines();
              for (const eng of engines) {
                if (typeof eng.render === 'function') eng.render();
              }
            } catch (e) {
              /* ignore render error */
            }
          }

          const tempCv = iframeDoc.createElement('canvas');
          const w = activeCanvas.width || activeCanvas.clientWidth || 512;
          const h = activeCanvas.height || activeCanvas.clientHeight || 512;
          tempCv.width = w;
          tempCv.height = h;
          const ctx = tempCv.getContext('2d');
          if (ctx) {
            ctx.drawImage(activeCanvas, 0, 0);
            const testUrl = tempCv.toDataURL('image/jpeg', 0.95);
            if (testUrl && testUrl.length > 1000 && !testUrl.includes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB')) {
              dataUrl = testUrl;
            }
          }
          if (!dataUrl) {
            const directUrl = activeCanvas.toDataURL('image/jpeg', 0.95);
            if (directUrl && directUrl.length > 1000) dataUrl = directUrl;
          }
        } catch (e) {
          dataUrl = null;
        }
      }

      if (sliceInfo && sliceInfo.sliceNumber && parseInt(sliceInfo.sliceNumber, 10) > 0 && sliceInfo.matchedSeriesId) {
        console.log("🚨 [ViewerBridge] FAST PATH SUCCESS:", sliceInfo);
        return {
          status: "success",
          dataUrl: (dataUrl && dataUrl.length > 1000) ? dataUrl : null,
          instanceNumber: sliceInfo.instanceNumber || sliceInfo.sliceNumber,
          sliceNumber: parseInt(sliceInfo.sliceNumber, 10),
          totalSlices: sliceInfo.totalSlices ? parseInt(sliceInfo.totalSlices, 10) : null,
          seriesInstanceUid: sliceInfo.seriesInstanceUid || sliceInfo.matchedSeriesId,
          matchedSeriesId: sliceInfo.matchedSeriesId,
          seriesDescription: sliceInfo.seriesDescription || "Diagnostic Series",
          sopInstanceUid: sliceInfo.sopInstanceUid || null,
          modality: sliceInfo.modality || "CT",
          windowCenter: sliceInfo.windowCenter || null,
          windowWidth: sliceInfo.windowWidth || null
        };
      }
    }
  } catch (e) {
    console.warn("🚨 [ViewerBridge] Cross-origin or DOM access exception:", e.message);
  }

  // FALLBACK PATH: Cross-origin postMessage RPC
  try {
    if (iframeEl && iframeEl.contentWindow) {
      iframeEl.contentWindow.postMessage({ type: MESSAGE_TYPES.REQUEST_SNAPSHOT, action: 'CAPTURE' }, '*');
      iframeEl.contentWindow.postMessage({ type: MESSAGE_TYPES.OHIF_CAPTURE_VIEWPORT, action: 'CAPTURE' }, '*');
    }
  } catch (e) {
    console.warn("🚨 [ViewerBridge] postMessage emission failed:", e.message);
  }

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
        data.eventName === 'SNAPSHOT_CAPTURED'
      ) {
        const payload = data.payload || data;
        const dUrl = payload.dataUrl || payload.imageUrl || payload.url;
        const fNum = payload.frameNumber || payload.sliceNumber || (payload.sliceIndex !== undefined ? payload.sliceIndex + 1 : null) || payload.instanceNumber;
        const tSlices = payload.totalSlices || payload.total_slices;
        const sDesc = payload.seriesDescription || payload.seriesDesc;
        const sUid = payload.seriesInstanceUid || payload.seriesInstanceUID;
        const iNum = payload.instanceNumber || payload.sopInstanceUid;

        window.removeEventListener('message', handler);
        if (sUid && fNum) {
          resolve({
            status: "success",
            dataUrl: dUrl && (dUrl.startsWith('data:image/') || dUrl.length > 500) ? dUrl : null,
            instanceNumber: iNum || null,
            sliceNumber: fNum ? parseInt(fNum, 10) : null,
            totalSlices: tSlices ? parseInt(tSlices, 10) : null,
            matchedSeriesId: sUid,
            seriesInstanceUid: sUid,
            seriesDescription: sDesc || "Diagnostic Series",
            seriesNumber: payload.seriesNumber || null
          });
        } else {
          resolve({ status: "failed", reason: "incomplete postMessage payload" });
        }
      }
    };

    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ status: "failed", reason: "postMessage timeout (cross-origin or OHIF silent)" });
    }, 400);
  });

  const postMsgRes = await waitPostMessage;
  if (postMsgRes && postMsgRes.status === "success") {
    console.log("🚨 [ViewerBridge] POSTMESSAGE PATH SUCCESS:", postMsgRes);
    return postMsgRes;
  }

  console.warn("🚨 [ViewerBridge] Snapshot failed: cross-origin or no metadata found.");
  return { status: "failed", reason: "cross-origin or no metadata" };
}
