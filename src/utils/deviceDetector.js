/**
 * Device & Touch Capability Auto-Detection Utility
 * Identifies mobile, iPad, tablet, desktop web, and touch interaction support.
 */

export const isTouchSupported = () => {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    navigator.msMaxTouchPoints > 0
  );
};

export const detectDeviceType = () => {
  if (typeof window === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  
  const isIPad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = /iPhone|iPod|Android.*Mobile|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isTablet = isIPad || (/Android/i.test(ua) && !/Mobile/i.test(ua));

  if (isMobile) return "mobile";
  if (isTablet) return "tablet";
  return "desktop";
};

export const getPreferredViewerMode = () => {
  const device = detectDeviceType();
  const hasTouch = isTouchSupported();

  if (device === "mobile" || (device === "tablet" && hasTouch)) {
    return "native"; // Native fast canvas DICOM viewer preferred for mobile/tablet touch
  }
  return "ohif"; // Desktop default
};

export const getScreenOrientation = () => {
  if (typeof window === "undefined") return "landscape";
  return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
};
