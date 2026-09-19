/**
 * KeyImageService.js
 * Modular Enterprise Service managing Key Image Capture, Presentation State Preservation,
 * REST persistence, and Targeted DICOM Viewer Navigation across Desktop, Tablet & Mobile.
 */

import api from "../api/axios";
import { requestViewerSnapshot, detectViewportSliceInfoFromDOM } from "../utils/ViewerBridge";

class KeyImageService {
  /**
   * Captures the active viewport slice, presentation state, and DICOM identity.
   */
  async captureActiveViewport(iframeSelector = "iframe", studySeriesList = [], activeSeriesId = null, fallbackSliceNum = 1) {
    let snapshotResult = null;
    let domSliceInfo = null;

    try {
      const iframeEl = typeof iframeSelector === "string" ? document.querySelector(iframeSelector) : iframeSelector;
      if (iframeEl && iframeEl.contentWindow) {
        // 1. Send RPC postMessage capture trigger
        try {
          iframeEl.contentWindow.postMessage({ type: "OHIF_CAPTURE_VIEWPORT", action: "CAPTURE" }, "*");
          iframeEl.contentWindow.postMessage({ type: "REQUEST_SNAPSHOT", action: "CAPTURE" }, "*");
        } catch (e) {}

        // 2. Direct DOM inspection if same-origin
        try {
          const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
          if (iframeDoc) {
            domSliceInfo = detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList);
          }
        } catch (e) {}
      }
    } catch (e) {}

    // 3. Fallback to ViewerBridge snapshot RPC
    snapshotResult = await requestViewerSnapshot(iframeSelector, studySeriesList);

    // Resolve Target Series
    const targetSeriesId = activeSeriesId || 
      domSliceInfo?.matchedSeriesId || 
      snapshotResult?.matchedSeriesId || 
      null;

    let seriesObj = null;
    if (Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      if (targetSeriesId) {
        seriesObj = studySeriesList.find(s => 
          String(s.series_id) === String(targetSeriesId) ||
          String(s.series_instance_uid) === String(targetSeriesId) ||
          String(s.orthanc_series_id) === String(targetSeriesId)
        );
      }

      if (!seriesObj && (domSliceInfo?.seriesDescription || snapshotResult?.seriesDescription)) {
        const targetDesc = String(domSliceInfo?.seriesDescription || snapshotResult?.seriesDescription).toLowerCase().replace(/\s+/g, ' ').trim();
        seriesObj = studySeriesList.find(s => {
          if (!s.series_description) return false;
          const clean = String(s.series_description).toLowerCase().replace(/\s+/g, ' ').trim();
          return clean === targetDesc || clean.includes(targetDesc) || targetDesc.includes(clean);
        });
      }

      if (!seriesObj) {
        const nonScout = studySeriesList.filter(s => !/topogram|localizer|scout|survey|plan/i.test(s.series_description || ""));
        seriesObj = nonScout.length > 0 ? nonScout[0] : studySeriesList[0];
      }
    }

    // Resolve Slice Number
    const detectedSlice = (domSliceInfo?.sliceNumber && parseInt(domSliceInfo.sliceNumber, 10) > 0 ? parseInt(domSliceInfo.sliceNumber, 10) : null) ||
      (snapshotResult?.sliceNumber && parseInt(snapshotResult.sliceNumber, 10) > 0 ? parseInt(snapshotResult.sliceNumber, 10) : null) ||
      (fallbackSliceNum && parseInt(fallbackSliceNum, 10) > 0 ? parseInt(fallbackSliceNum, 10) : 1);

    const totalSlices = snapshotResult?.totalSlices || domSliceInfo?.totalSlices || seriesObj?.total_slices || seriesObj?.instances?.length || 1;
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
      ? `${seriesDesc} | Slice ${clampedSlice}/${totalSlices}` 
      : `${seriesDesc} | Slice ${clampedSlice}`;

    const dataUrl = snapshotResult?.dataUrl || null;

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
      // Viewport Presentation State (from snapshot if present)
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

  /**
   * Attaches a Key Image to a report via backend API.
   */
  async addKeyImage(reportId, keyImagePayload) {
    if (!keyImagePayload) return null;
    try {
      const url = reportId ? `/api/reports/${reportId}/key-images` : "/api/pacs/capture-key-image";
      const res = await api.post(url, keyImagePayload);
      if (res.data && res.data.success && res.data.data) {
        return res.data.data;
      }
    } catch (err) {
      console.warn("[KeyImageService] Add Key Image API notice:", err.message);
    }
    return null;
  }

  /**
   * Fetches key images for a specific report or study.
   */
  async getKeyImages(reportId, studyUID = null) {
    try {
      if (reportId) {
        const res = await api.get(`/api/reports/${reportId}/key-images`);
        if (res.data?.success && Array.isArray(res.data.data)) {
          return res.data.data;
        }
      } else if (studyUID) {
        const res = await api.get(`/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images`);
        if (res.data?.success && Array.isArray(res.data.data)) {
          return res.data.data;
        }
      }
    } catch (e) {
      console.warn("[KeyImageService] Get Key Images notice:", e.message);
    }
    return [];
  }

  /**
   * Removes a Key Image by ID.
   */
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

  /**
   * Reorders Key Images for a report.
   */
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

  /**
   * Launches DICOM Viewer targeted to exact Key Image (Desktop OHIF / Mobile Lite Viewer).
   * Restores Study, Series, Slice/SOPInstanceUID & Viewport state.
   */
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
      const viewerUrl = `/viewer/?StudyInstanceUIDs=${encodeURIComponent(studyUID)}&SeriesInstanceUID=${encodeURIComponent(seriesUID || '')}&SOPInstanceUID=${encodeURIComponent(keyImage.sop_instance_uid || '')}&initialFrame=${sliceNum}`;
      window.open(viewerUrl, "_blank");
    }
  }
}

export const keyImageService = new KeyImageService();
export default KeyImageService;
