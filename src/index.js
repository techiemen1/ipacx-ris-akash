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

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);

reportWebVitals();