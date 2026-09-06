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

  const customOhifUrl = localStorage.getItem("OHIF_VIEWER_URL") || process.env.REACT_APP_OHIF_VIEWER_URL;
  if (customOhifUrl && customOhifUrl.trim()) {
    const base = customOhifUrl.trim();
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}StudyInstanceUIDs=${encodeURIComponent(studyUID)}`;
  }

  return `/ohif/viewer?StudyInstanceUIDs=${encodeURIComponent(studyUID)}`;
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
