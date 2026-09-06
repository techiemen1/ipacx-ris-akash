const express = require("express");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

const controls = [
  { id: "HIPAA-ACCESS-CONTROL", status: "implemented", evidence: "JWT auth, role checks, audit logs" },
  { id: "HIPAA-AUDIT-CONTROLS", status: "implemented", evidence: "Audit logger and archive scheduler" },
  { id: "GDPR-ACCESS", status: "implemented", evidence: "GET /api/privacy/patient/:identifier/export" },
  { id: "GDPR-ERASURE", status: "implemented", evidence: "POST /api/privacy/patient/:identifier/anonymize" },
  { id: "GDPR-REQUEST-TRACKING", status: "implemented", evidence: "privacy_requests workflow APIs" },
  { id: "ISO27001-INCIDENT-RESPONSE", status: "documented", evidence: "docs/DISASTER_RECOVERY_PLAN.md" },
  { id: "ISO27001-BACKUP-RESTORE", status: "implemented", evidence: "scripts/backup_postgres.sh and scripts/restore_postgres.sh" },
  { id: "INTEROP-FHIR", status: "implemented", evidence: "FHIR Patient, DiagnosticReport, ImagingStudy endpoints" },
  { id: "INTEROP-HL7", status: "implemented", evidence: "HL7 parse and ADT normalize endpoints" },
  { id: "DEVOPS-IAC", status: "implemented", evidence: "Terraform and Helm deployment scaffolds" },
];

router.get("/controls", asyncHandler(async (req, res) => {
  res.json({ success: true, controls });
}));

router.get("/readiness", asyncHandler(async (req, res) => {
  const total = controls.length;
  const implemented = controls.filter((control) => ["implemented", "documented"].includes(control.status)).length;
  res.json({
    success: true,
    implemented,
    total,
    readinessPercent: Math.round((implemented / total) * 100),
  });
}));

module.exports = router;
