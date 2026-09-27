/**
 * KeyImageService.js
 * FIXED: Strictly respects the activeSeriesId from the modal to prevent falling back to the wrong series.
 */

import api from "../api/axios";
import { requestViewerSnapshot, detectViewportSliceInfoFromDOM } from "../utils/ViewerBridge";
import { getViewerUrl } from "../utils/viewerUtils";

class KeyImageService {
  async captureActiveViewport(iframeSelector = "iframe", studySeriesList = [], activeSeriesId = null, fallbackSliceNum = 1) {
    let snapshotResult = null;
    let domSliceInfo = null;

    try {
      const iframeEl = typeof iframeSelector === "string" ? document.querySelector(iframeSelector) : iframeSelector;
      if (iframeEl && iframeEl.contentWindow) {
        try {
          iframeEl.contentWindow.postMessage({ type: "OHIF_CAPTURE_VIEWPORT", action: "CAPTURE" }, "*");
          iframeEl.contentWindow.postMessage({ type: "REQUEST_SNAPSHOT", action: "CAPTURE" }, "*");
        } catch (e) {
          console.warn("[KeyImageService] PostMessage trigger notice:", e.message);
        }

        try {
          const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
          if (iframeDoc) {
            domSliceInfo = detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList);
          }
        } catch (e) {
          console.warn("[KeyImageService] Direct DOM inspection notice:", e.message);
        }
      }
    } catch (e) {
      console.warn("[KeyImageService] Iframe query notice:", e.message);
    }

    snapshotResult = await requestViewerSnapshot(iframeSelector, studySeriesList);

    // ==========================================
    // FIXED SERIES RESOLUTION LOGIC
    // ==========================================
    let seriesObj = null;
    
    if (Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      // PRIORITY 1: Strictly use the activeSeriesId passed from the modal if it exists
      if (activeSeriesId) {
        seriesObj = studySeriesList.find(s => 
          String(s.series_id) === String(activeSeriesId) ||
          String(s.series_instance_uid) === String(activeSeriesId) ||
          String(s.orthanc_series_id) === String(activeSeriesId)
        );
      }

      // PRIORITY 2: Only trust DOM detection if it has HIGH confidence (matchedSeriesId exists AND sliceNumber is valid for that series)
      if (!seriesObj && domSliceInfo?.matchedSeriesId && domSliceInfo?.sliceNumber > 0) {
        const domSeries = studySeriesList.find(s => 
          String(s.series_id) === String(domSliceInfo.matchedSeriesId) ||
          String(s.series_instance_uid) === String(domSliceInfo.matchedSeriesId)
        );
        
        // Validate: Does the detected slice number actually exist in this series?
        if (domSeries && domSliceInfo.sliceNumber <= (domSeries.total_slices || 9999)) {
          seriesObj = domSeries;
          console.log("[KeyImageService] Using high-confidence DOM detected series:", seriesObj.series_description);
        }
      }

      // PRIORITY 3: Fuzzy match by series description ONLY if we have a very strong match
      if (!seriesObj && (domSliceInfo?.seriesDescription || snapshotResult?.seriesDescription)) {
        const targetDesc = String(domSliceInfo?.seriesDescription || snapshotResult?.seriesDescription).toLowerCase().replace(/\s+/g, ' ').trim();
        seriesObj = studySeriesList.find(s => {
          if (!s.series_description) return false;
          const clean = String(s.series_description).toLowerCase().replace(/\s+/g, ' ').trim();
          // Require exact match or very strong inclusion to prevent false positives
          return clean === targetDesc || (targetDesc.length > 5 && clean.includes(targetDesc));
        });
      }

      // PRIORITY 4: Absolute last resort fallback
      if (!seriesObj) {
        const nonScout = studySeriesList.filter(s => !/topogram|localizer|scout|survey|plan/i.test(s.series_description || ""));
        seriesObj = nonScout.length > 0 ? nonScout[0] : studySeriesList[0];
        console.warn("[KeyImageService] Falling back to default series:", seriesObj.series_description);
      }
    }

    // Resolve Slice Number (Trust DOM/snapshot if valid, otherwise use fallback)
    const detectedSlice = (domSliceInfo?.sliceNumber && parseInt(domSliceInfo.sliceNumber, 10) > 0 ? parseInt(domSliceInfo.sliceNumber, 10) : null) ||
      (snapshotResult?.sliceNumber && parseInt(snapshotResult.sliceNumber, 10) > 0 ? parseInt(snapshotResult.sliceNumber, 10) : null) ||
      (fallbackSliceNum && parseInt(fallbackSliceNum, 10) > 0 ? parseInt(fallbackSliceNum, 10) : 1);

    const totalSlices = seriesObj?.total_slices || seriesObj?.instances?.length || snapshotResult?.totalSlices || domSliceInfo?.totalSlices || 1;
    const clampedSlice = Math.min(Math.max(1, detectedSlice), totalSlices);

    // Resolve DICOM Instance Object
    let targetInstance = null;
    if (seriesObj && Array.isArray(seriesObj.instances) && seriesObj.instances.length > 0) {
      targetInstance = seriesObj.instances.find(inst => 
        parseInt(inst.slice_number || inst.instance_number || inst.instanceNumber || inst.slice_index, 10) === clampedSlice
      );
      if (!targetInstance) {
        const idx = Math.min(Math.max(0, clampedSlice - 1), seriesObj.instances.length - 1);
        targetInstance = seriesObj.instances[idx];
      }
    }

    const seriesDesc = seriesObj?.series_description || snapshotResult?.seriesDescription || domSliceInfo?.seriesDescription || "Diagnostic Series";
    const fullCaption = totalSlices > 1 
      ? `${seriesDesc} | ${clampedSlice}/${totalSlices}` 
      : `${seriesDesc} | ${clampedSlice}`;

    const dataUrl = snapshotResult?.dataUrl || null;

    console.log("[KeyImageService] Final Capture Payload:", {
      seriesDescription: seriesDesc,
      seriesId: seriesObj?.series_id,
      sliceNumber: clampedSlice,
      totalSlices: totalSlices,
      instanceId: targetInstance?.instance_id
    });

    return {
      studyUID: seriesObj?.study_instance_uid || seriesObj?.studyUID,
      seriesUID: seriesObj?.series_id || seriesObj?.series_instance_uid,
      sopInstanceUid: targetInstance?.id || targetInstance?.instance_id || snapshotResult?.instanceNumber,
      instanceId: targetInstance?.instance_id || targetInstance?.id,
      sliceNumber: clampedSlice,
      totalSlices,
      seriesNumber: seriesObj?.series_number || 1,
      modality: seriesObj?.modality || "CT",
      seriesDescription: seriesDesc,
      caption: fullCaption,
      dataUrl,
      windowCenter: snapshotResult?.windowCenter || null,
      windowWidth: snapshotResult?.windowWidth || null,
      zoom: snapshotResult?.zoom || 1.0,
      panX: snapshotResult?.panX || 0.0,
      panY: snapshotResult?.panY || 0.0,
      rotation: snapshotResult?.rotation || 0,
      flipHorizontal: snapshotResult?.flipHorizontal || false,
      flipVertical: snapshotResult?.flipVertical || false,
      annotationData: snapshotResult?.annotationData || {},
      measurementData: snapshotResult?.measurementData || {}
    };
  }

  async addKeyImage(reportId, keyImagePayload) {
    if (!keyImagePayload) return null;
    try {
      // Debug log to verify what frontend is sending
      api.post("/api/pacs/debug-key-image-payload", keyImagePayload).catch(() => {});
      
      const url = reportId 
        ? `/api/pacs/v1/reports/${reportId}/key-images` 
        : (keyImagePayload.studyUID ? `/api/pacs/v1/studies/${encodeURIComponent(keyImagePayload.studyUID)}/key-images` : "/api/pacs/capture-key-image");
        
      const res = await api.post(url, keyImagePayload);
      if (res.data && res.data.success && res.data.data) {
        return res.data.data;
      }
    } catch (err) {
      console.error("[KeyImageService] Add Key Image API error:", err.message);
    }
    return null;
  }

  async getKeyImages(reportId, studyUID = null) {
    try {
      if (reportId) {
        const res = await api.get(`/api/reports/${reportId}/key-images`);
        if (res.data?.success && Array.isArray(res.data.data)) return res.data.data;
      } else if (studyUID) {
        const res = await api.get(`/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images`);
        if (res.data?.success && Array.isArray(res.data.data)) return res.data.data;
      }
    } catch (e) {
      console.warn("[KeyImageService] Get Key Images notice:", e.message);
    }
    return [];
  }

  async removeKeyImage(reportId, keyImageId, studyUID = null) {
    try {
      if (reportId && keyImageId) {
        await api.delete(`/api/reports/${reportId}/key-images/${encodeURIComponent(keyImageId)}`);
        return true;
      } else if (studyUID && keyImageId) {
        await api.delete(`/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images/${encodeURIComponent(keyImageId)}`);
        return true;
      }
    } catch (e) {
      console.warn("[KeyImageService] Remove Key Image error:", e.message);
    }
    return false;
  }

  async reorderKeyImages(reportId, orderedIds = []) {
    if (!reportId || !Array.isArray(orderedIds)) return false;
    try {
      const res = await api.post(`/api/reports/${reportId}/key-images/reorder`, { keyImageIds: orderedIds });
      return !!res.data?.success;
    } catch (e) {
      console.warn("[KeyImageService] Reorder Key Images error:", e.message);
      return false;
    }
  }

  openKeyImageInViewer(keyImage, navigate = null, isMobile = false) {
    if (!keyImage) return;
    const studyUID = keyImage.study_uid || keyImage.studyUID;
    const seriesUID = keyImage.series_uid || keyImage.seriesUID;
    const sliceNum = keyImage.slice_number || keyImage.sliceNumber || keyImage.frame_number || 1;
    const seriesIdx = keyImage.series_number ? (parseInt(keyImage.series_number, 10) - 1) : 0;

    if (!studyUID) return;

    if (isMobile) {
      const mobileUrl = `/mobile-viewer?study=${encodeURIComponent(studyUID)}&series=${seriesIdx}&slice=${sliceNum - 1}`;
      if (navigate) navigate(mobileUrl);
      else window.open(mobileUrl, "_blank");
    } else {
      const baseUrl = getViewerUrl(studyUID);
      const separator = baseUrl.includes("?") ? "&" : "?";
      const viewerUrl = `${baseUrl}${separator}SeriesInstanceUID=${encodeURIComponent(seriesUID || '')}&SOPInstanceUID=${encodeURIComponent(keyImage.sop_instance_uid || '')}&initialFrame=${sliceNum}`;
      window.open(viewerUrl, "_blank");
    }
  }
}

export const keyImageService = new KeyImageService();
export default KeyImageService;
