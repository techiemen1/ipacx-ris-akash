import api from "../api/axios";
import { getViewerUrl } from "../utils/viewerUtils";

class KeyImageService {
  async addKeyImage(reportId, keyImagePayload) {
    if (!keyImagePayload) return null;
    try {
      console.log('[KeyImageService] Sending payload:', keyImagePayload);
      const url = reportId 
        ? `/api/pacs/v1/reports/${reportId}/key-images` 
        : "/api/pacs/capture-key-image";
      const res = await api.post(url, keyImagePayload);
      if (res.data?.success && res.data?.data) {
        console.log('[KeyImageService] ✅ Saved:', res.data.data);
        return res.data.data;
      }
    } catch (err) {
      console.error("[KeyImageService] ❌ Failed:", err.message);
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
      console.warn("[KeyImageService] Get failed:", e.message);
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

    if (!studyUID) return;

    if (isMobile) {
      const url = `/mobile-viewer?study=${encodeURIComponent(studyUID)}&slice=${sliceNum - 1}`;
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
