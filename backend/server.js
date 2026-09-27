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
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
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
  var lastActiveViewportEl = null;
  var lastActiveTimestamp = 0;

  function isSidebarOrThumbnail(el) {
    if (!el) return false;
    try {
      return !!(el.closest && el.closest('.study-browser, .thumbnail-list, .sidebar, .study-list, .series-quick-switch, nav, header, [class*="thumbnail"], [class*="Thumbnail"], [class*="SeriesItem"], [class*="sidebar"], [class*="Sidebar"], [class*="StudyBrowser"], [data-cy*="study-browser"], [data-cy*="thumbnail"]'));
    } catch(e) {
      return false;
    }
  }

  function trackActiveViewport(e) {
    var target = e.target;
    if (!target) return;
    var vp = target.closest && target.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .cornerstone-viewport-element, .viewport-container, .viewport-grid-item, [data-cy="viewport-container"], div[class*="viewport"], div[class*="Viewport"]');
    if (!vp && target.tagName === 'CANVAS') {
      vp = target.parentElement;
    }
    if (vp && !isSidebarOrThumbnail(vp)) {
      lastActiveViewportEl = vp;
      lastActiveTimestamp = Date.now();
      vp._lastInteractionTime = lastActiveTimestamp;
    }
  }

  document.addEventListener('mousedown', trackActiveViewport, true);
  document.addEventListener('pointerdown', trackActiveViewport, true);
  document.addEventListener('click', trackActiveViewport, true);
  document.addEventListener('wheel', trackActiveViewport, true);
  document.addEventListener('scroll', trackActiveViewport, true);
  document.addEventListener('keydown', trackActiveViewport, true);

  function getActiveViewportContainer() {
    // Priority 1: Check Cornerstone3D viewport with active scroll position (idx > 0) or interaction
    try {
      var cs3 = window.cornerstone3D || window.cornerstone || window.cornerstoneCore;
      if (cs3 && typeof cs3.getRenderingEngines === 'function') {
        var engs = cs3.getRenderingEngines();
        var bestScrolledVpEl = null;
        var maxScrolledIdx = -1;
        var lastInteractedVpEl = null;

        for (var eIdx = 0; eIdx < engs.length; eIdx++) {
          var vps = engs[eIdx].getViewports ? engs[eIdx].getViewports() : [];
          for (var vIdx = 0; vIdx < vps.length; vIdx++) {
            var vItem = vps[vIdx];
            var vEl = vItem.element;
            if (!vEl || isSidebarOrThumbnail(vEl)) continue;

            if (vEl === lastActiveViewportEl || (lastActiveViewportEl && vEl.contains(lastActiveViewportEl))) {
              lastInteractedVpEl = vEl;
            }

            var curIdx = typeof vItem.getCurrentImageIdIndex === 'function' ? vItem.getCurrentImageIdIndex() : (typeof vItem.sliceIndex === 'number' ? vItem.sliceIndex : 0);
            if (curIdx > maxScrolledIdx) {
              maxScrolledIdx = curIdx;
              bestScrolledVpEl = vEl;
            }
          }
        }
        if (lastInteractedVpEl && document.body.contains(lastInteractedVpEl)) {
          return lastInteractedVpEl;
        }
        if (bestScrolledVpEl && maxScrolledIdx > 0) {
          return bestScrolledVpEl;
        }
      }
    } catch (e) {}

    if (lastActiveViewportEl && document.body.contains(lastActiveViewportEl) && !isSidebarOrThumbnail(lastActiveViewportEl)) {
      return lastActiveViewportEl;
    }

    try {
      var sm = window.servicesManager || (window.ohif && window.ohif.servicesManager) || (window.ohifApp && window.ohifApp.servicesManager);
      if (sm && sm.services && sm.services.viewportGridService) {
        var vpgs = sm.services.viewportGridService;
        var activeVpId = typeof vpgs.getActiveViewportId === 'function' ? vpgs.getActiveViewportId() : null;
        var cs = window.cornerstone3D || window.cornerstone || window.cornerstoneCore;
        if (activeVpId && cs && typeof cs.getRenderingEngines === 'function') {
          var engines = cs.getRenderingEngines();
          for (var i = 0; i < engines.length; i++) {
            var vp = typeof engines[i].getViewport === 'function' ? engines[i].getViewport(activeVpId) : null;
            if (vp && vp.element && !isSidebarOrThumbnail(vp.element)) {
              return vp.element;
            }
          }
        }
      }
    } catch (e) {}

    var activeCandidates = Array.from(document.querySelectorAll(
      '.viewport-element.active, .viewport-wrapper.active, [data-viewport-uid].active, .cornerstone-viewport-element.active, .viewport-container.active, .viewport-grid-item.active, .active-viewport, .viewport-element.selected, .viewport-wrapper.selected, [data-cy="viewport-container"][data-active="true"], [data-cy="viewport-container"].active, [data-cy="viewport-container"].border-primary, div[class*="border-primary"]'
    )).filter(function(el) {
      return !isSidebarOrThumbnail(el);
    });

    if (activeCandidates.length > 0) return activeCandidates[0];

    var canvases = Array.from(document.querySelectorAll('canvas'))
      .filter(function(c) { return !isSidebarOrThumbnail(c); })
      .map(function(c) {
        return { c: c, area: (c.clientWidth || c.width || 0) * (c.clientHeight || c.height || 0), parent: c.closest('.viewport-element, .viewport-wrapper, [data-viewport-uid], .viewport-grid-item, .viewport-container, [data-cy="viewport-container"]') || c.parentElement };
      })
      .filter(function(item) { return item.area > 5000 && !isSidebarOrThumbnail(item.parent); })
      .sort(function(a, b) { return b.area - a.area; });

    if (canvases.length > 0) return canvases[0].parent || canvases[0].c.parentElement;
    return document.body;
  }

  function parseViewportDOMOverlay(container) {
    var texts = [];
    if (!container) container = getActiveViewportContainer();
    
    // Ignore sidebar, thumbnail lists, study browser, and navigation drawers
    var tw = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node) {
        if (!node || !node.parentElement) return NodeFilter.FILTER_REJECT;
        if (isSidebarOrThumbnail(node.parentElement)) return NodeFilter.FILTER_REJECT;
        var val = node.nodeValue ? node.nodeValue.trim() : '';
        if (/^\d{1,2}[Yy]\s*\/\s*[MFmf]$/.test(val)) return NodeFilter.FILTER_REJECT; // Reject patient age e.g. "45Y / F"
        if (/^\d{1,2}\s*[A-Za-z]{3}\s*\d{4}$/.test(val)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }, false);

    var tn;
    while ((tn = tw.nextNode())) {
      var val = tn.nodeValue ? tn.nodeValue.trim() : '';
      if (val && val.length > 0 && val.length <= 150) texts.push(val);
    }

    var sliceNum = null, totalSlices = null, instNum = null, seriesDesc = null;

    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      // Pattern 0: "I : 208 (48/255)", "1 : 52 (52/313)", "116 (108/223)"
      var m = t.match(/(?:\d+|I|Im|Slice|Image)?\s*:?\s*(\d+)?\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
      if (m) {
        var inst = m[1] ? parseInt(m[1], 10) : null;
        var s = parseInt(m[2], 10);
        var tot = parseInt(m[3], 10);
        if (s > 0 && tot > 0 && s <= tot) {
          sliceNum = s;
          totalSlices = tot;
          if (inst) instNum = inst;
          break;
        }
      }

      // Pattern 1: "(48/255)" -> 2 numbers: SliceNum, TotalSlices
      m = t.match(/\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
      if (m) {
        var s = parseInt(m[1], 10);
        var tot = parseInt(m[2], 10);
        if (s > 0 && tot > 0 && s <= tot) {
          sliceNum = s;
          totalSlices = tot;
          break;
        }
      }

      // Pattern 2: "Im: 48/255", "Slice 48 of 255", "48/255"
      m = t.match(/(?:slice|image|im|frame|sl)\s*:?\s*(\d+)\s*(?:\/|of)\s*(\d+)/i);
      if (m) {
        var s = parseInt(m[1], 10);
        var tot = parseInt(m[2], 10);
        if (s > 0 && tot > 0 && s <= tot) {
          sliceNum = s;
          totalSlices = tot;
          break;
        }
      }
    }

    // Priority 1: Check overlay quadrant elements for Series Description
    var overlayEls = container ? container.querySelectorAll('.top-left, .top-right, [class*="top-left"], [class*="top-right"], .cornerstone-overlay-top-left, .cornerstone-overlay-top-right, .viewport-overlay-top-left, .viewport-overlay-top-right, [class*="overlay"], [class*="Overlay"]') : [];
    for (var k = 0; k < overlayEls.length; k++) {
      var el = overlayEls[k];
      var rawTxt = (el.textContent || el.innerText || '');
      var lines = rawTxt.split(/[\n\r]+/).map(function(l){ return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      for (var l = 0; l < lines.length; l++) {
        var trText = lines[l];
        if (trText && trText.length >= 2 && !/^\d+$/.test(trText) && !/\d+\s*\/\s*\d+/.test(trText) && !/^[WwLl]:/i.test(trText) && !/^\d{1,2}[\s\.\/-]+[A-Za-z]{3}[\s\.\/-]+\d{2,4}$/i.test(trText) && !/^(CT|MR|CR|DX|US|XA|PT|NM)$/i.test(trText)) {
          seriesDesc = trText;
          break;
        }
      }
      if (seriesDesc) break;
    }

    if (!seriesDesc) {
      for (var j = 0; j < texts.length; j++) {
        var txt = texts[j];
        if (!txt) continue;
        if (/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(txt)) continue;
        if (/\d+\s*\/\s*\d+/.test(txt)) continue;
        if (/^[WwLl]:\s*\d+/.test(txt) || /W:\s*\d+\s+L:\s*\d+/i.test(txt)) continue;
        if (/^[APLRHF]{1,2}$/i.test(txt)) continue;
        if (/^(CT|MR|CR|DX|US|XA|PT|NM)$/i.test(txt)) continue;
        if (/^\d+$/.test(txt)) continue;
        if (txt.length >= 3 && !seriesDesc) {
          seriesDesc = txt;
        }
      }
    }

    return { sliceNumber: sliceNum, totalSlices: totalSlices, instanceNumber: instNum, seriesDescription: seriesDesc, allTexts: texts };
  }

  function getOhifServicesInfo() {
    try {
      var sm = window.servicesManager || (window.ohif && window.ohif.servicesManager) || (window.ohifApp && window.ohifApp.servicesManager);
      if (!sm || !sm.services) return null;
      var vpgs = sm.services.viewportGridService;
      var cvps = sm.services.cornerstoneViewportService;
      var dss = sm.services.displaySetService;
      if (!vpgs) return null;

      var gridState = typeof vpgs.getState === 'function' ? vpgs.getState() : null;
      var activeVpId = (gridState && gridState.activeViewportId) || (typeof vpgs.getActiveViewportId === 'function' ? vpgs.getActiveViewportId() : null);

      var csSlice = null;
      var csTotal = null;

      if (cvps && activeVpId && typeof cvps.getCornerstoneViewport === 'function') {
        try {
          var csvp = cvps.getCornerstoneViewport(activeVpId);
          if (csvp) {
            var idx = typeof csvp.getCurrentImageIdIndex === 'function' ? csvp.getCurrentImageIdIndex() : (typeof csvp.sliceIndex === 'number' ? csvp.sliceIndex : null);
            var ids = typeof csvp.getImageIds === 'function' ? csvp.getImageIds() : [];
            if (idx !== null && idx >= 0) {
              csSlice = idx + 1;
              csTotal = ids ? ids.length : null;
            }
          }
        } catch(e) {}
      }

      var activeVp = null;
      if (gridState && gridState.viewports) {
        var vps = gridState.viewports;
        if (typeof vps.get === 'function' && activeVpId) {
          activeVp = vps.get(activeVpId);
        } else if (Array.isArray(vps) && activeVpId) {
          activeVp = vps.find(function(v) { return v.id === activeVpId || v.viewportId === activeVpId; });
        } else if (typeof vps === 'object' && activeVpId) {
          activeVp = vps[activeVpId];
        }
      }

      if (!activeVp && typeof vpgs.getViewport === 'function' && activeVpId) {
        try { activeVp = vpgs.getViewport(activeVpId); } catch(e) {}
      }

      if (activeVp) {
        var dsUid = activeVp.displaySetInstanceUID || (Array.isArray(activeVp.displaySetInstanceUIDs) ? activeVp.displaySetInstanceUIDs[0] : null);
        var ds = (dss && dsUid && typeof dss.getDisplaySetByUID === 'function') ? dss.getDisplaySetByUID(dsUid) : null;
        if (ds) {
          return {
            activeVpId: activeVpId,
            sliceIndex: csSlice,
            totalSlices: csTotal || ds.numImageFrames || (ds.images ? ds.images.length : null),
            seriesDescription: ds.SeriesDescription || ds.seriesDescription || null,
            seriesInstanceUid: ds.SeriesInstanceUID || ds.seriesInstanceUid || null,
            seriesNumber: ds.SeriesNumber || ds.seriesNumber || null,
            sopInstanceUid: activeVp.SOPInstanceUID || (ds.images && csSlice && ds.images[csSlice - 1] ? ds.images[csSlice - 1].SOPInstanceUID : (ds.images && ds.images[0] ? ds.images[0].SOPInstanceUID : null))
          };
        }
      }
      if (csSlice) {
        return {
          activeVpId: activeVpId,
          sliceIndex: csSlice,
          totalSlices: csTotal
        };
      }
    } catch(e) {}
    return null;
  }

  function getActiveCornerstoneInfo(container) {
    var bestInfo = { csSlice: null, csTotal: null, csSeriesUid: null, csSopUid: null, csSeriesDesc: null, csSeriesNum: null };
    var highestScore = -1;
    try {
      var cs = window.cornerstone3D || window.cornerstone || window.cornerstoneCore;
      if (cs && typeof cs.getRenderingEngines === 'function') {
        var engines = cs.getRenderingEngines();
        for (var i = 0; i < engines.length; i++) {
          var vps = engines[i].getViewports ? engines[i].getViewports() : [];
          for (var j = 0; j < vps.length; j++) {
            var vp = vps[j];
            var el = vp.element;
            if (!el || isSidebarOrThumbnail(el)) continue;

            var isContainerMatch = (
              el === container ||
              el.contains(container) ||
              (container && container.contains && container.contains(el)) ||
              el.querySelector('canvas') === container ||
              (container && container.querySelector && container.querySelector('canvas') === el.querySelector('canvas'))
            );
            var isLastActive = (el === lastActiveViewportEl);
            var isVpActive = el.classList.contains('active') || el.closest('.active') || el.classList.contains('selected') || el.getAttribute('data-active') === 'true';

            var idx = typeof vp.getCurrentImageIdIndex === 'function' ? vp.getCurrentImageIdIndex() : (typeof vp.sliceIndex === 'number' ? vp.sliceIndex : null);
            var ids = typeof vp.getImageIds === 'function' ? vp.getImageIds() : [];

            if (idx !== null && idx >= 0 && ids && ids.length > 0) {
              // Heavy weighting: Scrolled viewport (idx > 0) gets 50,000 points, Interacted gets 30,000 points
              var score = (idx > 0 ? 50000 : 0) + (isLastActive ? 30000 : 0) + (isVpActive ? 20000 : 0) + (isContainerMatch ? 5000 : 0) + (ids.length > 1 ? 1000 : 0);

              if (score > highestScore) {
                highestScore = score;
                var imgId = ids[idx] || '';
                var cSeriesUid = '', cSopUid = '', cSeriesDesc = '', cSeriesNum = null;

                if (cs.metaData && typeof cs.metaData.get === 'function') {
                  try {
                    var seriesMod = cs.metaData.get('generalSeriesModule', imgId) || cs.metaData.get('seriesModule', imgId);
                    if (seriesMod) {
                      cSeriesUid = seriesMod.seriesInstanceUID || seriesMod.seriesInstanceUid || '';
                      cSeriesDesc = seriesMod.seriesDescription || seriesMod.seriesDesc || '';
                      cSeriesNum = seriesMod.seriesNumber || null;
                    }
                    var sopMod = cs.metaData.get('sopCommonModule', imgId) || cs.metaData.get('generalImageModule', imgId);
                    if (sopMod) {
                      cSopUid = sopMod.sopInstanceUID || sopMod.sopInstanceUid || '';
                    }
                  } catch(e) {}
                }

                if (!cSeriesUid) {
                  cSeriesUid = (imgId.match(/series\/([a-zA-Z0-9._-]+)/i) || imgId.match(/seriesInstanceUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/seriesUID=([a-zA-Z0-9._-]+)/i) || [])[1] || '';
                }
                if (!cSopUid) {
                  cSopUid = (imgId.match(/instances\/([a-zA-Z0-9._-]+)/i) || imgId.match(/sopInstanceUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/objectUID=([a-zA-Z0-9._-]+)/i) || imgId.match(/instanceUID=([a-zA-Z0-9._-]+)/i) || [])[1] || '';
                }

                bestInfo = {
                  csSlice: idx + 1,
                  csTotal: ids.length,
                  csSeriesUid: cSeriesUid,
                  csSopUid: cSopUid,
                  csSeriesDesc: cSeriesDesc,
                  csSeriesNum: cSeriesNum
                };
              }
            }
          }
        }
      }
    } catch(e) {}
    return bestInfo;
  }

  function sendViewportChange() {
    try {
      var container = getActiveViewportContainer();
      var overlayInfo = parseViewportDOMOverlay(container);
      var csInfo = getActiveCornerstoneInfo(container);
      var ohifInfo = getOhifServicesInfo();

      // Priority Order:
      // 1. overlayInfo (Directly scraped from active container overlay text e.g. "37 (37/401)" or "9 (9/25)")
      // 2. csInfo (Cornerstone3D viewport engine on active container)
      // 3. ohifInfo (Fallback from OHIF services manager)
      var finalSlice = overlayInfo.sliceNumber || csInfo.csSlice || (ohifInfo && ohifInfo.sliceIndex) || 1;
      var finalTotal = overlayInfo.totalSlices || csInfo.csTotal || (ohifInfo && ohifInfo.totalSlices) || null;
      var finalSeriesUid = csInfo.csSeriesUid || (ohifInfo && ohifInfo.seriesInstanceUid) || '';
      var finalSopUid = csInfo.csSopUid || (ohifInfo && ohifInfo.sopInstanceUid) || '';
      var finalSeriesDesc = overlayInfo.seriesDescription || csInfo.csSeriesDesc || (ohifInfo && ohifInfo.seriesDescription) || '';
      var finalSeriesNum = csInfo.csSeriesNum || (ohifInfo && ohifInfo.seriesNumber) || null;

      window.parent.postMessage({
        type: 'OHIF_VIEWPORT_CHANGE',
        payload: {
          frameNumber: finalSlice,
          sliceNumber: finalSlice,
          totalSlices: finalTotal,
          seriesInstanceUid: finalSeriesUid,
          sopInstanceUid: finalSopUid,
          seriesDescription: finalSeriesDesc,
          seriesNumber: finalSeriesNum
        }
      }, '*');
    } catch(err) {}
  }

  function captureAndSendViewport() {
    try {
      var container = getActiveViewportContainer();
      var cv = container ? (container.querySelector('canvas') || container) : document.querySelector('canvas');
      var dataUrl = null;
      if (cv && cv.tagName === 'CANVAS') {
        try {
          var tempCv = document.createElement('canvas');
          tempCv.width = cv.width || cv.clientWidth || 512;
          tempCv.height = cv.height || cv.clientHeight || 512;
          var ctx = tempCv.getContext('2d');
          if (ctx) {
            ctx.drawImage(cv, 0, 0);
            dataUrl = tempCv.toDataURL('image/jpeg', 0.95);
          }
        } catch(e) {
          try { dataUrl = cv.toDataURL('image/jpeg', 0.95); } catch(e2) {}
        }
      }
      var overlayInfo = parseViewportDOMOverlay(container);
      var csInfo = getActiveCornerstoneInfo(container);
      var ohifInfo = getOhifServicesInfo();

      var finalSlice = overlayInfo.sliceNumber || csInfo.csSlice || (ohifInfo && ohifInfo.sliceIndex) || 1;
      var finalTotal = overlayInfo.totalSlices || csInfo.csTotal || (ohifInfo && ohifInfo.totalSlices) || null;
      var finalSeriesUid = csInfo.csSeriesUid || (ohifInfo && ohifInfo.seriesInstanceUid) || '';
      var finalSopUid = csInfo.csSopUid || (ohifInfo && ohifInfo.sopInstanceUid) || '';
      var finalSeriesDesc = overlayInfo.seriesDescription || csInfo.csSeriesDesc || (ohifInfo && ohifInfo.seriesDescription) || '';
      var finalSeriesNum = csInfo.csSeriesNum || (ohifInfo && ohifInfo.seriesNumber) || null;

      window.parent.postMessage({
        type: 'SNAPSHOT_CAPTURED',
        payload: {
          dataUrl: (dataUrl && dataUrl.length > 500) ? dataUrl : null,
          frameNumber: finalSlice,
          sliceNumber: finalSlice,
          totalSlices: finalTotal,
          seriesInstanceUid: finalSeriesUid,
          sopInstanceUid: finalSopUid,
          seriesDescription: finalSeriesDesc,
          seriesNumber: finalSeriesNum
        }
      }, '*');
    } catch(err) {
      console.warn('[OHIF_BRIDGE] captureAndSendViewport exception:', err);
    }
  }

  window.addEventListener('message', function(ev) {
    var d = ev.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch(e) {} }
    if (d && (d.type === 'REQUEST_SNAPSHOT' || d.type === 'OHIF_CAPTURE_VIEWPORT' || d.action === 'CAPTURE')) {
      captureAndSendViewport();
    }
  });

  document.addEventListener('mouseup', sendViewportChange, true);
  document.addEventListener('keyup', sendViewportChange, true);
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
