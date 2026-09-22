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

  // ALWAYS map direct Orthanc / 8042 / OHIF URLs to same-origin relative proxy path so bridge script is injected and canvas capture is allowed
  if (customOhifUrl) {
    try {
      if (
        customOhifUrl.includes(":8042") ||
        customOhifUrl.includes("Orthanc") ||
        customOhifUrl.includes("/ohif") ||
        customOhifUrl.includes("/viewer")
      ) {
        const urlObj = new URL(customOhifUrl.startsWith("http") ? customOhifUrl : `http://localhost${customOhifUrl.startsWith("/") ? "" : "/"}${customOhifUrl}`);
        const pName = urlObj.pathname || "";
        if (pName.includes("index.html")) {
          customOhifUrl = pName.startsWith("/ohif") || pName.startsWith("/viewer") ? pName : "/ohif/viewer/index.html";
        } else {
          customOhifUrl = "/ohif/viewer/index.html";
        }
      }
    } catch (e) {
      customOhifUrl = "/ohif/viewer/index.html";
    }
  }

  if (!customOhifUrl || customOhifUrl === "/" || customOhifUrl === "#" || customOhifUrl.includes(":8042")) {
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
