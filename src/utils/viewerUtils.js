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

  // Clean index.html from path if present
  if (customOhifUrl.endsWith("/index.html")) {
    customOhifUrl = customOhifUrl.slice(0, -11);
  } else if (customOhifUrl.endsWith("index.html")) {
    customOhifUrl = customOhifUrl.slice(0, -10);
  }

  // Remove existing StudyInstanceUIDs query param if user pasted a full link with parameters
  if (customOhifUrl.includes("StudyInstanceUIDs=")) {
    customOhifUrl = customOhifUrl.split("StudyInstanceUIDs=")[0].replace(/[?&]$/, "");
  }

  // If customOhifUrl is empty, root, or "#", default to relative same-origin /ohif/viewer
  if (!customOhifUrl || customOhifUrl === "/" || customOhifUrl === "#") {
    customOhifUrl = "/ohif/viewer";
  } else {
    // If user provided base URL like "http://172.16.1.12:3000" or "http://172.16.7.240:8042",
    // ensure "/viewer" is present in path so OHIF opens patient images instead of Study List.
    if (!customOhifUrl.includes("/viewer") && !customOhifUrl.includes("/ohif")) {
      customOhifUrl = customOhifUrl.replace(/\/+$/, "") + "/viewer";
    }
  }

  const cleanBase = customOhifUrl.replace(/\/+$/, "");
  const separator = cleanBase.includes("?") ? "&" : "?";
  return `${cleanBase}${separator}StudyInstanceUIDs=${encodeURIComponent(studyUID.trim())}`;
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
