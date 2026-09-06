const jwt = require("jsonwebtoken");
const env = require("../config/env");

const JWT_SECRET = process.env.JWT_SECRET || "ipacx_secure_sharing_secret_key_2026";
const DEFAULT_EXPIRY_DAYS = 7;

// In-memory revocation blacklist (or store in PostgreSQL/Redis)
const revokedTokens = new Set();

/**
 * Generates a temporary access token for patient DICOM viewer & PDF report download.
 * Default expiration: 7 days.
 */
function generateShareToken(params = {}) {
  const { studyUID, patientID, reportID, customDays } = params;
  const days = Number(customDays) || DEFAULT_EXPIRY_DAYS;

  const payload = {
    studyUID: studyUID || "",
    patientID: patientID || "",
    reportID: reportID || null,
    generatedAt: new Date().toISOString(),
    expiryDays: days,
  };

  const token = jwt.sign(payload, JWT_SECRET, {
    expiresIn: `${days}d`,
  });

  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();

  const downloadPdfUrl = reportID 
    ? `http://localhost:5000/api/reports/${reportID}/pdf`
    : studyUID
      ? `http://localhost:5000/api/reports/by-study/${encodeURIComponent(studyUID)}/pdf`
      : `http://localhost:5000/api/reports/latest/pdf`;

  return {
    token,
    expiresAt,
    expiryDays: days,
    viewerUrl: `http://localhost:3000/lite?token=${token}`,
    downloadPdfUrl,
  };
}

/**
 * Validates a temporary share token.
 */
function verifyShareToken(token) {
  if (!token) return { valid: false, error: "Access token is missing" };
  if (revokedTokens.has(token)) return { valid: false, error: "Access link has been revoked by Administrator" };

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const expiresAt = new Date(decoded.exp * 1000).toISOString();
    return {
      valid: true,
      payload: decoded,
      expiresAt,
    };
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return { valid: false, error: "Link expired. Access was limited to 7 days." };
    }
    return { valid: false, error: "Invalid access token" };
  }
}

/**
 * Admin action to extend an existing token by additional days.
 */
function extendShareToken(existingToken, addDays = 7) {
  const result = verifyShareToken(existingToken);
  let payload = {};

  if (result.valid) {
    payload = result.payload;
  } else {
    // Attempt to decode expired token payload to re-issue
    payload = jwt.decode(existingToken) || {};
  }

  const newDays = (payload.expiryDays || DEFAULT_EXPIRY_DAYS) + Number(addDays);
  return generateShareToken({
    studyUID: payload.studyUID,
    patientID: payload.patientID,
    reportID: payload.reportID,
    customDays: newDays,
  });
}

/**
 * Admin action to revoke a share token.
 */
function revokeShareToken(token) {
  if (token) revokedTokens.add(token);
  return { success: true, message: "Share link successfully revoked" };
}

module.exports = {
  generateShareToken,
  verifyShareToken,
  extendShareToken,
  revokeShareToken,
};
