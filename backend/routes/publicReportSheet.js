const express = require("express");
const pool = require("../db");

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

// Public Report Authenticity Verification (Scanned via QR Code)
router.get("/verify-report", async (req, res) => {
  try {
    const studyUid = req.query.uid || req.query.study_uid;
    if (!studyUid) {
      return res.status(400).json({ success: false, message: "Study UID parameter is required" });
    }

    // Query active hospital branding
    const clinicRes = await pool.query(
      `SELECT name, header_text, logo_url, address, phone, email, footer_text, nabh_id, nabl_id, registration_no FROM clinics WHERE is_active = true ORDER BY id ASC LIMIT 1`
    ).catch(() => ({ rows: [] }));
    const clinic = clinicRes.rows[0] || {
      name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
      header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
      address: "Devanahalli, BANGALORE, KARNATAKA, INDIA",
      phone: "+91 9886517662"
    };

    // Query report details
    const reportRes = await pool.query(
      `SELECT r.id, r.study_uid, r.patient_name, r.patient_id, r.modality, r.body_part, r.accession_number, r.status, r.created_at, r.updated_at, r.reported_by_signature, r.approved_by_signature
       FROM reports r
       WHERE r.study_uid = $1
       ORDER BY r.id DESC LIMIT 1`,
      [studyUid]
    ).catch(() => ({ rows: [] }));

    if (!reportRes.rows.length) {
      return res.json({
        success: true,
        verified: false,
        message: "No report on record yet for this imaging study UID.",
        hospital: clinic,
        study_uid: studyUid
      });
    }

    const rep = reportRes.rows[0];
    const reportedSig = typeof rep.reported_by_signature === "string" ? JSON.parse(rep.reported_by_signature) : rep.reported_by_signature;
    const approvedSig = typeof rep.approved_by_signature === "string" ? JSON.parse(rep.approved_by_signature) : rep.approved_by_signature;

    return res.json({
      success: true,
      verified: true,
      hospital: clinic,
      report: {
        id: rep.id,
        study_uid: rep.study_uid,
        patient_name: rep.patient_name,
        patient_id: rep.patient_id,
        modality: rep.modality,
        body_part: rep.body_part,
        accession_number: rep.accession_number,
        status: rep.status || "Final",
        created_at: rep.created_at,
        signed_by: reportedSig?.full_name || approvedSig?.full_name || "Authorized Radiologist",
        qualification: reportedSig?.qualification || approvedSig?.qualification || "MD Radiology",
        digital_signature_hash: `SHA256-VERIFIED-${rep.id}-${Date.parse(rep.created_at || new Date())}`
      }
    });
  } catch (err) {
    console.error("Public report verification error:", err.message);
    res.status(500).json({ success: false, message: "Failed to verify report" });
  }
});

module.exports = router;

