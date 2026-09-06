const express = require("express");

const router = express.Router();

router.get("/validate", (req, res) => {
  const configuredToken = String(process.env.REPORT_SHEET_TOKEN || "").trim();
  const providedToken = String(req.query.k || req.headers["x-report-key"] || "").trim();

  if (!configuredToken) {
    return res.status(500).json({
      success: false,
      message: "REPORT_SHEET_TOKEN is not configured on server.",
    });
  }

  if (!providedToken || providedToken !== configuredToken) {
    return res.status(401).json({
      success: false,
      message: "Invalid access key.",
    });
  }

  return res.json({ success: true });
});

module.exports = router;
