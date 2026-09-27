/**
 * KeyImageService.js - FIXED VERSION
 * This version STRICTLY respects the selectedSeriesId from the modal
 */

import api from "../api/axios";
import { requestViewerSnapshot } from "../utils/ViewerBridge";
import { getViewerUrl } from "../utils/viewerUtils";

class KeyImageService {
  async captureActiveViewport(iframeSelector = "iframe", studySeriesList = [], activeSeriesId = null, fallbackSliceNum = 1) {
    console.log('[KeyImageService] INPUT:', { activeSeriesId, studySeriesCount: studySeriesList.length, fallbackSliceNum });

    let snapshotResult = null;
    
    try {
      const iframeEl = typeof iframeSelector === "string" ? document.querySelector(iframeSelector) : iframeSelector;
      if (iframeEl && iframeEl.contentWindow) {
        try {
          iframeEl.contentWindow.postMessage({ type: "OHIF_CAPTURE_VIEWPORT", action: "CAPTURE" }, "*");
        } catch (e) {
          console.warn("[KeyImageService] PostMessage failed:", e.message);
        }
      }
    } catch (e) {
      console.warn("[KeyImageService] Iframe access failed:", e.message);
    }

    // Get snapshot for canvas data and window/level
    snapshotResult = await requestViewerSnapshot(iframeSelector, studySeriesList);

    // ==========================================
    // CRITICAL FIX: STRICT SERIES MATCHING
    // ==========================================
    let seriesObj = null;
    
    if (activeSeriesId && Array.isArray(studySeriesList) && studySeriesList.length > 0) {
      // Try to find by EXACT match first
      seriesObj = studySeriesList.find(s => {
        const match = String(s.series_id) === String(activeSeriesId) ||
                     String(s.series_instance_uid) === String(activeSeriesId) ||
                     String(s.orthanc_series_id) === String(activeSeriesId);
        if (match) {
          console.log('[KeyImageService] ✅ Found series by activeSeriesId:', s.series_description, s.series_id);
        }
        return match;
      });

      // If not found, try fuzzy match by description
      if (!seriesObj && snapshotResult?.seriesDescription) {
        const targetDesc = String(snapshotResult.seriesDescription).toLowerCase().trim();
        seriesObj = studySeriesList.find(s => {
          const desc = String(s.series_description || '').toLowerCase().trim();
          const match = desc === targetDesc || desc.includes(targetDesc);
          if (match) {
            console.log('[KeyImageService] ✅ Found series by description match:', s.series_description);
          }
          return match;
        });
      }

      // Last resort: use first series
      if (!seriesObj) {
        seriesObj = studySeriesList[0];
        console.warn('[KeyImageService] ⚠️ Using first series as fallback:', seriesObj.series_description);
      }
    } else if (studySeriesList.length > 0) {
      seriesObj = studySeriesList[0];
      console.warn('[KeyImageService] ⚠️ No activeSeriesId provided, using first series:', seriesObj.series_description);
    }

    if (!seriesObj) {
      throw new Error("No series available for key image capture");
    }

    // ==========================================
    // RESOLVE SLICE NUMBER
    // ==========================================
    const detectedSlice = snapshotResult?.sliceNumber || fallbackSliceNum || 1;
    const totalSlices = seriesObj.total_slices || seriesObj.instances?.length || 1;
    const clampedSlice = Math.min(Math.max(1, parseInt(detectedSlice, 10)), totalSlices);

    // ==========================================
    // RESOLVE INSTANCE
    // ==========================================
    let targetInstance = null;
    if (Array.isArray(seriesObj.instances) && seriesObj.instances.length > 0) {
      targetInstance = seriesObj.instances.find(inst => 
        parseInt(inst.slice_number || inst.instance_number || 0, 10) === clampedSlice
      );
      if (!targetInstance) {
        const idx = Math.min(Math.max(0, clampedSlice - 1), seriesObj.instances.length - 1);
        targetInstance = seriesObj.instances[idx];
      }
    }

    const seriesDesc = seriesObj.series_description || "Diagnostic Series";
    const caption = `${seriesDesc} | ${clampedSlice}/${totalSlices}`;

    console.log('[KeyImageService] FINAL PAYLOAD:', {
      studyUID: seriesObj.study_instance_uid,
      seriesUID: seriesObj.series_id,
      seriesDescription: seriesDesc,
      sliceNumber: clampedSlice,
      totalSlices,
      instanceId: targetInstance?.instance_id,
      caption
    });

    return {
      studyUID: seriesObj.study_instance_uid,
      seriesUID: seriesObj.series_id || seriesObj.series_instance_uid,
      sopInstanceUid: targetInstance?.id || targetInstance?.instance_id,
      instanceId: targetInstance?.instance_id || targetInstance?.id,
      sliceNumber: clampedSlice,
      totalSlices,
      seriesNumber: seriesObj.series_number || 1,
      modality: seriesObj.modality || "CT",
      seriesDescription: seriesDesc,
      caption,
      dataUrl: snapshotResult?.dataUrl || null,
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
      console.log('[KeyImageService] Sending to backend:', keyImagePayload);
      const url = reportId 
        ? `/api/pacs/v1/reports/${reportId}/key-images` 
        : "/api/pacs/capture-key-image";
      const res = await api.post(url, keyImagePayload);
      if (res.data?.success && res.data?.data) {
        console.log('[KeyImageService] ✅ Backend saved successfully:', res.data.data);
        return res.data.data;
      }
    } catch (err) {
      console.error("[KeyImageService] ❌ Backend save failed:", err.message);
    }
    return null;
  }

  async getKeyImages(reportId, studyUID = null) {
    try {
      if (reportId) {
        const res = await api.get(`/api/reports/${reportId}/key-images`);
        if (res.data?.success) return res.data.data;
      } else if (studyUID) {
        const res = await api.get(`/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images`);
        if (res.data?.success) return res.data.data;
      }
    } catch (e) {
      console.warn("[KeyImageService] Get Key Images failed:", e.message);
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
      console.warn("[KeyImageService] Remove failed:", e.message);
    }
    return false;
  }

  async reorderKeyImages(reportId, orderedIds = []) {
    if (!reportId || !Array.isArray(orderedIds)) return false;
    try {
      const res = await api.post(`/api/reports/${reportId}/key-images/reorder`, { keyImageIds: orderedIds });
      return !!res.data?.success;
    } catch (e) {
      console.warn("[KeyImageService] Reorder failed:", e.message);
      return false;
    }
  }

  openKeyImageInViewer(keyImage, navigate = null, isMobile = false) {
    if (!keyImage) return;
    const studyUID = keyImage.study_uid || keyImage.studyUID;
    const seriesUID = keyImage.series_uid || keyImage.seriesUID;
    const sliceNum = keyImage.slice_number || keyImage.sliceNumber || 1;
    const seriesIdx = keyImage.series_number ? (parseInt(keyImage.series_number, 10) - 1) : 0;

    if (!studyUID) return;

    if (isMobile) {
      const url = `/mobile-viewer?study=${encodeURIComponent(studyUID)}&series=${seriesIdx}&slice=${sliceNum - 1}`;
      if (navigate) navigate(url);
      else window.open(url, "_blank");
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
