// routes/patients.js

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pool = require("../db");

// =============================
// Upload Folder Setup
// =============================
const uploadDir = path.join(__dirname, "../uploads/patient_docs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// =============================
// Multer Storage
// =============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `PAT_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  },
});

// =============================
// Generate UHID
// =============================
async function generateCustomMRN(clinicId = null) {
  try {
    let prefix = "MRN";
    let format = "{PREFIX}-{YY}{MM}-{SEQ}";
    let nextSeq = 1001;

    if (clinicId) {
      const cRes = await pool.query(
        "SELECT mrn_prefix, mrn_format, mrn_next_seq FROM clinics WHERE id = $1 LIMIT 1",
        [clinicId]
      );
      if (cRes.rows[0]) {
        if (cRes.rows[0].mrn_prefix) prefix = cRes.rows[0].mrn_prefix;
        if (cRes.rows[0].mrn_format) format = cRes.rows[0].mrn_format;
        if (cRes.rows[0].mrn_next_seq) nextSeq = cRes.rows[0].mrn_next_seq;

        // increment sequence in DB
        await pool.query("UPDATE clinics SET mrn_next_seq = mrn_next_seq + 1 WHERE id = $1", [clinicId]);
      }
    } else {
      const pRes = await pool.query("SELECT MAX(id) as max_id FROM patients");
      const maxId = pRes.rows?.[0]?.max_id || 0;
      nextSeq = Number(maxId) + 1001;
    }

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const seq = String(nextSeq).padStart(4, "0");

    let formatted = format
      .replace("{PREFIX}", prefix)
      .replace("{YYYY}", yyyy)
      .replace("{YY}", yy)
      .replace("{MM}", mm)
      .replace("{SEQ}", seq);

    return formatted;
  } catch (err) {
    console.error("MRN generation error:", err.message);
    return `MRN-${String(Math.floor(1000 + Math.random() * 9000))}`;
  }
}

function generateMRN() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MRN-${yy}${mm}-${rand}`;
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function normalizeIdValue(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/\//g, "");
}

async function generateNextPatientId(clinicId = null) {
  return await generateCustomMRN(clinicId);
}

router.get("/next-id", async (req, res) => {
  try {
    const clinicId = req.query.clinic_id || req.clinic_id || null;
    const patientId = await generateCustomMRN(clinicId);
    return res.json({ patient_id: patientId || "" });
  } catch (err) {
    console.error("Patient next id error:", err.message);
    return res.status(500).json({ error: "Failed to generate patient id" });
  }
});


async function getPatientColumns() {
  const result = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients'
    `
  );
  return new Set(result.rows.map((r) => r.column_name));
}

async function findPatientByIdentifier(identifier) {
  const patientColumns = await getPatientColumns();
  const searchableColumns = ["uhid", "patient_id", "mrn", "id"].filter((col) =>
    patientColumns.has(col)
  );

  if (searchableColumns.length === 0) {
    return null;
  }

  const where = searchableColumns.map((col) => `${col}::text = $1`).join(" OR ");
  const result = await pool.query(`SELECT * FROM patients WHERE ${where} LIMIT 1`, [String(identifier)]);
  return result.rows[0] || null;
}

function saveBase64ToDisk(dataUrl, prefix = "FILE") {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    return dataUrl || null;
  }
  try {
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return dataUrl;
    const mime = matches[1];
    const base64Data = matches[2];
    let ext = "jpg";
    if (mime.includes("png")) ext = "png";
    else if (mime.includes("pdf")) ext = "pdf";
    else if (mime.includes("webp")) ext = "webp";

    const filename = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
    return `/uploads/patient_docs/${filename}`;
  } catch (err) {
    console.error("Failed to save Base64 file:", err.message);
    return null;
  }
}

// =============================
// CREATE PATIENT
// =============================
router.post("/", upload.single("id_proof_path"), async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      gender,
      dob,
      age,
      mobile,
      email,
      address,
      idType,
      idNumber,
      biometric_flag,
      data_privacy_accepted,
      consent_image_sharing,
      consent_telemedicine,
      digital_signature,
      photo_url,
      referring_doctor,
      attending_physician,
      visit_type,
      modality,
      modalities,
      study_type,
      study,
      address_line1,
      consent_signed,
      signature_file,
    } = req.body;

    // Basic validation
    if (!first_name || !gender) {
      return res.status(400).json({
        success: false,
        message: "First Name and Gender are required",
      });
    }

    const patientId = req.body.patient_id || req.body.uhid || await generateNextPatientId();
    const uhid = patientId;
    const mrn = generateMRN();
    const fullName = [first_name, last_name].filter(Boolean).join(" ").trim();
    const idProofPath = req.file ? `/uploads/patient_docs/${req.file.filename}` : null;
    const rawOccupation = String(req.body.occupation || "").trim();
    const rawIdNumber = String(idNumber || req.body.id_number || "").trim();
    const normalizedOccupation =
      rawOccupation && rawIdNumber && rawOccupation === rawIdNumber && /^\d+$/.test(rawOccupation)
        ? null
        : rawOccupation || null;

    // Convert and save base64 files
    const photoUrlSaved = saveBase64ToDisk(req.body.photo_url, "PHOTO") || idProofPath;
    const signatureSaved = saveBase64ToDisk(digital_signature || signature_file, "SIGN");
    const paperConsentSaved = saveBase64ToDisk(req.body.paper_consent_url, "CONSENT");
    const patientColumns = await getPatientColumns();


    const record = {
      uhid,
      patient_id: patientId,
      mrn,
      full_name: fullName || first_name,
      first_name,
      last_name: last_name || null,
      gender,
      dob: dob || null,
      age: age || null,
      mobile: mobile || null,
      email: email || null,
      address: address || address_line1 || null,
      address_line1: address || address_line1 || null,
      city: req.body.city || null,
      district: req.body.district || null,
      state: req.body.state || null,
      pincode: req.body.pincode || null,
      id_type: idType || null,
      id_number: idNumber || null,
      biometric_flag: biometric_flag === "true" || biometric_flag === true,
      id_proof_path: idProofPath,
      id_proof: idProofPath,
      patient_type: req.body.patient_type || null,
      clinical_history: req.body.medical_history || req.body.clinical_history || null,
      provisional_diagnosis:
        req.body.indication_for_scan || req.body.provisional_diagnosis || study_type || study || null,
      data_privacy_accepted: data_privacy_accepted === "true" || data_privacy_accepted === true,
      consent_signed:
        consent_signed === "true" ||
        consent_signed === true ||
        data_privacy_accepted === "true" ||
        data_privacy_accepted === true,
      consent_image_sharing: consent_image_sharing === "true" || consent_image_sharing === true,
      consent_telemedicine: consent_telemedicine === "true" || consent_telemedicine === true,
      digital_signature: signatureSaved,
      signature_file: signatureSaved,
      paper_consent_url: paperConsentSaved,
      photo_url: photoUrlSaved,
      referring_doctor: referring_doctor || attending_physician || null,


      attending_physician: attending_physician || null,
      visit_type: visit_type || null,
      modality: modality || modalities || null,
      study_type: study_type || study || null,
      study: study_type || study || null,
      contrast:
        req.body.contrast_safety_flag === "true" ||
        req.body.contrast_safety_flag === true ||
        req.body.contrast === "true" ||
        req.body.contrast === true,
      urgency: req.body.urgency || null,
      billing_type: req.body.billing_category || req.body.billing_type || null,
      insurance_id: req.body.insurance_id || null,
      abha_number: req.body.abha_number || null,
      abha_address: req.body.abha_address || null,
      voter_id: req.body.voter_id || null,
      registration_channel: req.body.registration_channel || null,
      title: req.body.title || null,
      relationship_type: req.body.relationship_type || null,
      relationship_name: req.body.relationship_name || null,
      marital_status: req.body.marital_status || null,
      occupation: normalizedOccupation,
      nationality: req.body.nationality || null,
      language_preference: req.body.language_preference || null,
      emergency_contact_name: req.body.emergency_contact_name || null,
      emergency_contact_phone: req.body.emergency_contact_phone || null,
      emergency_contact_relation: req.body.emergency_contact_relation || null,
      secondary_contact_name: req.body.secondary_contact_name || req.body.secondaryContactName || null,
      secondary_contact_phone: req.body.secondary_contact_phone || req.body.secondaryContactPhone || null,
      blood_group: req.body.blood_group || null,
      height_cm: req.body.height_cm || null,
      weight_kg: req.body.weight_kg || null,
      allergies: req.body.allergies || null,
      current_medications: req.body.current_medications || null,
      medical_history: req.body.medical_history || null,
      is_pregnant:
        req.body.is_pregnant === "true" ||
        req.body.is_pregnant === true ||
        req.body.isPregnant === "true" ||
        req.body.isPregnant === true,
      menstrual_status: req.body.menstrual_status || null,
      lmp_date: req.body.lmp_date || null,
      edd: req.body.edd || null,
      gestational_age: req.body.gestational_age || null,
      creatinine_level: req.body.creatinine_level || null,
      contrast_safety_flag:
        req.body.contrast_safety_flag === "true" ||
        req.body.contrast_safety_flag === true,
      modalities: req.body.modalities || null,
      department: req.body.department || null,
      ward_room_bed: req.body.ward_room_bed || null,
      billing_category: req.body.billing_category || null,
      insurance_provider: req.body.insurance_provider || null,
      consent_research_ai:
        req.body.consent_research_ai === "true" ||
        req.body.consent_research_ai === true,
      indication_for_scan: req.body.indication_for_scan || null,
    };

    const insertCols = Object.keys(record).filter((col) => patientColumns.has(col));
    const insertValues = insertCols.map((col) => record[col]);
    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");

    console.log(`[PATIENT_CREATE] Attempting insert: ${insertCols.join(", ")}`);
    console.log(`[PATIENT_CREATE] UHID: ${uhid}, Name: ${fullName}`);

    if (insertCols.length === 0) {
      console.error("[PATIENT_CREATE] No compatible columns found!");
      return res.status(500).json({
        success: false,
        message: "Patients table has no compatible columns",
      });
    }

    const result = await pool.query(
      `INSERT INTO patients (${insertCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      insertValues
    );

    const createdPatient = result.rows[0];

    // Auto-create invoice for billing receipt
    try {
      const gross = Number(req.body.bill_amount) || Number(req.body.total_amount) || 1500;
      const discount = Number(req.body.discount_amount) || 0;
      const grandTotal = Math.max(0, gross - discount);
      const paymentCategory = req.body.billing_category || req.body.payment_method || "Self-Pay";
      const paymentStatus = req.body.payment_status || (["Self-Pay", "UPI_SCAN", "CARD_POS", "CASH"].includes(paymentCategory) ? "PAID" : "PENDING");
      const invoiceNumber = `INV-${Date.now()}`;

      await pool.query(
        `INSERT INTO invoices (invoice_number, patient_id, total_amount, discount_amount, grand_total, payment_status, payment_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [invoiceNumber, uhid, gross, discount, grandTotal, paymentStatus, paymentCategory]
      );
    } catch (invErr) {
      console.warn("Auto-invoice creation notice:", invErr.message);
    }


    res.status(201).json({
      success: true,
      message: "Patient Registered Successfully",
      patient: createdPatient,
    });

  } catch (error) {
    if (error?.code === "23505" && error?.constraint === "uq_patients_idtype_idnumber") {
      const idType = String(req.body?.idType || "").trim();
      const idNumber = String(req.body?.idNumber || req.body?.id_number || "").trim();
      let existingPatient = null;
      try {
        if (idType && idNumber) {
          const existing = await pool.query(
            `
            SELECT *
            FROM patients
            WHERE id_type = $1 AND id_number = $2
            LIMIT 1
            `,
            [idType, idNumber]
          );
          existingPatient = existing.rows[0] || null;
        }
      } catch (lookupErr) {
        console.error("Duplicate patient lookup failed:", lookupErr.message);
      }

      return res.status(409).json({
        success: false,
        message: "Patient already exists with this ID type and ID number",
        conflict_field: "id_type+id_number",
        patient: existingPatient,
      });
    }

    console.error("Patient Create Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error while creating patient",
      error: error.message,
    });
  }
});

// =============================
// RESEQUENCE EXISTING PATIENT IDS
// =============================
router.post("/resequence-ids", async (req, res) => {
  try {
    const patientColumns = await getPatientColumns();
    const hasPatientId = patientColumns.has("patient_id");
    const hasUhid = patientColumns.has("uhid");
    const hasCreatedAt = patientColumns.has("created_at");
    const hasId = patientColumns.has("id");

    if (!hasPatientId && !hasUhid) {
      return res.status(400).json({
        success: false,
        message: "Neither patient_id nor uhid column exists in patients table",
      });
    }

    const keyColumn = hasId ? "id" : hasUhid ? "uhid" : "patient_id";
    const orderExpr = hasCreatedAt
      ? "created_at ASC, id ASC"
      : hasId
      ? "id ASC"
      : "patient_id ASC NULLS LAST";

    const rows = await pool.query(
      `
      SELECT ${keyColumn} AS row_key${hasCreatedAt ? ", created_at" : ""}
      FROM patients
      ORDER BY ${orderExpr}
      `
    );

    if (rows.rowCount === 0) {
      return res.json({
        success: true,
        message: "No patients found to resequence",
        updated: 0,
      });
    }

    const counters = new Map();
    let updated = 0;

    for (const row of rows.rows) {
      const d = hasCreatedAt && row.created_at ? new Date(row.created_at) : new Date();
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const key = `${year}/${String(month).padStart(2, "0")}`;
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);

      const newId = buildPatientId(year, month, next);

      if (hasPatientId && hasUhid) {
        await pool.query(`UPDATE patients SET patient_id = $1, uhid = $1 WHERE ${keyColumn}::text = $2`, [
          newId,
          String(row.row_key),
        ]);
      } else if (hasPatientId) {
        await pool.query(`UPDATE patients SET patient_id = $1 WHERE ${keyColumn}::text = $2`, [
          newId,
          String(row.row_key),
        ]);
      } else {
        await pool.query(`UPDATE patients SET uhid = $1 WHERE ${keyColumn}::text = $2`, [
          newId,
          String(row.row_key),
        ]);
      }
      updated += 1;
    }

    return res.json({
      success: true,
      message: "Patient IDs resequenced successfully",
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

// =============================
// GET ALL PATIENTS
// =============================
router.get("/", async (req, res) => {
  try {
    const patientColumns = await getPatientColumns();
    const orderBy = patientColumns.has("created_at")
      ? "created_at DESC"
      : patientColumns.has("id")
      ? "id DESC"
      : patientColumns.has("patient_id")
      ? "patient_id DESC"
      : patientColumns.has("uhid")
      ? "uhid DESC"
      : "first_name ASC";

    const result = await pool.query(`
      SELECT 
        p.*,
        COALESCE(
          (SELECT payment_status FROM invoices WHERE patient_id = p.uhid OR patient_id = p.patient_id ORDER BY created_at DESC LIMIT 1),
          'PAID'
        ) as billing_status,
        (SELECT status FROM reports WHERE patient_id = p.uhid OR patient_id = p.patient_id ORDER BY updated_at DESC LIMIT 1) as report_status
      FROM patients p 
      ORDER BY p.${orderBy.replace('created_at', 'created_at').replace('id', 'id')}
    `);


    res.json({
      success: true,
      count: result.rowCount,
      patients: result.rows.map((row) => ({
        ...row,
        patient_id: normalizeIdValue(row.patient_id),
        uhid: normalizeIdValue(row.uhid),
      })),
    });
  } catch (error) {
    console.error("Fetch Patients Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch patients",
      error: error.message,
    });
  }
});

// =============================
// LOOKUP PATIENTS (DB-backed suggestions)
// =============================
router.get("/lookup", async (req, res) => {
  try {
    const field = String(req.query.field || "").trim();
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);

    const allowed = new Set(["mobile", "abha_number", "id_number"]);
    if (!allowed.has(field)) {
      return res.status(400).json({ success: false, message: "Invalid lookup field" });
    }
    if (!q || q.length < 2) {
      return res.json({ success: true, matches: [] });
    }

    const patientColumns = await getPatientColumns();
    const orderBy = patientColumns.has("created_at")
      ? "created_at DESC NULLS LAST, id DESC"
      : patientColumns.has("id")
      ? "id DESC"
      : "uhid DESC NULLS LAST";

    let queryText = "";
    let queryParams = [];

    if (field === "mobile") {
      const digits = q.replace(/\D/g, "");
      queryText = `
        SELECT
          id,
          uhid,
          patient_id,
          mrn,
          full_name,
          first_name,
          last_name,
          gender,
          dob,
          mobile,
          abha_number,
          id_number
        FROM patients
        WHERE (
          regexp_replace(COALESCE(mobile::text, ''), '\\D', '', 'g') LIKE $1
          OR regexp_replace(COALESCE(phone::text, ''), '\\D', '', 'g') LIKE $1
        )
        ORDER BY ${orderBy}
        LIMIT $2
      `;
      queryParams = [`%${digits}%`, limit];
    } else if (field === "abha_number") {
      queryText = `
        SELECT
          id,
          uhid,
          patient_id,
          mrn,
          full_name,
          first_name,
          last_name,
          gender,
          dob,
          mobile,
          abha_number,
          id_number
        FROM patients
        WHERE COALESCE(abha_number::text, '') ILIKE $1
        ORDER BY ${orderBy}
        LIMIT $2
      `;
      queryParams = [`%${q}%`, limit];
    } else {
      queryText = `
        SELECT
          id,
          uhid,
          patient_id,
          mrn,
          full_name,
          first_name,
          last_name,
          gender,
          dob,
          mobile,
          abha_number,
          id_number
        FROM patients
        WHERE (
          COALESCE(id_number::text, '') ILIKE $1
          OR COALESCE(voter_id::text, '') ILIKE $1
        )
        ORDER BY ${orderBy}
        LIMIT $2
      `;
      queryParams = [`%${q}%`, limit];
    }

    const result = await pool.query(queryText, queryParams);

    return res.json({
      success: true,
      matches: result.rows.map((row) => ({
        ...row,
        patient_id: normalizeIdValue(row.patient_id),
        uhid: normalizeIdValue(row.uhid),
      })),
    });
  } catch (error) {
    console.error("Patient lookup error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to lookup patients",
      error: error.message,
    });
  }
});

// =============================
// GET SINGLE PATIENT BY GENERIC IDENTIFIER
// =============================
router.get("/details/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const patient = await findPatientByIdentifier(identifier);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    return res.json({
      success: true,
      patient: {
        ...patient,
        patient_id: normalizeIdValue(patient.patient_id),
        uhid: normalizeIdValue(patient.uhid),
      },
    });
  } catch (error) {
    console.error("Get Patient Details Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// =============================
// PRINT PATIENT REGISTRATION SLIP
// =============================
router.get("/print/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const patient = await findPatientByIdentifier(identifier);

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Patient not found for printing",
      });
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

    // Header
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

    // Section: Identity
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

    // Section: Visit Details
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

    // Section: Billing & Consent
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

// =============================
// UPDATE PATIENT
// =============================
router.put("/:identifier", upload.single("id_proof_path"), async (req, res) => {
  try {
    const { identifier } = req.params;
    const existing = await findPatientByIdentifier(identifier);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    const {
      first_name,
      last_name,
      gender,
      dob,
      age,
      mobile,
      email,
      address,
      idType,
      idNumber,
      biometric_flag,
      data_privacy_accepted,
      consent_image_sharing,
      consent_telemedicine,
      digital_signature,
      photo_url,
      referring_doctor,
      attending_physician,
      visit_type,
      modality,
      modalities,
      study_type,
      study,
      address_line1,
      consent_signed,
      signature_file,
    } = req.body;

    const patientColumns = await getPatientColumns();
    const idProofPath = req.file ? `/uploads/patient_docs/${req.file.filename}` : undefined;
    const fullName = [first_name, last_name].filter(Boolean).join(" ").trim();
    const rawOccupation = String(req.body.occupation || "").trim();
    const rawIdNumber = String(idNumber || req.body.id_number || "").trim();
    const normalizedOccupation =
      rawOccupation && rawIdNumber && rawOccupation === rawIdNumber && /^\d+$/.test(rawOccupation)
        ? null
        : rawOccupation || null;
    const signatureRaw = digital_signature || signature_file || "";
    const signatureValue = signatureRaw ? String(signatureRaw) : null;
    const safeSignatureValue = signatureValue && signatureValue.length > 255 ? null : signatureValue;
    const signatureForUpdate = signatureRaw ? safeSignatureValue : undefined;

    const updates = {
      full_name: fullName || undefined,
      first_name,
      last_name: last_name || null,
      gender,
      dob: dob || null,
      age: age || null,
      mobile: mobile || null,
      email: email || null,
      address: address || address_line1 || null,
      address_line1: address || address_line1 || null,
      city: req.body.city || null,
      district: req.body.district || null,
      state: req.body.state || null,
      pincode: req.body.pincode || null,
      id_type: idType || null,
      id_number: idNumber || null,
      biometric_flag: biometric_flag === "true" || biometric_flag === true,
      id_proof_path: idProofPath,
      id_proof: idProofPath,
      patient_type: req.body.patient_type || null,
      clinical_history: req.body.medical_history || req.body.clinical_history || null,
      provisional_diagnosis:
        req.body.indication_for_scan || req.body.provisional_diagnosis || study_type || study || null,
      data_privacy_accepted: data_privacy_accepted === "true" || data_privacy_accepted === true,
      consent_signed:
        consent_signed === "true" ||
        consent_signed === true ||
        data_privacy_accepted === "true" ||
        data_privacy_accepted === true,
      consent_image_sharing: consent_image_sharing === "true" || consent_image_sharing === true,
      consent_telemedicine: consent_telemedicine === "true" || consent_telemedicine === true,
      digital_signature: signatureForUpdate,
      signature_file: signatureForUpdate,
      photo_url: photo_url || null,
      referring_doctor: referring_doctor || attending_physician || null,
      attending_physician: attending_physician || null,
      visit_type: visit_type || null,
      modality: modality || modalities || null,
      study_type: study_type || study || null,
      study: study_type || study || null,
      contrast:
        req.body.contrast_safety_flag === "true" ||
        req.body.contrast_safety_flag === true ||
        req.body.contrast === "true" ||
        req.body.contrast === true,
      urgency: req.body.urgency || null,
      billing_type: req.body.billing_category || req.body.billing_type || null,
      insurance_id: req.body.insurance_id || null,
      abha_number: req.body.abha_number || null,
      abha_address: req.body.abha_address || null,
      voter_id: req.body.voter_id || null,
      registration_channel: req.body.registration_channel || null,
      title: req.body.title || null,
      relationship_type: req.body.relationship_type || null,
      relationship_name: req.body.relationship_name || null,
      marital_status: req.body.marital_status || null,
      occupation: normalizedOccupation,
      nationality: req.body.nationality || null,
      language_preference: req.body.language_preference || null,
      emergency_contact_name: req.body.emergency_contact_name || null,
      emergency_contact_phone: req.body.emergency_contact_phone || null,
      emergency_contact_relation: req.body.emergency_contact_relation || null,
      secondary_contact_name: req.body.secondary_contact_name || req.body.secondaryContactName || null,
      secondary_contact_phone: req.body.secondary_contact_phone || req.body.secondaryContactPhone || null,
      blood_group: req.body.blood_group || null,
      height_cm: req.body.height_cm || null,
      weight_kg: req.body.weight_kg || null,
      allergies: req.body.allergies || null,
      current_medications: req.body.current_medications || null,
      medical_history: req.body.medical_history || null,
      is_pregnant:
        req.body.is_pregnant === "true" ||
        req.body.is_pregnant === true ||
        req.body.isPregnant === "true" ||
        req.body.isPregnant === true,
      menstrual_status: req.body.menstrual_status || null,
      lmp_date: req.body.lmp_date || null,
      edd: req.body.edd || null,
      gestational_age: req.body.gestational_age || null,
      creatinine_level: req.body.creatinine_level || null,
      contrast_safety_flag:
        req.body.contrast_safety_flag === "true" ||
        req.body.contrast_safety_flag === true,
      modalities: req.body.modalities || null,
      department: req.body.department || null,
      ward_room_bed: req.body.ward_room_bed || null,
      billing_category: req.body.billing_category || null,
      insurance_provider: req.body.insurance_provider || null,
      consent_research_ai:
        req.body.consent_research_ai === "true" ||
        req.body.consent_research_ai === true,
      indication_for_scan: req.body.indication_for_scan || null,
    };

    const setCols = Object.keys(updates).filter((col) => patientColumns.has(col) && updates[col] !== undefined);
    if (setCols.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update",
      });
    }

    const values = setCols.map((col) => updates[col]);
    const setClause = setCols.map((col, i) => `${col} = $${i + 1}`).join(", ");
    const where = ["uhid", "patient_id", "mrn", "id"]
      .filter((col) => patientColumns.has(col))
      .map((col) => `${col}::text = $${setCols.length + 1}`)
      .join(" OR ");

    const result = await pool.query(
      `UPDATE patients SET ${setClause} WHERE ${where} RETURNING *`,
      [...values, String(identifier)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    res.json({
      success: true,
      message: "Patient updated successfully",
      patient: {
        ...result.rows[0],
        patient_id: normalizeIdValue(result.rows[0].patient_id),
        uhid: normalizeIdValue(result.rows[0].uhid),
      },
    });
  } catch (error) {
    console.error("Patient Update Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update patient",
      error: error.message,
    });
  }
});

// =============================
// GET SINGLE PATIENT
// =============================
router.get("/:uhid", async (req, res) => {
  try {
    const { uhid } = req.params;

    const result = await pool.query("SELECT * FROM patients WHERE uhid = $1", [uhid]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Patient not found",
      });
    }

    res.json({
      success: true,
      patient: {
        ...result.rows[0],
        patient_id: normalizeIdValue(result.rows[0].patient_id),
        uhid: normalizeIdValue(result.rows[0].uhid),
      },
    });
  } catch (error) {
    console.error("Get Patient Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// =============================
// DELETE PATIENT
// =============================
router.delete("/:uhid", async (req, res) => {
  try {
    const { uhid } = req.params;

    await pool.query("DELETE FROM patients WHERE uhid = $1", [uhid]);

    res.json({
      success: true,
      message: "Patient deleted successfully",
    });
  } catch (error) {
    console.error("Delete Patient Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete patient",
    });
  }
});

module.exports = router;
