const path = require("path");
const fs = require("fs");
const patientRepository = require("../repositories/PatientRepository");
const { getTenantScope } = require("../utils/tenantScope");
const { logAction } = require("../utils/auditLogger");

const uploadDir = path.join(__dirname, "../uploads/patient_docs");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
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

function pad3(n) {
  return String(n).padStart(3, "0");
}

function buildPatientId(year, month, seq) {
  return `${year}/${String(month).padStart(2, "0")}/${pad3(seq)}`;
}

function generateMRN() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `MRN-${yy}${mm}-${rand}`;
}

function normalizeIdValue(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/\//g, "");
}

class PatientService {
  constructor() {
    this.lookupCache = new Map();
  }

  async generateCustomMRN(clinicId = null) {
    let prefix = "MRN";
    let format = "{PREFIX}-{YY}{MM}-{SEQ}";
    let nextSeq = 1001;

    if (clinicId) {
      const config = await patientRepository.getMRNConfig(clinicId);
      if (config) {
        if (config.mrn_prefix) prefix = config.mrn_prefix;
        if (config.mrn_format) format = config.mrn_format;
        if (config.mrn_next_seq) nextSeq = config.mrn_next_seq;
        await patientRepository.incrementMRNSeq(clinicId);
      }
    } else {
      const maxId = await patientRepository.getMaxPatientId();
      nextSeq = Number(maxId) + 1001;
    }

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const seq = String(nextSeq).padStart(4, "0");

    return format
      .replace("{PREFIX}", prefix)
      .replace("{YYYY}", yyyy)
      .replace("{YY}", yy)
      .replace("{MM}", mm)
      .replace("{SEQ}", seq);
  }

  async getNextId(req) {
    const scope = getTenantScope(req);
    return await this.generateCustomMRN(scope.clinicId);
  }

  async createPatient(req, file) {
    const scope = getTenantScope(req);
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

    if (!first_name || !gender) {
      throw { statusCode: 400, message: "First Name and Gender are required" };
    }

    const patientId = req.body.patient_id || req.body.uhid || (await this.generateCustomMRN(scope.clinicId));
    const uhid = patientId;
    const mrn = generateMRN();
    const fullName = [first_name, last_name].filter(Boolean).join(" ").trim();
    const idProofPath = file ? `/uploads/patient_docs/${file.filename}` : null;
    const rawOccupation = String(req.body.occupation || "").trim();
    const rawIdNumber = String(idNumber || req.body.id_number || "").trim();
    const normalizedOccupation =
      rawOccupation && rawIdNumber && rawOccupation === rawIdNumber && /^\d+$/.test(rawOccupation)
        ? null
        : rawOccupation || null;

    const photoUrlSaved = saveBase64ToDisk(photo_url, "PHOTO") || idProofPath;
    const signatureSaved = saveBase64ToDisk(digital_signature || signature_file, "SIGN");
    const paperConsentSaved = saveBase64ToDisk(req.body.paper_consent_url, "CONSENT");

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
      clinic_id: scope.clinicId,
    };

    let createdPatient;
    try {
      createdPatient = await patientRepository.createPatient(record);
    } catch (err) {
      if (err?.code === "23505" && err?.constraint === "uq_patients_idtype_idnumber") {
        const idTypeVal = String(req.body?.idType || "").trim();
        const idNumVal = String(req.body?.idNumber || req.body?.id_number || "").trim();
        const existing = await patientRepository.findDuplicatePatient(idTypeVal, idNumVal);
        throw {
          statusCode: 409,
          message: "Patient already exists with this ID type and ID number",
          conflict_field: "id_type+id_number",
          patient: existing,
        };
      }
      throw err;
    }

    await logAction(req, {
      event: "CREATE_PATIENT",
      page: "/api/patients",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "CREATE_PATIENT",
        target_patient_id: createdPatient.uhid || createdPatient.patient_id,
        timestamp: new Date().toISOString(),
      },
    });

    try {
      const gross = Number(req.body.bill_amount) || Number(req.body.total_amount) || 1500;
      const discount = Number(req.body.discount_amount) || 0;
      const grandTotal = Math.max(0, gross - discount);
      const paymentCategory = req.body.billing_category || req.body.payment_method || "Self-Pay";
      const paymentStatus = req.body.payment_status || (["Self-Pay", "UPI_SCAN", "CARD_POS", "CASH"].includes(paymentCategory) ? "PAID" : "PENDING");
      const invoiceNumber = `INV-${Date.now()}`;

      await patientRepository.createInvoice(
        invoiceNumber,
        uhid,
        gross,
        discount,
        grandTotal,
        paymentStatus,
        paymentCategory
      );
    } catch (invErr) {
      console.warn("Auto-invoice creation notice:", invErr.message);
    }

    return createdPatient;
  }

  async resequenceIds(req) {
    const scope = getTenantScope(req);
    const resequenceData = await patientRepository.findPatientsForResequence(scope.clinicId, scope.userId);
    const { rows, keyColumn, hasPatientId, hasUhid, hasCreatedAt } = resequenceData;

    if (rows.length === 0) {
      return 0;
    }

    const counters = new Map();
    let updated = 0;

    for (const row of rows) {
      const d = hasCreatedAt && row.created_at ? new Date(row.created_at) : new Date();
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const key = `${year}/${String(month).padStart(2, "0")}`;
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);

      const newId = buildPatientId(year, month, next);
      await patientRepository.updatePatientIdForResequence(
        keyColumn,
        hasPatientId,
        hasUhid,
        row.row_key,
        newId,
        scope.clinicId,
        scope.userId
      );
      updated += 1;
    }

    await logAction(req, {
      event: "RESEQUENCE_PATIENT_IDS",
      page: "/api/patients/resequence-ids",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "RESEQUENCE_PATIENT_IDS",
        updated,
        timestamp: new Date().toISOString(),
      },
    });

    return updated;
  }

  async getAllPatients(req) {
    const scope = getTenantScope(req);
    const result = await patientRepository.getAllPatients(req);

    await logAction(req, {
      event: "READ_PATIENT_LIST",
      page: "/api/patients",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_PATIENT_LIST",
        count: result.rowCount,
        timestamp: new Date().toISOString(),
      },
    });

    return result.rows.map((row) => ({
      ...row,
      patient_id: normalizeIdValue(row.patient_id),
      uhid: normalizeIdValue(row.uhid),
    }));
  }

  async lookupPatients(req) {
    const scope = getTenantScope(req);
    const field = String(req.query.field || "").trim();
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 25);

    const allowed = new Set(["mobile", "abha_number", "id_number"]);
    if (!allowed.has(field)) {
      throw { statusCode: 400, message: "Invalid lookup field" };
    }
    if (!q || q.length < 2) {
      return [];
    }

    const cacheKey = `${scope.clinicId}_${field}_${q}_${limit}`;
    const now = Date.now();
    const cached = this.lookupCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    const result = await patientRepository.lookupPatients(field, q, limit, req);

    await logAction(req, {
      event: "LOOKUP_PATIENTS",
      page: "/api/patients/lookup",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "LOOKUP_PATIENTS",
        field,
        count: result.rowCount,
        timestamp: new Date().toISOString(),
      },
    });

    const mapped = result.rows.map((row) => ({
      ...row,
      patient_id: normalizeIdValue(row.patient_id),
      uhid: normalizeIdValue(row.uhid),
    }));

    this.lookupCache.set(cacheKey, { data: mapped, expiresAt: Date.now() + 30000 });
    return mapped;
  }

  async getPatientDetails(req, identifier) {
    const scope = getTenantScope(req);
    const patient = await patientRepository.findPatientByIdentifier(identifier, req);

    if (!patient) {
      throw { statusCode: 404, message: "Patient not found" };
    }

    await logAction(req, {
      event: "READ_PATIENT_DETAILS",
      page: `/api/patients/details/${identifier}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_PATIENT_DETAILS",
        target_patient_id: patient.uhid || patient.patient_id || identifier,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      ...patient,
      patient_id: normalizeIdValue(patient.patient_id),
      uhid: normalizeIdValue(patient.uhid),
    };
  }

  async getPatientPrintDetails(req, identifier) {
    const scope = getTenantScope(req);
    const patient = await patientRepository.findPatientByIdentifier(identifier, req);

    if (!patient) {
      throw { statusCode: 404, message: "Patient not found for printing" };
    }

    await logAction(req, {
      event: "PRINT_PATIENT_SLIP",
      page: `/api/patients/print/${identifier}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "PRINT_PATIENT_SLIP",
        target_patient_id: patient.uhid || patient.patient_id || identifier,
        timestamp: new Date().toISOString(),
      },
    });

    return patient;
  }

  async updatePatient(req, identifier) {
    const scope = getTenantScope(req);
    const updated = await patientRepository.updatePatientByIdentifier(identifier, req.body, req);

    if (!updated) {
      throw { statusCode: 404, message: "Patient not found or unauthorized" };
    }

    await logAction(req, {
      event: "UPDATE_PATIENT",
      page: `/api/patients/${identifier}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "UPDATE_PATIENT",
        target_patient_id: updated.uhid || updated.patient_id || identifier,
        timestamp: new Date().toISOString(),
      },
    });

    return updated;
  }

  async deletePatient(req, uhid) {
    const scope = getTenantScope(req);
    const deleted = await patientRepository.deletePatientByUhid(uhid, req);

    if (!deleted) {
      throw { statusCode: 404, message: "Patient not found or unauthorized" };
    }

    await logAction(req, {
      event: "DELETE_PATIENT",
      page: `/api/patients/${uhid}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "DELETE_PATIENT",
        target_patient_id: uhid,
        timestamp: new Date().toISOString(),
      },
    });

    return deleted;
  }
}

module.exports = new PatientService();
