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
].filter(Boolean);

const lanOriginPattern = /^http:\/\/(192\.168|10|172\.(1[6-9]|2[0-9]|3[01]))\.\d{1,3}\.\d{1,3}(:\d+)?$/;

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || lanOriginPattern.test(origin)) {
      return callback(null, true);
    }
    logger.warn(`[CORS Blocked] Origin: ${origin}`);
    return callback(new Error("Not allowed by CORS"));
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

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads/report_images", express.static(path.join(__dirname, "uploads/report_images")));
app.use("/uploads/signatures", express.static(path.join(__dirname, "uploads/signatures")));
// Proxy OHIF Viewer for same-origin iframe canvas capture with automatic Orthanc authentication
try {
  const { createProxyMiddleware, responseInterceptor } = require("http-proxy-middleware");
  const { getOrthancUrl, getOrthancAuthHeader, getActivePacsCredentials } = require("./utils/orthancHelper");

  const getDynamicTarget = async () => {
    const url = await getOrthancUrl();
    return url.replace(/\/$/, "");
  };

  const handleProxyReqAuth = async (proxyReq) => {
    await getActivePacsCredentials();
    proxyReq.setHeader("Authorization", getOrthancAuthHeader());
  };

  const ohifBridgeScript = `
<script id="ohif-ris-bridge-script">
(function() {
  function sendViewportState() {
    try {
      var cs = window.cornerstone;
      if (cs && typeof cs.getRenderingEngines === 'function') {
        var engines = cs.getRenderingEngines();
        for (var i = 0; i < engines.length; i++) {
          var vps = engines[i].getViewports ? engines[i].getViewports() : [];
          for (var j = 0; j < vps.length; j++) {
            var vp = vps[j];
            var el = vp.element;
            if (!el) continue;
            var isActive = el.classList.contains('active') || el.closest('.active') || el.classList.contains('selected') || vps.length === 1;
            if (isActive) {
              var idx = typeof vp.getCurrentImageIdIndex === 'function' ? vp.getCurrentImageIdIndex() : null;
              var ids = typeof vp.getImageIds === 'function' ? vp.getImageIds() : [];
              if (idx !== null && idx >= 0) {
                var sliceNum = idx + 1;
                var total = ids ? ids.length : null;
                var imgId = ids[idx] || '';
                var seriesUid = (imgId.match(/series\/([0-9.]+)/i) || imgId.match(/seriesInstanceUID=([0-9.]+)/i) || [])[1] || '';
                var sopUid = (imgId.match(/instances\/([0-9.]+)/i) || imgId.match(/sopInstanceUID=([0-9.]+)/i) || [])[1] || '';
                window.parent.postMessage({
                  type: 'OHIF_VIEWPORT_CHANGE',
                  payload: {
                    frameNumber: sliceNum,
                    sliceNumber: sliceNum,
                    sliceIndex: idx,
                    totalSlices: total,
                    seriesInstanceUid: seriesUid,
                    sopInstanceUid: sopUid
                  }
                }, '*');
              }
            }
          }
        }
      }
    } catch(e) {}
  }

  window.addEventListener('message', function(ev) {
    var d = ev.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch(e) {} }
    if (d && (d.type === 'REQUEST_SNAPSHOT' || d.type === 'OHIF_CAPTURE_VIEWPORT')) {
      sendViewportState();
      try {
        var cs = window.cornerstone;
        if (cs && typeof cs.getRenderingEngines === 'function') {
          var engines = cs.getRenderingEngines();
          for (var i = 0; i < engines.length; i++) {
            var vps = engines[i].getViewports ? engines[i].getViewports() : [];
            for (var j = 0; j < vps.length; j++) {
              var vp = vps[j];
              var el = vp.element;
              var isActive = el && (el.classList.contains('active') || el.closest('.active') || vps.length === 1);
              if (isActive && el) {
                var cv = el.querySelector('canvas') || el;
                if (cv && typeof cv.toDataURL === 'function') {
                  var dataUrl = cv.toDataURL('image/jpeg', 0.95);
                  var idx = typeof vp.getCurrentImageIdIndex === 'function' ? vp.getCurrentImageIdIndex() : 0;
                  var ids = typeof vp.getImageIds === 'function' ? vp.getImageIds() : [];
                  var imgId = ids[idx] || '';
                  var seriesUid = (imgId.match(/series\/([0-9.]+)/i) || imgId.match(/seriesInstanceUID=([0-9.]+)/i) || [])[1] || '';
                  var sopUid = (imgId.match(/instances\/([0-9.]+)/i) || imgId.match(/sopInstanceUID=([0-9.]+)/i) || [])[1] || '';
                  window.parent.postMessage({
                    type: 'SNAPSHOT_CAPTURED',
                    payload: {
                      dataUrl: dataUrl,
                      frameNumber: idx + 1,
                      sliceNumber: idx + 1,
                      totalSlices: ids.length,
                      seriesInstanceUid: seriesUid,
                      sopInstanceUid: sopUid
                    }
                  }, '*');
                  return;
                }
              }
            }
          }
        }
      } catch(e) {}
    }
  });

  document.addEventListener('mouseup', sendViewportState, true);
  document.addEventListener('wheel', function() { setTimeout(sendViewportState, 100); }, true);
  document.addEventListener('keyup', sendViewportState, true);
  setInterval(sendViewportState, 1000);
})();
</script>
`;

  const handleOhifHtmlInterceptor = responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
    const contentType = proxyRes.headers["content-type"] || "";
    const contentEncoding = proxyRes.headers["content-encoding"] || "";
    const isHtml = contentType.includes("html") || contentType.includes("text/") || (req.url && (req.url.includes("index.html") || req.url === "/ohif" || req.url === "/viewer"));

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
        const cleanPath = (path || "").replace(/^\/+/, "");
        return "/ohif/viewer" + (cleanPath.startsWith("?") || !cleanPath ? cleanPath : "/" + cleanPath);
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
        return "/ohif" + (path.startsWith("/") ? path : "/" + path);
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
