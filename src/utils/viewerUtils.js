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

  if (customOhifUrl) {
    // If user pasted full URL with StudyInstanceUIDs=..., strip existing query parameter value
    if (customOhifUrl.includes("StudyInstanceUIDs=")) {
      customOhifUrl = customOhifUrl.split("StudyInstanceUIDs=")[0].replace(/[?&]$/, "");
    }
    const separator = customOhifUrl.includes("?") ? "&" : "?";
    return `${customOhifUrl}${separator}StudyInstanceUIDs=${encodeURIComponent(studyUID.trim())}`;
  }

  return `/ohif/viewer?StudyInstanceUIDs=${encodeURIComponent(studyUID.trim())}`;
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
