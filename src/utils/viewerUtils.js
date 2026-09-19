import { detectDeviceType, isTouchSupported } from "./deviceDetector";
import api from "../api/axios";

// Auto-sync global PACS OHIF viewer setting from backend
if (typeof window !== "undefined") {
  api.get("/api/pacs/settings").then((res) => {
    if (res.data?.success && res.data?.settings?.external_ohif_url) {
      localStorage.setItem("OHIF_VIEWER_URL", res.data.settings.external_ohif_url);
    }
  }).catch(() => {});
}

export const isMobileDevice = () => {
  return detectDeviceType() !== "desktop" || isTouchSupported();
};

export const getNativeViewerUrl = (studyUID) => {
  if (!studyUID) return "#";
  return `/native-viewer?study=${encodeURIComponent(studyUID.trim())}`;
};

export const getViewerUrl = (studyUID, mode = "auto") => {
  if (!studyUID) return "#";

  if (mode === "native") {
    return getNativeViewerUrl(studyUID);
  }

  if (mode === "mobile" || (mode === "auto" && isMobileDevice())) {
    return `/mobile-viewer?study=${encodeURIComponent(studyUID.trim())}`;
  }

  let customOhifUrl = (localStorage.getItem("OHIF_VIEWER_URL") || process.env.REACT_APP_OHIF_VIEWER_URL || "").trim();

  // Convert absolute same-host URLs (e.g. http://localhost:8042 or http://127.0.0.1:8042) to same-origin relative proxy path
  if (customOhifUrl && typeof window !== "undefined") {
    try {
      if (customOhifUrl.startsWith("http://") || customOhifUrl.startsWith("https://")) {
        const u = new URL(customOhifUrl);
        const hostName = window.location.hostname;
        if (u.hostname === hostName || u.hostname === "localhost" || u.hostname === "127.0.0.1") {
          customOhifUrl = u.pathname + u.search;
        }
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  if (!customOhifUrl || customOhifUrl === "/" || customOhifUrl === "#") {
    customOhifUrl = "/ohif/viewer/index.html";
  }

  if (customOhifUrl.includes("StudyInstanceUIDs=")) {
    customOhifUrl = customOhifUrl.split("StudyInstanceUIDs=")[0].replace(/[?&]$/, "");
  }
  const separator = customOhifUrl.includes("?") ? "&" : "?";
  return `${customOhifUrl}${separator}StudyInstanceUIDs=${encodeURIComponent(studyUID.trim())}`;
};

export const openStudyViewer = (study, mode = "auto") => {
  if (!study) return;
  const studyUID =
    typeof study === "string"
      ? study
      : study?.StudyInstanceUID || study?.study_uid || study?.ID || study?.id;
  if (!studyUID || typeof studyUID !== "string") return;
  const url = getViewerUrl(studyUID.trim(), mode);
  window.open(url, "_blank");
};
