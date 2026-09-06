const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { BadRequestError, NotFoundError } = require("../utils/AppError");
const { logAction } = require("../utils/auditLogger");

const router = express.Router();

async function ensurePrivacyTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privacy_requests (
      id BIGSERIAL PRIMARY KEY,
      request_type TEXT NOT NULL CHECK (request_type IN ('ACCESS', 'ERASURE', 'RECTIFICATION')),
      patient_identifier TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPROVED', 'REJECTED', 'COMPLETED')),
      reason TEXT,
      requested_by TEXT,
      reviewed_by TEXT,
      completed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

ensurePrivacyTables().catch((err) => {
  console.error("Privacy table initialization failed:", err.message);
});

function normalizeIdentifier(value) {
  return String(value || "").trim();
}

async function findPatient(identifier) {
  const value = normalizeIdentifier(identifier);
  if (!value) throw new BadRequestError("Patient identifier is required");

  const result = await pool.query(
    `
    SELECT *
    FROM patients
    WHERE uhid::text = $1
       OR patient_id::text = $1
       OR mrn::text = $1
       OR id::text = $1
    LIMIT 1
    `,
    [value]
  );

  return result.rows[0] || null;
}

async function safeRows(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    if (err.code === "42P01" || err.code === "42703") return [];
    throw err;
  }
}

function patientIdentifiers(patient) {
  return [patient.uhid, patient.patient_id, patient.mrn, patient.id]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(String);
}

router.post("/requests", asyncHandler(async (req, res) => {
  const requestType = String(req.body.request_type || "").trim().toUpperCase();
  const patientIdentifier = normalizeIdentifier(req.body.patient_identifier);
  const reason = String(req.body.reason || "").trim() || null;

  if (!["ACCESS", "ERASURE", "RECTIFICATION"].includes(requestType)) {
    throw new BadRequestError("request_type must be ACCESS, ERASURE, or RECTIFICATION");
  }
  if (!patientIdentifier) throw new BadRequestError("patient_identifier is required");

  const result = await pool.query(
    `
    INSERT INTO privacy_requests (request_type, patient_identifier, reason, requested_by)
    VALUES ($1, $2, $3, $4)
    RETURNING *
    `,
    [requestType, patientIdentifier, reason, req.user?.username || null]
  );

  await logAction(req, {
    event: "PRIVACY_REQUEST_CREATED",
    details: { request_id: result.rows[0].id, request_type: requestType, patient_identifier: patientIdentifier },
  });

  res.status(201).json({ success: true, request: result.rows[0] });
}));

router.get("/requests", asyncHandler(async (req, res) => {
  const status = String(req.query.status || "").trim().toUpperCase();
  const params = [];
  let where = "";

  if (status) {
    params.push(status);
    where = "WHERE status = $1";
  }

  const result = await pool.query(
    `
    SELECT *
    FROM privacy_requests
    ${where}
    ORDER BY created_at DESC
    LIMIT 200
    `,
    params
  );

  res.json({ success: true, requests: result.rows });
}));

router.get("/patient/:identifier/export", asyncHandler(async (req, res) => {
  const patient = await findPatient(req.params.identifier);
  if (!patient) throw new NotFoundError("Patient not found");

  const ids = patientIdentifiers(patient);
  const reports = await safeRows("SELECT * FROM reports WHERE patient_id = ANY($1::text[]) OR study_uid IN (SELECT study_uid FROM studies WHERE patient_id = ANY($1::text[])) ORDER BY updated_at DESC", [ids]);
  const invoices = await safeRows("SELECT * FROM invoices WHERE patient_id = ANY($1::text[]) ORDER BY created_at DESC", [ids]);
  const appointments = await safeRows("SELECT * FROM appointments WHERE patient_id::text = ANY($1::text[]) ORDER BY created_at DESC", [ids]);
  const studies = await safeRows("SELECT * FROM studies WHERE patient_id = ANY($1::text[]) ORDER BY created_at DESC", [ids]);

  await logAction(req, {
    event: "PATIENT_PRIVACY_EXPORT",
    details: { patient_identifier: req.params.identifier, report_count: reports.length },
  });

  res.json({
    success: true,
    exported_at: new Date().toISOString(),
    patient,
    related_records: {
      reports,
      invoices,
      appointments,
      studies,
    },
  });
}));

router.post("/patient/:identifier/anonymize", asyncHandler(async (req, res) => {
  const patient = await findPatient(req.params.identifier);
  if (!patient) throw new NotFoundError("Patient not found");

  const reason = String(req.body.reason || "").trim();
  if (!reason) throw new BadRequestError("reason is required for anonymization");

  const anonymizedName = `Anonymized Patient ${patient.id}`;
  const ids = patientIdentifiers(patient);

  const result = await pool.query(
    `
    UPDATE patients
    SET full_name = $1,
        first_name = 'Anonymized',
        last_name = NULL,
        mobile = NULL,
        email = NULL,
        address = NULL,
        id_number = NULL,
        updated_at = NOW()
    WHERE id = $2
    RETURNING id, patient_id, uhid, mrn, full_name, updated_at
    `,
    [anonymizedName, patient.id]
  );

  await safeRows("UPDATE reports SET patient_name = $1 WHERE patient_id = ANY($2::text[])", [anonymizedName, ids]);
  await safeRows("UPDATE studies SET patient_name = $1 WHERE patient_id = ANY($2::text[])", [anonymizedName, ids]);

  await pool.query(
    `
    INSERT INTO privacy_requests (request_type, patient_identifier, status, reason, requested_by, reviewed_by, completed_at)
    VALUES ('ERASURE', $1, 'COMPLETED', $2, $3, $3, NOW())
    `,
    [req.params.identifier, reason, req.user?.username || null]
  );

  await logAction(req, {
    event: "PATIENT_ANONYMIZED",
    details: { patient_identifier: req.params.identifier, reason },
  });

  res.json({ success: true, patient: result.rows[0] });
}));

module.exports = router;
