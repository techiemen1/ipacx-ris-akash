const express = require("express");
const pool = require("../db");
const asyncHandler = require("../middleware/asyncHandler");
const { BadRequestError, NotFoundError } = require("../utils/AppError");

const router = express.Router();

function compact(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== "");
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined && item !== "")
        .map(([key, item]) => [key, compact(item)])
    );
  }
  return value;
}

function toFhirDate(value) {
  if (!value) return undefined;
  return String(value).slice(0, 10);
}

function mapGender(gender) {
  const normalized = String(gender || "").trim().toUpperCase();
  if (normalized.startsWith("M")) return "male";
  if (normalized.startsWith("F")) return "female";
  return "unknown";
}

function patientResource(row) {
  return compact({
    resourceType: "Patient",
    id: String(row.patient_id || row.uhid || row.id),
    identifier: [
      row.patient_id ? { system: "urn:ipacx:patient-id", value: String(row.patient_id) } : null,
      row.uhid ? { system: "urn:ipacx:uhid", value: String(row.uhid) } : null,
      row.mrn ? { system: "urn:ipacx:mrn", value: String(row.mrn) } : null,
    ],
    name: [
      {
        text: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" "),
        given: row.first_name ? [row.first_name] : undefined,
        family: row.last_name || undefined,
      },
    ],
    gender: mapGender(row.gender),
    birthDate: toFhirDate(row.dob),
    telecom: [
      row.mobile ? { system: "phone", value: String(row.mobile), use: "mobile" } : null,
      row.email ? { system: "email", value: String(row.email) } : null,
    ],
    address: row.address ? [{ text: row.address }] : undefined,
  });
}

function diagnosticReportResource(row) {
  return compact({
    resourceType: "DiagnosticReport",
    id: String(row.id),
    status: String(row.status || "unknown").toLowerCase() === "final" ? "final" : "preliminary",
    code: {
      text: row.report_title || row.study_description || row.modality || "Radiology report",
    },
    subject: row.patient_id ? { reference: `Patient/${row.patient_id}`, display: row.patient_name } : undefined,
    imagingStudy: row.study_uid ? [{ reference: `ImagingStudy/${encodeURIComponent(row.study_uid)}` }] : undefined,
    effectiveDateTime: row.created_at,
    issued: row.updated_at || row.created_at,
    performer: row.reported_by ? [{ display: row.reported_by }] : undefined,
    conclusion: typeof row.report_content === "string"
      ? row.report_content
      : row.report_content?.text || row.report_content?.html || undefined,
  });
}

function imagingStudyResource(row) {
  return compact({
    resourceType: "ImagingStudy",
    id: String(row.study_uid),
    identifier: [{ system: "urn:dicom:uid", value: String(row.study_uid) }],
    status: "available",
    subject: row.patient_id ? { reference: `Patient/${row.patient_id}`, display: row.patient_name } : undefined,
    started: row.study_date,
    modality: row.modality ? [{ system: "http://dicom.nema.org/resources/ontology/DCM", code: row.modality }] : undefined,
    description: row.study_description,
    numberOfInstances: row.instances || undefined,
  });
}

function parseHl7Er7(message) {
  const segments = String(message || "")
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"));

  if (!segments.length || segments[0][0] !== "MSH") {
    throw new BadRequestError("HL7 message must start with an MSH segment");
  }

  const getSegment = (name) => segments.find((segment) => segment[0] === name) || [];
  const msh = getSegment("MSH");
  const pid = getSegment("PID");
  const pv1 = getSegment("PV1");
  const obr = getSegment("OBR");

  const patientName = String(pid[5] || "").split("^");
  const obrDate = obr[7] || obr[6] || "";

  return {
    messageType: msh[8] || "",
    sendingApplication: msh[2] || "",
    sendingFacility: msh[3] || "",
    controlId: msh[9] || "",
    patient: {
      patientId: pid[3] || "",
      alternateId: pid[2] || "",
      firstName: patientName[1] || "",
      lastName: patientName[0] || "",
      dob: pid[7] || "",
      gender: pid[8] || "",
      phone: pid[13] || "",
    },
    visit: {
      patientClass: pv1[2] || "",
      location: pv1[3] || "",
      attendingDoctor: pv1[7] || "",
    },
    order: {
      accessionNumber: obr[3] || "",
      placerOrderNumber: obr[2] || "",
      studyDescription: obr[4] || "",
      scheduledAt: obrDate,
    },
    rawSegmentCount: segments.length,
  };
}

router.get("/fhir/metadata", asyncHandler(async (req, res) => {
  res.json({
    resourceType: "CapabilityStatement",
    status: "active",
    date: new Date().toISOString(),
    kind: "instance",
    software: {
      name: "iPACX RIS",
      version: "1.1",
    },
    fhirVersion: "4.0.1",
    format: ["json"],
    rest: [
      {
        mode: "server",
        resource: [
          { type: "Patient", interaction: [{ code: "read" }, { code: "search-type" }] },
          { type: "DiagnosticReport", interaction: [{ code: "read" }, { code: "search-type" }] },
          { type: "ImagingStudy", interaction: [{ code: "read" }, { code: "search-type" }] },
        ],
      },
    ],
  });
}));

router.get("/fhir/Patient", asyncHandler(async (req, res) => {
  const identifier = String(req.query.identifier || "").trim();
  if (!identifier) throw new BadRequestError("identifier query parameter is required");

  const result = await pool.query(
    `
    SELECT *
    FROM patients
    WHERE patient_id::text = $1
       OR uhid::text = $1
       OR mrn::text = $1
       OR id::text = $1
    LIMIT 1
    `,
    [identifier]
  );

  if (!result.rows[0]) throw new NotFoundError("Patient not found");
  res.json(patientResource(result.rows[0]));
}));

router.get("/fhir/Patient/:identifier", asyncHandler(async (req, res) => {
  req.query.identifier = req.params.identifier;
  const result = await pool.query(
    `
    SELECT *
    FROM patients
    WHERE patient_id::text = $1
       OR uhid::text = $1
       OR mrn::text = $1
       OR id::text = $1
    LIMIT 1
    `,
    [req.params.identifier]
  );

  if (!result.rows[0]) throw new NotFoundError("Patient not found");
  res.json(patientResource(result.rows[0]));
}));

router.get("/fhir/DiagnosticReport/:id", asyncHandler(async (req, res) => {
  const result = await pool.query("SELECT * FROM reports WHERE id=$1 LIMIT 1", [req.params.id]);
  if (!result.rows[0]) throw new NotFoundError("DiagnosticReport not found");
  res.json(diagnosticReportResource(result.rows[0]));
}));

router.get("/fhir/ImagingStudy/:studyUID", asyncHandler(async (req, res) => {
  const result = await pool.query("SELECT * FROM studies WHERE study_uid=$1 LIMIT 1", [req.params.studyUID]);
  if (!result.rows[0]) throw new NotFoundError("ImagingStudy not found");
  res.json(imagingStudyResource(result.rows[0]));
}));

router.post("/hl7/parse", asyncHandler(async (req, res) => {
  const parsed = parseHl7Er7(req.body.message);
  res.json({ success: true, parsed });
}));

router.post("/hl7/adt/normalize", asyncHandler(async (req, res) => {
  const parsed = parseHl7Er7(req.body.message);
  res.json({
    success: true,
    patient: {
      patient_id: parsed.patient.patientId,
      first_name: parsed.patient.firstName,
      last_name: parsed.patient.lastName,
      full_name: [parsed.patient.firstName, parsed.patient.lastName].filter(Boolean).join(" "),
      gender: parsed.patient.gender,
      dob: parsed.patient.dob,
      mobile: parsed.patient.phone,
    },
    source: {
      message_type: parsed.messageType,
      control_id: parsed.controlId,
      sending_application: parsed.sendingApplication,
      sending_facility: parsed.sendingFacility,
    },
  });
}));

const { processIncomingHl7Order } = require("../services/hl7MllpService");
const { buildHl7OruR01 } = require("../services/hl7ReportExporter");

// POST /api/interoperability/hl7/orm/ingest - Ingest HL7 ORM order message
router.post("/hl7/orm/ingest", asyncHandler(async (req, res) => {
  const message = req.body.message || req.body.hl7;
  if (!message) throw new BadRequestError("HL7 message string is required in request body");
  const parsed = parseHl7Er7(message);
  await processIncomingHl7Order(parsed);
  res.json({
    success: true,
    message: "HL7 order successfully ingested into RIS and DICOM Modality Worklist (MWL)",
    order: parsed,
  });
}));

// POST /api/interoperability/hl7/oru/export - Generate HL7 ORU^R01 report message
router.post("/hl7/oru/export", asyncHandler(async (req, res) => {
  const { report_id, report } = req.body;
  let reportData = report;

  if (!reportData && report_id) {
    const result = await pool.query("SELECT * FROM reports WHERE id = $1 LIMIT 1", [report_id]);
    reportData = result.rows[0];
  }

  if (!reportData) throw new BadRequestError("Valid report object or report_id is required");

  const exported = buildHl7OruR01(reportData, req.body.options || {});
  res.json({
    success: true,
    message: "HL7 ORU^R01 result message generated successfully",
    hl7: exported,
  });
}));

module.exports = router;
