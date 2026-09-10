export const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
};

export const getViewerUrl = (studyUID, _mode = "@ohif/mode-longitudinal") => {
  if (!studyUID) return "#";

  if (isMobileDevice()) {
    return `/lite?study=${encodeURIComponent(studyUID)}`;
  }

  let customOhifUrl = (localStorage.getItem("OHIF_VIEWER_URL") || process.env.REACT_APP_OHIF_VIEWER_URL || "").trim();

  // Guard against invalid custom URLs that point to root dashboard "/" or same origin
  if (
    customOhifUrl === "/" ||
    customOhifUrl === "#" ||
    customOhifUrl === "http://localhost:3010" ||
    customOhifUrl === "http://localhost:3010/" ||
    customOhifUrl === "http://127.0.0.1:3010"
  ) {
    customOhifUrl = "";
  }

  if (customOhifUrl) {
    if (customOhifUrl.includes("StudyInstanceUIDs=")) {
      customOhifUrl = customOhifUrl.split("StudyInstanceUIDs=")[0].replace(/[?&]$/, "");
    }
    if (customOhifUrl.startsWith("http://") || customOhifUrl.startsWith("https://")) {
      try {
        const u = new URL(customOhifUrl);
        customOhifUrl = u.pathname + u.search;
      } catch (e) {
        // Fallback
      }
    }
    const separator = customOhifUrl.includes("?") ? "&" : "?";
    return `${customOhifUrl}${separator}StudyInstanceUIDs=${encodeURIComponent(studyUID.trim())}`;
  }

  return `/viewer/?StudyInstanceUIDs=${encodeURIComponent(studyUID.trim())}`;
};

export const openStudyViewer = (study) => {
  if (!study) return;
  const studyUID =
    typeof study === "string"
      ? study
      : study?.StudyInstanceUID || study?.study_uid || study?.ID || study?.id;
  if (!studyUID || typeof studyUID !== "string") return;
  const url = getViewerUrl(studyUID.trim());
  window.open(url, "_blank");
};
