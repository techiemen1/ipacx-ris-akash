const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs");

const { initTracing } = require("./services/tracingService");
initTracing(); // Initialize OpenTelemetry tracing first

const env = require("./config/env");
const logger = require("./utils/logger");
const initSentry = require("./services/sentryService");
const pool = require("./db");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const server = http.createServer(app);
const PORT = env.PORT || process.env.PORT || 5000;

const sentry = initSentry(app);
app.use(sentry.requestHandler);

const { initWebSockets } = require("./services/websocketService");
initWebSockets(server);

const { setupGraphQLServer } = require("./services/graphqlService");
setupGraphQLServer(app);

/**
 * CORS Configuration - HARDENED
 * Validates origins against strict whitelist + LAN IP ranges
 * Prevents CSRF and cross-site data exfiltration attacks
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3010",
  "http://127.0.0.1:3010",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:3015",
  "http://127.0.0.1:3015",
  // DCM4CHEE-ARC & OHIF Production
  process.env.DICOM_VIEWER_URL,
  process.env.OHIF_VIEWER_URL,
].filter(Boolean);

// Enhanced LAN origin validation: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
const lanOriginPattern = /^http:\/\/(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}(:\d+)?$/;

const corsOptions = {
  origin: (origin, callback) => {
    // No origin (same-origin requests, like <form>, <link>, <script>)
    if (!origin) {
      return callback(null, true);
    }

    // Exact match in whitelist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Pattern match: LAN IP ranges
    if (lanOriginPattern.test(origin)) {
      return callback(null, true);
    }

    // BLOCKED: Log and reject
    logger.warn(`[CORS Blocked] Unauthorized origin: ${origin}`, {
      timestamp: new Date().toISOString(),
      remoteIP: this.req?.ip || "unknown"
    });
    return callback(new Error(`CORS policy: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Pragma",
    "Expires",
    "x-audit-username",
    "x-audit-role",
    "x-audit-session",
  ],
  exposedHeaders: [
    "Content-Length",
    "Content-Range",
    "Content-Type",
    "X-RateLimit-Limit",
  ],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);

app.use((req, res, next) => {
  logger.info(`API Request: ${req.method} ${req.originalUrl}`, { ip: req.ip });
  next();
});

// Limit JSON payloads to 50MB (prevent DoS); binary uploads handled separately
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Static file serving
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/uploads/report_images", express.static(path.join(__dirname, "uploads/report_images")));
app.use("/uploads/signatures", express.static(path.join(__dirname, "uploads/signatures")));

// Proxy OHIF Viewer for same-origin iframe canvas capture with automatic Orthanc authentication
try {
  const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");
  const { getOrthancUrl, getOrthancAuthHeader, getActivePacsCredentials } = require("./utils/orthancHelper");
  const zlib = require("zlib");

  const getDynamicTarget = async () => {
    const url = await getOrthancUrl();
    return url.replace(/\/$/, "");
  };

  const handleProxyReqAuth = (proxyReq) => {
    try {
      const authHeader = getOrthancAuthHeader();
      if (authHeader) {
        proxyReq.setHeader("Authorization", authHeader);
      }
      proxyReq.setHeader("Accept-Encoding", "identity");
    } catch (e) {
      // Ignore header setting error
    }
  };





  const dcm4cheeHelper = require("./utils/dcm4cheeHelper");
  const getDynamicDcm4cheeTarget = async () => {
    try {
      const node = await dcm4cheeHelper.getWorkingDcm4cheeNode();
      if (node) return `http://${node.ip_address}:${node.port}`;
    } catch (e) {}
    return "http://dcm4chee-arc:8080";
  };

  app.use(
    "/dcm4chee-arc",
    createProxyMiddleware({
      target: "http://dcm4chee-arc:8080",
      router: getDynamicDcm4cheeTarget,
      changeOrigin: true,
      on: {
        proxyReq: (proxyReq) => {
          const dUser = process.env.DCM4CHEE_USER || "pacs";
          const dPass = process.env.DCM4CHEE_PASS || "pacs";
          if (dUser || dPass) {
            const auth = "Basic " + Buffer.from(`${dUser}:${dPass}`).toString("base64");
            proxyReq.setHeader("Authorization", auth);
          }
        }
      }
    })
  );

  app.use(
    "/ohif-proxy",
    createProxyMiddleware({
      target: "http://Orthanc:8042",
      router: getDynamicTarget,
      changeOrigin: true,
      on: {
        proxyReq: handleProxyReqAuth
      }
    })
  );

  const autoTrackScript = [
    '<script>',
    '(function() {',
    '  console.log("⚡ [OHIF AUTOTRACK INJECTED] Active viewport tracker initializing...");',
    '  function getActiveViewportState() {',
    '    try {',
    '      var sm = window.OHIF && window.OHIF.servicesManager;',
    '      var vpgs = sm && sm.services && sm.services.viewportGridService;',
    '      var cvps = sm && sm.services && sm.services.cornerstoneViewportService;',
    '      var dss = sm && sm.services && sm.services.displaySetService;',
    '      var gridState = vpgs && typeof vpgs.getState === "function" ? vpgs.getState() : null;',
    '      var activeVpId = gridState ? gridState.activeViewportId : null;',
    '      var activeVp = null;',
    '      if (gridState && gridState.viewports && activeVpId) {',
    '        var vps = gridState.viewports;',
    '        if (typeof vps.get === "function") { activeVp = vps.get(activeVpId); }',
    '        else if (Array.isArray(vps)) { activeVp = vps.find(function(v) { return v.id === activeVpId || v.viewportId === activeVpId; }); }',
    '        else if (vps && typeof vps === "object") { activeVp = vps[activeVpId]; }',
    '      }',
    '      if (!activeVp && vpgs && activeVpId && typeof vpgs.getViewport === "function") {',
    '        try { activeVp = vpgs.getViewport(activeVpId); } catch(e) {}',
    '      }',
    '      var csvp = cvps && activeVpId && typeof cvps.getCornerstoneViewport === "function" ? cvps.getCornerstoneViewport(activeVpId) : null;',
    '      if (!csvp && window.cornerstone3D && window.cornerstone3D.getEnabledElements) {',
    '        try {',
    '          var enabledEls = window.cornerstone3D.getEnabledElements();',
    '          if (Array.isArray(enabledEls) && enabledEls.length > 0) {',
    '            var matchedEl = enabledEls.find(function(item) { return item.viewport && (item.viewport.id === activeVpId || item.viewportId === activeVpId); });',
    '            csvp = matchedEl ? matchedEl.viewport : enabledEls[0].viewport;',
    '          }',
    '        } catch(e) {}',
    '      }',
    '      var activePane = null;',
    '      if (csvp && csvp.element) {',
    '        activePane = csvp.element.closest("div[data-cy=\'viewport-pane\']") || csvp.element.parentElement || csvp.element;',
    '      }',
    '      if (!activePane && activeVpId) {',
    '        activePane = document.querySelector("div[data-cy=\'viewport-pane\'][data-viewport-id=\'" + activeVpId + "\']") || document.getElementById(activeVpId);',
    '      }',
    '      if (!activePane) {',
    '        activePane = document.querySelector("div[aria-selected=\'true\'][data-cy=\'viewport-pane\'], div[data-cy=\'viewport-pane\'].active, div[class*=\'active\'][data-cy=\'viewport-pane\'], div[class*=\'border-primary\'][data-cy=\'viewport-pane\'], div[class*=\'ring-primary\'][data-cy=\'viewport-pane\']");',
    '      }',
    '      if (!activePane && document.activeElement) {',
    '        activePane = document.activeElement.closest("div[data-cy=\'viewport-pane\']");',
    '      }',
    '      if (!activePane) {',
    '        var allPanes = document.querySelectorAll("div[data-cy=\'viewport-pane\']");',
    '        if (allPanes.length === 1) activePane = allPanes[0];',
    '      }',
    '      var sliceIdx = -1;',
    '      var totalSlices = 1;',
    '      var imageIds = [];',
    '      if (csvp) {',
    '        try {',
    '          if (window.cornerstone3D && window.cornerstone3D.utilities && typeof window.cornerstone3D.utilities.getImageSliceData === "function") {',
    '            var sd = window.cornerstone3D.utilities.getImageSliceData(csvp);',
    '            if (sd) {',
    '              if (typeof sd.imageIndex === "number" && sd.imageIndex >= 0) sliceIdx = sd.imageIndex;',
    '              if (typeof sd.numberOfSlices === "number" && sd.numberOfSlices > 0) totalSlices = sd.numberOfSlices;',
    '            }',
    '          }',
    '        } catch(e) {}',
    '        if (sliceIdx < 0) {',
    '          try {',
    '            if (typeof csvp.getCurrentImageIdIndex === "function" && typeof csvp.getCurrentImageIdIndex() === "number" && csvp.getCurrentImageIdIndex() >= 0) {',
    '              sliceIdx = csvp.getCurrentImageIdIndex();',
    '            } else if (typeof csvp.getTargetImageIdIndex === "function" && typeof csvp.getTargetImageIdIndex() === "number" && csvp.getTargetImageIdIndex() >= 0) {',
    '              sliceIdx = csvp.getTargetImageIdIndex();',
    '            } else if (typeof csvp.getSliceIndex === "function" && typeof csvp.getSliceIndex() === "number" && csvp.getSliceIndex() >= 0) {',
    '              sliceIdx = csvp.getSliceIndex();',
    '            } else if (typeof csvp.sliceIndex === "number" && csvp.sliceIndex >= 0) {',
    '              sliceIdx = csvp.sliceIndex;',
    '            }',
    '          } catch(e) {}',
    '        }',
    '        try {',
    '          imageIds = typeof csvp.getImageIds === "function" ? csvp.getImageIds() : (csvp.imageIds || []);',
    '          if (Array.isArray(imageIds) && imageIds.length > 0) {',
    '            if (totalSlices <= 1) totalSlices = imageIds.length;',
    '            if (sliceIdx < 0) {',
    '              var currentImgId = typeof csvp.getCurrentImageId === "function" ? csvp.getCurrentImageId() : (csvp.currentImageId || null);',
    '              if (currentImgId) {',
    '                var foundIdx = imageIds.indexOf(currentImgId);',
    '                if (foundIdx < 0) {',
    '                  foundIdx = imageIds.findIndex(function(id) { return id.includes(currentImgId) || currentImgId.includes(id); });',
    '                }',
    '                if (foundIdx >= 0) sliceIdx = foundIdx;',
    '              }',
    '            }',
    '          }',
    '        } catch(e) {}',
    '      }',
    '      if (activePane) {',
    '        try {',
    '          var paneText = activePane.innerText || activePane.textContent || "";',
    '          var rOHIFOverlay = new RegExp("(?:\\\\d+\\\\s*:\\\\s*)?(\\\\d+)\\\\s*\\\\(\\\\s*(\\\\d+)\\\\s*[\\\\/\\\\(]\\\\s*(\\\\d+)\\\\s*\\\\)", "i");',
    '          var rSlash = new RegExp("\\\\b(\\\\d+)\\\\s*[\\\\/\\\\(]\\\\s*(\\\\d+)\\\\b", "i");',
    '          var rSlice = new RegExp("(?:Slice|Im|Img|Image|Frame|F|I)\\\\s*[:#]?\\\\s*(\\\\d+)", "i");',
    '          var match = paneText.match(rOHIFOverlay) || paneText.match(rSlash) || paneText.match(rSlice);',
    '          if (match) {',
    '            var parsedNum = parseInt(match[1], 10);',
    '            if (parsedNum > 0) {',
    '              var parsedIndex = parsedNum - 1;',
    '              if (sliceIdx <= 0 || sliceIdx !== parsedIndex) {',
    '                sliceIdx = parsedIndex;',
    '              }',
    '            }',
    '            var parsedTotal = match[3] ? parseInt(match[3], 10) : (match[2] ? parseInt(match[2], 10) : 0);',
    '            if (parsedTotal > totalSlices) totalSlices = parsedTotal;',
    '          }',
    '        } catch(e) {}',
    '      }',
    '      if (sliceIdx < 0) sliceIdx = 0;',
    '      var dsUid = activeVp ? (',
    '        activeVp.displaySetInstanceUID ||',
    '        (Array.isArray(activeVp.displaySetInstanceUIDs) ? activeVp.displaySetInstanceUIDs[0] : null) ||',
    '        (activeVp.displaySetOptions && activeVp.displaySetOptions[0] ? (activeVp.displaySetOptions[0].displaySetInstanceUID || (Array.isArray(activeVp.displaySetOptions[0].displaySetInstanceUIDs) ? activeVp.displaySetOptions[0].displaySetInstanceUIDs[0] : null)) : null)',
    '      ) : null;',
    '      var ds = (dss && dsUid && typeof dss.getDisplaySetByUID === "function") ? dss.getDisplaySetByUID(dsUid) : null;',
    '      var seriesUID = ds ? (ds.SeriesInstanceUID || ds.seriesInstanceUid) : null;',
    '      var seriesDesc = ds ? (ds.SeriesDescription || ds.seriesDescription) : null;',
    '      var modality = ds ? (ds.Modality || ds.modality) : "CT";',
    '      if (csvp && imageIds && imageIds.length > 0) {',
    '        var currentImgId = imageIds[sliceIdx] || imageIds[0];',
    '        if (currentImgId && window.cornerstone3D && window.cornerstone3D.metaData) {',
    '          try {',
    '            var seriesMod = window.cornerstone3D.metaData.get("generalSeriesModule", currentImgId) || window.cornerstone3D.metaData.get("seriesModule", currentImgId);',
    '            if (seriesMod) {',
    '              if (!seriesUID) seriesUID = seriesMod.seriesInstanceUID || seriesMod.seriesInstanceUid;',
    '              if (!seriesDesc) seriesDesc = seriesMod.seriesDescription || seriesMod.seriesDesc;',
    '              if (seriesMod.modality) modality = seriesMod.modality;',
    '            }',
    '          } catch(e) {}',
    '        }',
    '      }',
    '      if ((!seriesDesc || seriesDesc === "Diagnostic Viewport" || seriesDesc === "Diagnostic Series") && activePane) {',
    '        try {',
    '          var paneText = activePane.innerText || activePane.textContent || "";',
    '          var rDate = new RegExp("^\\\\d{2}-[A-Za-z]{3}-\\\\d{4}");',
    '          var rSlice = new RegExp("^\\\\d+\\\\s*[\\\\/\\\\(]\\\\s*\\\\d+");',
    '          var rWL = new RegExp("W:\\\\d+");',
    '          var textLines = paneText.split("\\n").map(function(l) { return l.trim(); }).filter(function(l) {',
    '            return l.length > 1 && !rDate.test(l) && !rSlice.test(l) && !rWL.test(l);',
    '          });',
    '          if (textLines.length > 0) {',
    '            seriesDesc = textLines[0];',
    '          }',
    '        } catch(e) {}',
    '      }',
    '      if (!seriesDesc) seriesDesc = "Diagnostic Series";',
    '      var sopUid = (ds && ds.images && ds.images[sliceIdx]) ? (ds.images[sliceIdx].SOPInstanceUID || ds.images[sliceIdx].sopInstanceUid) : null;',
    '      var canvas = csvp && csvp.element ? csvp.element.querySelector("canvas") : (activePane ? activePane.querySelector("canvas") : document.querySelector("canvas"));',
    '      var dataUrl = canvas && canvas.width > 50 ? canvas.toDataURL("image/jpeg", 0.92) : null;',
    '      return {',
    '        seriesInstanceUID: seriesUID,',
    '        seriesDescription: seriesDesc,',
    '        sliceNumber: Math.max(1, sliceIdx + 1),',
    '        totalSlices: totalSlices,',
    '        sopInstanceUid: sopUid,',
    '        modality: modality,',
    '        dataUrl: dataUrl',
    '      };',
    '    } catch(err) {',
    '      console.warn("⚠️ OHIF AutoTrack error:", err.message);',
    '      return null;',
    '    }',
    '  }',
    '  function broadcastState(eventType) {',
    '    var state = getActiveViewportState();',
    '    if (!state) return;',
    '    try {',
    '      window.parent.postMessage({',
    '        type: eventType || "OHIF_VIEWPORT_CHANGE",',
    '        eventName: eventType || "OHIF_VIEWPORT_CHANGE",',
    '        payload: state,',
    '        seriesInstanceUID: state.seriesInstanceUID,',
    '        seriesDescription: state.seriesDescription,',
    '        sliceNumber: state.sliceNumber,',
    '        totalSlices: state.totalSlices,',
    '        sopInstanceUid: state.sopInstanceUid,',
    '        modality: state.modality,',
    '        dataUrl: state.dataUrl',
    '      }, "*");',
    '    } catch(e) {}',
    '  }',
    '  window.addEventListener("message", function(event) {',
    '    if (!event.data || typeof event.data !== "object") return;',
    '    if (event.data.type === "OHIF_GET_ACTIVE_VIEWPORT" || event.data.type === "REQUEST_SNAPSHOT") {',
    '      var state = getActiveViewportState();',
    '      var payload = state || { status: "failed" };',
    '      event.source.postMessage({',
    '        type: "OHIF_VIEWPORT_STATE",',
    '        status: state ? "success" : "failed",',
    '        payload: payload,',
    '        seriesInstanceUID: payload.seriesInstanceUID,',
    '        seriesDescription: payload.seriesDescription,',
    '        sliceNumber: payload.sliceNumber,',
    '        totalSlices: payload.totalSlices,',
    '        sopInstanceUid: payload.sopInstanceUid,',
    '        modality: payload.modality,',
    '        dataUrl: payload.dataUrl',
    '      }, "*");',
    '    }',
    '  });',
    '  document.addEventListener("click", function() { setTimeout(function() { broadcastState("OHIF_VIEWPORT_CHANGE"); }, 150); }, true);',
    '  document.addEventListener("wheel", function() { setTimeout(function() { broadcastState("OHIF_VIEWPORT_CHANGE"); }, 150); }, true);',
    '  document.addEventListener("keydown", function() { setTimeout(function() { broadcastState("OHIF_VIEWPORT_CHANGE"); }, 150); }, true);',
    '  window.addEventListener("load", function() {',
    '    setTimeout(function() { broadcastState("OHIF_VIEWPORT_CHANGE"); }, 1500);',
    '    setTimeout(function() { broadcastState("OHIF_VIEWPORT_CHANGE"); }, 3000);',
    '  });',
    '})();',
    '</script>'
  ].join('\n');

  app.use(
    "/viewer",
    createProxyMiddleware({
      target: "http://Orthanc:8042",
      router: getDynamicTarget,
      changeOrigin: true,
      pathRewrite: (path) => {
        let clean = (path || "").replace(/index\.html/i, "");
        if (clean.includes("app-config.js")) return "/ohif/app-config.js";
        clean = clean.replace(/^\/+/, "");
        if (clean.startsWith("viewer")) clean = clean.substring(6);
        return "/ohif" + (clean.startsWith("?") || !clean ? (clean.startsWith("?") ? clean : "/" + clean) : (clean.startsWith("/") ? clean : "/" + clean));
      },
      selfHandleResponse: true,
      on: {
        proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
          const contentType = proxyRes.headers["content-type"] || "";
          if (contentType.includes("html")) {
            let bodyStr = "";
            const encoding = proxyRes.headers["content-encoding"];
            try {
              if (encoding === "gzip") {
                bodyStr = zlib.gunzipSync(responseBuffer).toString("utf8");
              } else if (encoding === "deflate") {
                bodyStr = zlib.inflateSync(responseBuffer).toString("utf8");
              } else {
                bodyStr = responseBuffer.toString("utf8");
              }
            } catch (e) {
              bodyStr = responseBuffer.toString("utf8");
            }
            delete proxyRes.headers["content-encoding"];
            delete proxyRes.headers["content-length"];
            return bodyStr.replace("</head>", `${autoTrackScript}\n</head>`);
          }
          return responseBuffer;
        }),
        proxyReq: handleProxyReqAuth
      }
    })
  );

  app.use(
    "/ohif",
    createProxyMiddleware({
      target: "http://Orthanc:8042",
      router: getDynamicTarget,
      changeOrigin: true,
      pathRewrite: (path) => {
        let clean = (path || "").replace(/index\.html/i, "");
        if (clean.includes("app-config.js")) return "/ohif/app-config.js";
        return "/ohif" + (clean.startsWith("/") ? clean : "/" + clean);
      },
      selfHandleResponse: true,
      on: {
        proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
          const contentType = proxyRes.headers["content-type"] || "";
          if (contentType.includes("html")) {
            let bodyStr = "";
            const encoding = proxyRes.headers["content-encoding"];
            try {
              if (encoding === "gzip") {
                bodyStr = zlib.gunzipSync(responseBuffer).toString("utf8");
              } else if (encoding === "deflate") {
                bodyStr = zlib.inflateSync(responseBuffer).toString("utf8");
              } else {
                bodyStr = responseBuffer.toString("utf8");
              }
            } catch (e) {
              bodyStr = responseBuffer.toString("utf8");
            }
            delete proxyRes.headers["content-encoding"];
            delete proxyRes.headers["content-length"];
            return bodyStr.replace("</head>", `${autoTrackScript}\n</head>`);
          }
          return responseBuffer;
        }),
        proxyReq: handleProxyReqAuth
      }
    })
  );

  // DICOMweb WADO/QIDO DICOM streaming proxies for embedded OHIF viewer
  app.use(
    "/dicom-web",
    createProxyMiddleware({
      target: "http://Orthanc:8042",
      router: getDynamicTarget,
      changeOrigin: true,
      pathRewrite: (path) => {
        return "/dicom-web" + (path.startsWith("/") ? path : "/" + path);
      },
      selfHandleResponse: true,
      on: {
        proxyRes: responseInterceptor(async (responseBuffer, proxyRes) => {
          const contentType = proxyRes.headers["content-type"] || "";
          if (contentType.includes("json") || contentType.includes("text/")) {
            const body = responseBuffer.toString("utf8");
            return body
              .replace(/http:\/\/localhost:8042\/dicom-web/g, "/dicom-web")
              .replace(/http:\/\/127\.0\.0\.1:8042\/dicom-web/g, "/dicom-web")
              .replace(/http:\/\/host\.docker\.internal:8042\/dicom-web/g, "/dicom-web")
              .replace(/http:\/\/Orthanc:8042\/dicom-web/g, "/dicom-web");
          }
          return responseBuffer;
        }),
        proxyReq: handleProxyReqAuth
      }
    })
  );

  app.use(
    ["/wado", "/instances", "/series", "/studies"],
    createProxyMiddleware({
      target: "http://Orthanc:8042",
      router: getDynamicTarget,
      changeOrigin: true,
      onProxyReq: handleProxyReqAuth
    })
  );
} catch (err) {
  logger.warn("http-proxy-middleware module omitted; skipping embedded OHIF proxy middleware.");
}

// Routes Mounts
const authRoutes = require("./routes/auth");
app.use("/api", authRoutes);

const healthRoutes = require("./routes/health");
app.use("/health", healthRoutes);

const interoperabilityRoutes = require("./routes/interoperability");
app.use("/api/public/interoperability", interoperabilityRoutes);

const shareTokensRoutes = require("./routes/shareTokens");
app.use("/api/public/share", shareTokensRoutes);

const clinicsRoutes = require("./routes/clinics");
app.use("/api/public/clinics", clinicsRoutes);

const requireAuth = require("./middleware/auth");
const { checkRole } = require("./middleware/rbac");
app.use("/api", requireAuth);
app.use("/api/share", shareTokensRoutes);

const usersRoutes = require("./routes/users");
app.use("/api/users", checkRole("ADMIN"), usersRoutes);

const reportedByRouter = require("./routes/reportedBy");
app.use("/api/reported-by", reportedByRouter);

const mwlRoutes = require("./routes/mwl");
const mwlPublicRoutes = require("./routes/mwlRoutes");
app.use("/api/mwl", mwlRoutes);
app.use("/mwl", mwlPublicRoutes);

const mwlTargetsRoutes = require("./routes/mwlTargets");
app.use("/api/mwl-targets", mwlTargetsRoutes);

const mwlSettingsRoutes = require("./routes/mwlSettings");
app.use("/api/mwl-settings", checkRole("ADMIN"), mwlSettingsRoutes);

app.use("/api/clinics", clinicsRoutes);

const reportsRoutes = require("./routes/reports");
app.use("/api", reportsRoutes);
app.use("/", reportsRoutes);

const patientsRoutes = require("./routes/patients");
app.use("/api/patients", patientsRoutes);

const studiesRoutes = require("./routes/studies");
app.use("/api/studies", studiesRoutes);

const appointmentsRoutes = require("./routes/appointments");
app.use("/api/appointments", appointmentsRoutes);

const reportTemplatesRoutes = require("./routes/reportTemplates");
app.use("/api", reportTemplatesRoutes);

const pacsRoutes = require("./routes/pacs");
app.use("/api/pacs", pacsRoutes);

const modalitiesRoutes = require("./routes/modalities");
app.use("/api", modalitiesRoutes);

const speechRoutes = require("./routes/speech");
app.use("/api/speech", speechRoutes);

const aiReportingRoutes = require("./routes/aiReporting");
app.use("/api/ai", aiReportingRoutes);
app.use("/api/ai-reporting", aiReportingRoutes);

const auditRoutes = require("./routes/audit");
app.use("/api/audit", checkRole("ADMIN"), auditRoutes);

const billingRoutes = require("./routes/billing");
app.use("/api/billing", billingRoutes);

const analyticsRoutes = require("./routes/analytics");
app.use("/api/analytics", analyticsRoutes);

const backupRoutes = require("./routes/backup");
app.use("/api/backup", checkRole("ADMIN"), backupRoutes);

const dicomDataRoutes = require("./routes/dicomData");
app.use("/api/dicom-data", dicomDataRoutes);

const complianceRoutes = require("./routes/compliance");
app.use("/api/compliance", complianceRoutes);

const privacyRoutes = require("./routes/privacy");
app.use("/api/privacy", privacyRoutes);

// Unauthenticated public route for Login screen hospital branding
app.get("/api/public/hospital-info", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, header_text, logo_url, address, phone, email FROM clinics WHERE is_active = true ORDER BY id ASC LIMIT 1`
    ).catch(() => ({ rows: [] }));

    if (result.rows && result.rows.length > 0) {
      return res.json({ success: true, hospital: result.rows[0] });
    }

    res.json({
      success: true,
      hospital: {
        name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
        header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING"
      }
    });
  } catch (err) {
    res.json({
      success: true,
      hospital: {
        name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
        header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING"
      }
    });
  }
});

const tenantAuth = require("./middleware/tenantAuth");
app.use("/api", tenantAuth);

const hospitalsRoutes = require("./routes/hospitals");
app.use("/api/hospitals", checkRole("ADMIN"), hospitalsRoutes);

const referringDoctorsRoutes = require("./routes/referringDoctors");
app.use("/api/referring-doctors", referringDoctorsRoutes);

const dicomWebRoutes = require("./routes/dicomWeb");
app.use("/api/dicomweb", dicomWebRoutes);

const publicReportSheetRoutes = require("./routes/publicReportSheet");
app.use("/api/public/report-sheet", publicReportSheetRoutes);

const { startAuditArchiveScheduler } = require("./utils/auditLogger");
const { startMwlAutoPushScheduler } = require("./services/mwlAutoPush");
const { startHl7MllpServer } = require("./services/hl7MllpService");

// Start HL7 MLLP TCP Ingest Server on Port 6060
startHl7MllpServer(process.env.HL7_MLLP_PORT || 6060);

app.use(sentry.errorHandler);
app.use(errorHandler);

const { runMigrations } = require("./migrations/runner");

// Database Connection & Server Listener Startup
pool
  .connect()
  .then(async (client) => {
    logger.info("🟢 Connected to PostgreSQL database pool.");

    try {
      const schemaPath = path.join(__dirname, "schema_docker_init.sql");
      if (fs.existsSync(schemaPath)) {
        const sql = fs.readFileSync(schemaPath, "utf8");
        await client.query(sql);
        logger.info("✅ Verified and initialized database schema.");
      }
    } catch (dbErr) {
      logger.warn("Auto-schema initialization notice:", dbErr.message);
    }

    try {
      await runMigrations();
      logger.info("✅ Database schema migrations executed successfully.");
    } catch (migErr) {
      logger.warn("Migration execution notice:", migErr.message);
    }

    client.release();

    const buildPath = path.join(__dirname, "../build");
    const indexPath = path.join(buildPath, "index.html");
    if (fs.existsSync(buildPath) && fs.existsSync(indexPath)) {
      logger.info("✅ React build folder found. Serving static frontend...");
      app.use(express.static(buildPath));
      app.get(/^\/(?!api|graphql).*/, (req, res) => {
        res.sendFile(indexPath);
      });
    }

    server.listen(PORT, "0.0.0.0", () => {
      logger.info(`🚀 iPACX RIS Server listening on 0.0.0.0:${PORT}`);
      startAuditArchiveScheduler();
      startMwlAutoPushScheduler();
    });
  })
  .catch((err) => {
    logger.error("🔴 Failed to connect to PostgreSQL database", { error: err.message });
    process.exit(1);
  });

process.on("unhandledRejection", (reason, promise) => {
  logger.error("🔴 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  logger.error("🔴 Uncaught Exception thrown:", err);
});
