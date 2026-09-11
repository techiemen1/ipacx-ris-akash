// index.js
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import reportWebVitals from "./reportWebVitals";

import { AuthProvider } from "./context/AuthContext";

import "./index.css";
import "./print.css";

/* React Router future flags (optional) */
window.__RR_FUTURE_FLAGS__ = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

// Global ChunkLoadError Auto-Recovery for SPA cache invalidation
window.addEventListener("error", (e) => {
  const msg = String(e?.message || e?.reason || "");
  if (msg.includes("ChunkLoadError") || msg.includes("Loading CSS chunk") || msg.includes("Loading chunk")) {
    console.warn("New build version detected. Auto-reloading page to fetch latest assets...");
    window.location.reload();
  }
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = String(e?.reason?.message || e?.reason || "");
  if (msg.includes("ChunkLoadError") || msg.includes("Loading CSS chunk") || msg.includes("Loading chunk")) {
    console.warn("Unhandled ChunkLoadError detected. Auto-reloading page...");
    window.location.reload();
  }
});

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

reportWebVitals();