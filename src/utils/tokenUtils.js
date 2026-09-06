// src/utils/tokenUtils.js

// Decode JWT payload
export const getTokenExpiry = (token) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000; // convert to ms
  } catch (e) {
    return null;
  }
};

// Calculate remaining time
export const getRemainingTime = (expiry) => {
  const diff = expiry - Date.now();

  if (diff <= 0) return "Expired";

  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
};