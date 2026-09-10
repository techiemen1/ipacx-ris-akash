const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const patientService = require("../services/PatientService");

// =============================
// Upload Folder Setup & Multer
// =============================
const uploadDir = path.join(__dirname, "../uploads/patient_docs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `PAT_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  },
});

function normalizeIdValue(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/\//g, "");
}

// =============================
// PATIENT ROUTE CONTROLLERS
// =============================

// GET /next-id
router.get("/next-id", async (req, res) => {
  try {
    const patientId = await patientService.getNextId(req);
    return res.json({ patient_id: patientId || "" });
  } catch (err) {
    console.error("Patient next id error:", err.message);
    return res.status(500).json({ error: "Failed to generate patient id" });
  }
});

// POST /
router.post("/", upload.single("id_proof_path"), async (req, res) => {
  try {
    const patient = await patientService.createPatient(req, req.file);
    return res.status(201).json({
      success: true,
      message: "Patient Registered Successfully",
      patient,
    });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: error.message,
        conflict_field: error.conflict_field,
        patient: error.patient,
      });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    console.error("Patient Create Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error while creating patient",
      error: error.message,
    });
  }
});

// POST /resequence-ids
router.post("/resequence-ids", async (req, res) => {
  try {
    const updated = await patientService.resequenceIds(req);
    return res.json({
      success: true,
      message: updated ? "Patient IDs resequenced successfully" : "No patients found to resequence",
      updated,
    });
  } catch (error) {
    console.error("Resequence Patient IDs Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to resequence patient IDs",
      error: error.message,
    });
  }
});

// GET /
router.get("/", async (req, res) => {
  try {
    const patients = await patientService.getAllPatients(req);
    return res.json({
      success: true,
      count: patients.length,
      patients,
    });
  } catch (error) {
    console.error("Fetch Patients Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch patients",
      error: error.message,
    });
  }
});

// GET /lookup
router.get("/lookup", async (req, res) => {
  try {
    const matches = await patientService.lookupPatients(req);
    return res.json({
      success: true,
      matches,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error("Patient lookup error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to lookup patients",
      error: error.message,
    });
  }
});

// GET /details/:identifier
router.get("/details/:identifier", async (req, res) => {
  try {
    const patient = await patientService.getPatientDetails(req, req.params.identifier);
    return res.json({
      success: true,
      patient,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("Get Patient Details Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// GET /print/:identifier
router.get("/print/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    let patient;
    try {
      patient = await patientService.getPatientPrintDetails(req, identifier);
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ success: false, message: err.message });
      }
      throw err;
    }

    const patientId =
      normalizeIdValue(patient.uhid) ||
      normalizeIdValue(patient.patient_id) ||
      normalizeIdValue(patient.mrn) ||
      normalizeIdValue(identifier);
    const fullName =
      `${patient.first_name || ""} ${patient.last_name || ""}`.trim() ||
      patient.full_name ||
      patient.patient_name ||
      "N/A";
    const dob = patient.dob ? new Date(patient.dob).toLocaleDateString() : "N/A";
    const createdAt = patient.created_at ? new Date(patient.created_at).toLocaleString() : new Date().toLocaleString();
    const printedAt = new Date().toLocaleString();
    const idType = patient.id_type || "-";
    const idNumber = patient.id_number || "-";
    const addressText = patient.address || patient.address_line1 || "-";
    const secondaryContact =
      [patient.secondary_contact_name, patient.secondary_contact_phone].filter(Boolean).join(" / ") || "-";
    const occupationText = patient.occupation || "-";
    const patientType = patient.patient_type || "-";
    const studyType = patient.study_type || patient.study || patient.indication_for_scan || "-";
    const billingType = patient.billing_category || patient.billing_type || "-";
    const hospitalName = process.env.HOSPITAL_NAME || "iPacx RIS";
    const hospitalAddress = process.env.HOSPITAL_ADDRESS || "Radiology & Diagnostic Center";
    const hospitalContact = process.env.HOSPITAL_CONTACT || "Phone: +91-XXXXXXXXXX";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=patient_registration_${patientId}.pdf`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 80;
    const leftX = 40;
    let y = 44;

    const drawKVRow = (label, value, x, rowY, labelWidth = 125) => {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text(label, x, rowY, { width: labelWidth });
      doc.font("Helvetica").fontSize(10).fillColor("#111827").text(value || "N/A", x + labelWidth, rowY, {
        width: 220,
      });
    };

    const sectionTitle = (title, topY) => {
      doc.roundedRect(leftX, topY, contentWidth, 22, 4).fillAndStroke("#eef2ff", "#c7d2fe");
      doc.font("Helvetica-Bold").fontSize(11).fillColor("#1e3a8a").text(title, leftX + 10, topY + 6);
    };

    doc.roundedRect(leftX, y, contentWidth, 86, 8).fillAndStroke("#f8fafc", "#e5e7eb");
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0f172a").text(hospitalName, leftX + 14, y + 12);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text(hospitalAddress, leftX + 14, y + 40);
    doc.font("Helvetica").fontSize(10).fillColor("#475569").text(hospitalContact, leftX + 14, y + 56);

    const rightHeaderX = leftX + 230;
    const rightHeaderWidth = 235;
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("PATIENT REGISTRATION FORM", rightHeaderX, y + 20, {
      width: rightHeaderWidth,
      align: "right",
    });
    doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(`Printed: ${printedAt}`, rightHeaderX, y + 46, {
      width: rightHeaderWidth,
      align: "right",
    });
    doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(`Registered: ${createdAt}`, rightHeaderX, y + 60, {
      width: rightHeaderWidth,
      align: "right",
    });

    y += 102;

    sectionTitle("Patient Identity", y);
    y += 30;
    drawKVRow("Patient ID", patientId, leftX, y);
    drawKVRow("MRN", patient.mrn || "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Full Name", fullName, leftX, y);
    drawKVRow("Gender", patient.gender || "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Date of Birth", dob, leftX, y);
    drawKVRow("Age", patient.age ? String(patient.age) : "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Mobile", patient.mobile || patient.phone || "-", leftX, y);
    drawKVRow("ABHA", patient.abha_number || "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Govt ID Type", idType, leftX, y);
    drawKVRow("ID Number", idNumber, leftX + 300, y, 80);
    y += 16;
    drawKVRow("Blood Group", patient.blood_group || "-", leftX, y);
    drawKVRow("Pincode", patient.pincode || "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Email", patient.email || "-", leftX, y);
    drawKVRow("Occupation", occupationText, leftX + 300, y, 80);
    y += 16;
    drawKVRow("Secondary Contact", secondaryContact, leftX, y);
    y += 16;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#374151").text("Address", leftX, y, { width: 125 });
    doc.font("Helvetica").fontSize(10).fillColor("#111827").text(addressText, leftX + 125, y, {
      width: 430,
    });

    y += 34;

    sectionTitle("Visit & Clinical Details", y);
    y += 30;
    drawKVRow("Visit Type", patient.visit_type || "-", leftX, y);
    drawKVRow("Patient Type", patientType, leftX + 300, y, 80);
    y += 16;
    drawKVRow("Referring Doctor", patient.referring_doctor || patient.attending_physician || "-", leftX, y);
    drawKVRow("Modality", patient.modality || "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Study Type", studyType, leftX, y);
    drawKVRow("Department", patient.department || "-", leftX + 300, y, 80);
    y += 26;

    sectionTitle("Billing & Consent", y);
    y += 30;
    drawKVRow("Billing Category", billingType, leftX, y);
    drawKVRow("Insurance ID", patient.insurance_id || "-", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Data Privacy", patient.data_privacy_accepted ? "Accepted" : "Not Accepted", leftX, y);
    drawKVRow("Telemedicine", patient.consent_telemedicine ? "Accepted" : "Not Accepted", leftX + 300, y, 80);
    y += 16;
    drawKVRow("Image Sharing", patient.consent_image_sharing ? "Accepted" : "Not Accepted", leftX, y);

    y += 44;
    doc.moveTo(leftX, y).lineTo(leftX + 220, y).strokeColor("#9ca3af").stroke();
    doc.moveTo(leftX + 335, y).lineTo(leftX + contentWidth, y).strokeColor("#9ca3af").stroke();
    doc.font("Helvetica").fontSize(9).fillColor("#4b5563").text("Patient / Guardian Signature", leftX, y + 6, { width: 220, align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#4b5563").text("Authorized Staff Signature", leftX + 335, y + 6, { width: 225, align: "center" });

    y += 36;
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#64748b").text(
      "This is a computer-generated patient registration form. No physical seal is required unless mandated by local policy.",
      leftX,
      y,
      { width: contentWidth, align: "center" }
    );

    doc.end();
  } catch (error) {
    console.error("Print Patient Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate patient print",
      error: error.message,
    });
  }
});

// PUT /:identifier
router.put("/:identifier", upload.single("id_proof_path"), async (req, res) => {
  try {
    const updatedPatient = await patientService.updatePatient(req, req.params.identifier);
    return res.json({
      success: true,
      message: "Patient updated successfully",
      patient: {
        ...updatedPatient,
        patient_id: normalizeIdValue(updatedPatient.patient_id),
        uhid: normalizeIdValue(updatedPatient.uhid),
      },
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("Patient Update Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update patient",
      error: error.message,
    });
  }
});

// GET /:uhid
router.get("/:uhid", async (req, res) => {
  try {
    const patient = await patientService.getPatientDetails(req, req.params.uhid);
    return res.json({
      success: true,
      patient,
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("Get Patient Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// DELETE /:uhid
router.delete("/:uhid", async (req, res) => {
  try {
    await patientService.deletePatient(req, req.params.uhid);
    return res.json({
      success: true,
      message: "Patient deleted successfully",
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error("Delete Patient Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to delete patient",
    });
  }
});

module.exports = router;
