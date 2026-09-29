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
    } catch (e) {
      // Ignore header setting error
    }
  };

  const ohifBridgeScript = `
<script id="ohif-ris-bridge-script">
(function() {
  var lastActiveViewportId = null;

  function trackActiveViewport(e) {
    try {
      var target = e.target;
      if (!target) return;
      if (target.closest && target.closest('.study-browser, .thumbnail-list, .sidebar, .study-list, .series-quick-switch, [class*="thumbnail"], [class*="Thumbnail"], [class*="SeriesItem"]')) {
        return;
      }
      var vpElement = target.closest ? target.closest('[data-viewport-uid], [data-cy="viewport-container"], .viewport-element, .viewport-wrapper, .cornerstone-viewport-element, .viewport-grid-item') : null;
      if (vpElement) {
        var uid = vpElement.getAttribute('data-viewport-uid') || vpElement.id || vpElement.getAttribute('data-cy');
        if (uid) {
          lastActiveViewportId = uid;
        }
      }
    } catch (err) {}
  }

  document.addEventListener('mousedown', trackActiveViewport, true);
  document.addEventListener('pointerdown', trackActiveViewport, true);
  document.addEventListener('click', trackActiveViewport, true);
  document.addEventListener('wheel', trackActiveViewport, true);

  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'OHIF_GET_ACTIVE_VIEWPORT') {
      try {
        var servicesManager = window.servicesManager || (window.ohif && window.ohif.servicesManager) || (window.ohifApp && window.ohifApp.servicesManager);
        var vgs = servicesManager ? servicesManager.services.viewportGridService : null;
        var dss = servicesManager ? servicesManager.services.displaySetService : null;
        var cvs = servicesManager ? servicesManager.services.cornerstoneViewportService : null;

        var activeViewportId = lastActiveViewportId;

        if (!activeViewportId && vgs) {
          try {
            var gridState = typeof vgs.getState === 'function' ? vgs.getState() : null;
            activeViewportId = (gridState && gridState.activeViewportId) || (typeof vgs.getActiveViewportId === 'function' ? vgs.getActiveViewportId() : null);
          } catch(e) {}
        }

        if (!activeViewportId) {
          try {
            var candidates = Array.from(document.querySelectorAll('[data-viewport-uid], [data-cy="viewport-container"], .viewport-element, .viewport-wrapper, .viewport-grid-item'));
            for (var i = 0; i < candidates.length; i++) {
              var el = candidates[i];
              var uid = el.getAttribute('data-viewport-uid') || el.id;
              if (!uid) continue;
              if (el.classList.contains('active') || el.classList.contains('border-primary') || el.getAttribute('data-active') === 'true') {
                activeViewportId = uid;
                break;
              }
            }
          } catch(e) {}
        }

        console.log('[OHIF Bridge] Active Viewport ID:', activeViewportId);

        var viewport = null;
        if (vgs && activeViewportId) {
          if (typeof vgs.getViewport === 'function') {
            try { viewport = vgs.getViewport(activeViewportId); } catch(e) {}
          }
          if (!viewport && typeof vgs.getState === 'function') {
            try {
              var st = vgs.getState();
              if (st && st.viewports) {
                if (typeof st.viewports.get === 'function') viewport = st.viewports.get(activeViewportId);
                else if (typeof st.viewports === 'object') viewport = st.viewports[activeViewportId];
              }
            } catch(e) {}
          }
        }

        var displaySetInstanceUID = viewport ? (viewport.displaySetInstanceUID || (Array.isArray(viewport.displaySetInstanceUIDs) ? viewport.displaySetInstanceUIDs[0] : null)) : null;
        var displaySet = (dss && displaySetInstanceUID && typeof dss.getDisplaySetByUID === 'function') ? dss.getDisplaySetByUID(displaySetInstanceUID) : null;
        var cornerstoneViewport = (cvs && activeViewportId && typeof cvs.getCornerstoneViewport === 'function') ? cvs.getCornerstoneViewport(activeViewportId) : null;

        var sliceNumber = 1;
        var totalSlices = 1;
        var sopInstanceUid = null;
        var seriesInstanceUID = displaySet ? (displaySet.SeriesInstanceUID || displaySet.seriesInstanceUid) : null;
        var seriesDescription = displaySet ? (displaySet.SeriesDescription || displaySet.seriesDescription) : null;
        var modality = displaySet ? (displaySet.Modality || displaySet.modality) : 'CT';

        if (cornerstoneViewport) {
          try {
            if (typeof cornerstoneViewport.getCurrentImageIdIndex === 'function') {
              sliceNumber = cornerstoneViewport.getCurrentImageIdIndex() + 1;
            } else if (typeof cornerstoneViewport.getSliceIndex === 'function') {
              sliceNumber = cornerstoneViewport.getSliceIndex() + 1;
            }
          } catch(e) {}

          try {
            var imageIds = cornerstoneViewport.getImageIds ? cornerstoneViewport.getImageIds() : [];
            totalSlices = imageIds.length || 1;
            if (imageIds.length > 0 && sliceNumber > 0) {
              var currentImageId = imageIds[sliceNumber - 1] || imageIds[0];
            }
          } catch(e) {}
        }

        if (displaySet && displaySet.images && displaySet.images[sliceNumber - 1]) {
          sopInstanceUid = displaySet.images[sliceNumber - 1].SOPInstanceUID || displaySet.images[sliceNumber - 1].sopInstanceUid;
        } else if (displaySet && displaySet.images && displaySet.images[0]) {
          sopInstanceUid = displaySet.images[0].SOPInstanceUID || displaySet.images[0].sopInstanceUid;
        }

        window.parent.postMessage({
          type: 'OHIF_VIEWPORT_STATE',
          success: true,
          viewportId: activeViewportId,
          seriesInstanceUID: seriesInstanceUID,
          seriesDescription: seriesDescription,
          modality: modality,
          sopInstanceUid: sopInstanceUid,
          sliceNumber: sliceNumber,
          totalSlices: totalSlices
        }, '*');
      } catch (err) {
        console.error('[OHIF Bridge] Error:', err);
        window.parent.postMessage({ type: 'OHIF_VIEWPORT_STATE', error: err.message }, '*');
      }
    }
  });
})();
</script>
`;

  const handleOhifHtmlInterceptor = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
    const contentType = proxyRes.headers["content-type"] || "";
    const contentEncoding = proxyRes.headers["content-encoding"] || "";
    const isHtml = contentType.toLowerCase().includes("text/html");

    if (isHtml) {
      let body = "";
      let isGzipped = contentEncoding.includes("gzip");

      try {
        if (isGzipped) {
          body = zlib.gunzipSync(responseBuffer).toString("utf8");
        } else {
          body = responseBuffer.toString("utf8");
        }

        if (body && !body.includes("ohif-ris-bridge-script")) {
          if (body.includes("</head>")) {
            body = body.replace("</head>", `${ohifBridgeScript}</head>`);
          } else if (body.includes("</body>")) {
            body = body.replace("</body>", `${ohifBridgeScript}</body>`);
          } else {
            body = body + ohifBridgeScript;
          }

          if (isGzipped) {
            res.setHeader("content-encoding", "gzip");
            return zlib.gzipSync(body);
          } else {
            return body;
          }
        }
      } catch (err) {
        logger.warn("OHIF bridge script injection notice: " + err.message);
      }
    }
    return responseBuffer;
  });

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
      selfHandleResponse: true,
      on: {
        proxyRes: handleOhifHtmlInterceptor,
        proxyReq: handleProxyReqAuth
      }
    })
  );

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
        proxyRes: handleOhifHtmlInterceptor,
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
        proxyRes: handleOhifHtmlInterceptor,
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
  });

process.on("unhandledRejection", (reason, promise) => {
  logger.error("🔴 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  logger.error("🔴 Uncaught Exception thrown:", err);
});
