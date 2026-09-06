const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { BadRequestError, NotFoundError } = require("../utils/AppError");
const {
  generateShareToken,
  verifyShareToken,
  extendShareToken,
  revokeShareToken,
} = require("../services/shareTokenService");
const { dispatchNotifications } = require("../services/notificationDispatchService");

const router = express.Router();

// POST /api/share/generate - Generate 7-day share token & link
router.post("/generate", asyncHandler(async (req, res) => {
  const { studyUID, patientID, reportID, customDays } = req.body;
  if (!studyUID && !patientID && !reportID) {
    throw new BadRequestError("studyUID, patientID, or reportID is required");
  }

  const shareInfo = generateShareToken({
    studyUID,
    patientID,
    reportID,
    customDays: customDays || 7,
  });

  res.json({ success: true, ...shareInfo });
}));

// GET /api/public/share/verify - Validate token & expiration date
router.get("/verify", asyncHandler(async (req, res) => {
  const token = req.query.token || req.headers["x-share-token"];
  if (!token) throw new BadRequestError("Token query parameter or x-share-token header required");

  const result = verifyShareToken(token);
  if (!result.valid) {
    return res.status(403).json({ success: false, error: result.error });
  }

  res.json({ success: true, payload: result.payload, expiresAt: result.expiresAt });
}));

// POST /api/share/extend - Admin endpoint to extend link expiration (+7, +14, +30 days)
router.post("/extend", asyncHandler(async (req, res) => {
  const { token, addDays } = req.body;
  if (!token) throw new BadRequestError("token is required");

  const extendedShare = extendShareToken(token, addDays || 7);
  res.json({
    success: true,
    message: `Link access successfully extended by +${addDays || 7} days`,
    ...extendedShare,
  });
}));

// POST /api/share/revoke - Admin endpoint to revoke link access
router.post("/revoke", asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new BadRequestError("token is required");

  const result = revokeShareToken(token);
  res.json(result);
}));

// POST /api/share/dispatch - Trigger SMS, Email, and WhatsApp notification dispatch
router.post("/dispatch", asyncHandler(async (req, res) => {
  const { reportID, studyUID, channels } = req.body;
  let reportData = null;

  if (reportID) {
    const reportRes = await pool.query("SELECT * FROM reports WHERE id = $1 LIMIT 1", [reportID]);
    reportData = reportRes.rows[0];
  } else if (studyUID) {
    const reportRes = await pool.query("SELECT * FROM reports WHERE study_uid = $1 LIMIT 1", [studyUID]);
    reportData = reportRes.rows[0];
  }

  if (!reportData) {
    reportData = {
      patient_name: req.body.patientName || "Patient",
      accession_number: req.body.accessionNumber || "N/A",
      modality: req.body.modality || "Exam",
      study_uid: studyUID || "",
    };
  }

  const shareInfo = generateShareToken({
    studyUID: reportData.study_uid || studyUID,
    patientID: reportData.patient_id,
    reportID: reportData.id,
    customDays: 7,
  });

  const dispatchResult = await dispatchNotifications(
    reportData,
    shareInfo,
    channels || ["email", "sms", "whatsapp"]
  );

  res.json({
    success: true,
    message: "Diagnostic report notification dispatched to SMS, Email, and WhatsApp",
    shareInfo,
    dispatchResult,
  });
}));

module.exports = router;
