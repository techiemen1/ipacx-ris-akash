// src/api/urls.js

export const BACKEND_URL =
  process.env.REACT_APP_API_BASE_URL
    ? process.env.REACT_APP_API_BASE_URL.replace(/\/$/, "")
    : (typeof window !== "undefined" ? window.location.origin : "");

export const getSignatureUrl = (path) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${BACKEND_URL}${path}`;
};
