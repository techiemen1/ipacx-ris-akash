const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  const orthancUser = process.env.ORTHANC_USER || "orthanc";
  const orthancPass = process.env.ORTHANC_PASS || "orthanc";
  const authHeader = "Basic " + Buffer.from(`${orthancUser}:${orthancPass}`).toString("base64");
  const orthancTarget = process.env.REACT_APP_ORTHANC_URL || "http://localhost:8042";

  const orthancProxy = createProxyMiddleware({
    target: orthancTarget,
    changeOrigin: true,
    auth: `${orthancUser}:${orthancPass}`,
    ws: true,
    onProxyReq: (proxyReq) => {
      proxyReq.setHeader("Authorization", authHeader);
    }
  });

  const ohifStandaloneTarget = process.env.REACT_APP_OHIF_VIEWER_URL || "http://localhost:3000";
  const ohifStandaloneProxy = createProxyMiddleware({
    target: ohifStandaloneTarget,
    changeOrigin: true,
    ws: true
  });

  // Proxy OHIF Viewer static app & DICOMweb / WADO DICOM image streaming endpoints
  app.use("/viewer", ohifStandaloneProxy);
  app.use("/ohif-viewer", orthancProxy);
  app.use("/ohif", orthancProxy);
  app.use("/dicom-web", orthancProxy);
  app.use("/wado", orthancProxy);
  app.use("/instances", orthancProxy);
  app.use("/series", orthancProxy);
  app.use("/studies", orthancProxy);
};
