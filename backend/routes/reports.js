const express = require("express");
const router = express.Router();
const path = require("path");
const { Pool } = require("pg");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const { logAction } = require("../utils/auditLogger");

const generateFinalReportPDF = require("../utils/generateFinalReportPDF");

// ======================================================
// ORTHANC CONNECTION CONFIG
// ======================================================
const ORTHANC_URL = (process.env.ORTHANC_URL || "http://orthanc:8042/").replace(/\/?$/, "/");
const ORTHANC_USER = process.env.ORTHANC_USER || "";
const ORTHANC_PASS = process.env.ORTHANC_PASS || "";

function orthancAuthConfig() {
  if (!ORTHANC_USER || !ORTHANC_PASS) return {};
  return { auth: { username: ORTHANC_USER, password: ORTHANC_PASS } };
}

const pool = require("../db");
/* ======================================================
   REPORT IMAGE UPLOAD  (FIXED)
====================================================== */
const reportImagesDir = path.join(__dirname, "../uploads/report_images");

if (!fs.existsSync(reportImagesDir)) {
  fs.mkdirSync(reportImagesDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, reportImagesDir);
  },

  filename: (req, file, cb) => {
    const studyUID = req.body.studyUID;
    if (!studyUID) {
      return cb(new Error("studyUID is required"));
    }

    const safeStudyUID = String(studyUID).replace(/[^A-Za-z0-9._-]/g, "");
    if (!safeStudyUID) {
      return cb(new Error("Invalid studyUID"));
    }

    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = new Set([".jpg", ".jpeg", ".png"]);
    if (!allowedExt.has(ext)) {
      return cb(new Error("Unsupported file type"));
    }

    // find existing images for same studyUID
    const existingFiles = fs
      .readdirSync(reportImagesDir)
      .filter((f) => f.startsWith(safeStudyUID));

    const suffix = existingFiles.length
      ? `_${existingFiles.length + 1}`
      : "";

    cb(null, `${safeStudyUID}${suffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExt = new Set([".jpg", ".jpeg", ".png"]);
    if (!allowedExt.has(ext)) {
      return cb(new Error("Unsupported file type"));
    }
    cb(null, true);
  },
});


// ======================================================
// Helper: Extract age from patient name
// ======================================================
function extractAgeFromName(name) {
  if (!name) return "N/A";

  const clean = String(name);

  // Match: 34Y, 34 Y, ^34^Y, ^34Y
  const yearMatch = clean.match(/(\d{1,3})\s*\^?\s*Y\b/i);
  if (yearMatch) return yearMatch[1];

  const monthMatch = clean.match(/(\d{1,2})\s*\^?\s*(MONTH|M)\b/i);
  if (monthMatch) return `${monthMatch[1]} Months`;

  return "N/A";
}

function formatStudyDateTime(date, time) {
  if (!date) return "—";

  const yyyy = date.slice(0, 4);
  const mm = date.slice(4, 6);
  const dd = date.slice(6, 8);

  let result = `${dd}-${mm}-${yyyy}`;

  if (time && time.length >= 4) {
    const hh = time.slice(0, 2);
    const min = time.slice(2, 4);
    result += ` ${hh}:${min}`;
  }

  return result;
}

/* =========================
   UPLOAD REPORT IMAGES
========================= */
router.post("/api/reports/upload", upload.array("images", 10), (req, res) => {
  try {
    const paths = req.files.map(
      f => `/uploads/report_images/${f.filename}`
    );
    res.json({ success: true, paths });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ success: false });
  }
});

/* ======================================================
   GET STUDY + REPORT BY STUDY UID (FOR PREFILL)
====================================================== */
router.get("/api/study-report/:uid",  async (req, res) => {
  try {
    const { uid } = req.params;

    // 1️⃣ Fetch study info
    const studyRes = await pool.query(
      `SELECT * FROM studies WHERE study_uid=$1`,
      [uid]
    );

    if (!studyRes.rows.length) {
      return res.status(404).json({ error: "Study not found" });
    }
    const study = studyRes.rows[0];

    // 2️⃣ Fetch latest report (Draft / Final / Addendum)
    const reportRes = await pool.query(
  `
  SELECT *
  FROM reports
  WHERE study_uid = $1
  ORDER BY (status = 'Addendum') DESC, created_at DESC
  LIMIT 1
  `,
  [uid]
);


    const report = reportRes.rows.length ? reportRes.rows[0] : null;
if (report) {
  const addendumRes = await pool.query(
    `SELECT reason 
     FROM report_addendums 
     WHERE report_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [report.id]
  );

  report.addendum_reason = addendumRes.rows.length
    ? addendumRes.rows[0].reason
    : null;
}

    // 3️⃣ Fetch report images if report exists
    let images = [];
    if (report) {
      const imagesRes = await pool.query(
        `SELECT image_path, image_type, sort_order 
         FROM report_images 
         WHERE report_id=$1 
         ORDER BY sort_order`,
        [report.id]
      );
      images = imagesRes.rows;
    }

  res.json({
  study: {
    ...study,
    study_datetime: formatStudyDateTime(
      study.study_date,
      study.study_time
    ),
    age: study.patient_age || extractAgeFromName(study.patient_name),
    gender: study.patient_sex
  },

  report: report
    ? {
        ...report,

        reported_by: report.reported_by_signature
  ? `${report.reported_by_signature.full_name || ""} ${report.reported_by_signature.qualification || ""}`.trim()
  : "N/A",

approved_by: report.approved_by_signature
  ? `${report.approved_by_signature.full_name || ""} ${report.approved_by_signature.designation || ""}`.trim()
  : "N/A",

        study_datetime: formatStudyDateTime(
          study.study_date,
          study.study_time
        ),

        reported_datetime: report.created_at
          ? new Date(report.created_at).toLocaleString()
          : "—",

        images,
        addendum_reason: report.addendum_reason
      }
    : null
});


  } catch (err) {
    console.error("Study-Report fetch error:", err);
    res.status(500).json({ error: "Failed to fetch study and report data" });
  }
});

/* ======================================================
   GET STUDY DETAILS BY UID
====================================================== */
router.get("/api/studies/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const find = await axios.post(
      `${ORTHANC_URL}tools/find`,
      { Level: "Study", Query: { StudyInstanceUID: uid } },
      orthancAuthConfig()
    );
    if (!find.data?.length) return res.json({ message: "No study found" });

    const studyId = find.data[0];
    const study = await axios.get(`${ORTHANC_URL}studies/${studyId}`, orthancAuthConfig());
    const s = study.data;

    let modality = "", bodyPart = "";
    if (s.Series?.length) {
      const series = await axios.get(`${ORTHANC_URL}series/${s.Series[0]}`, orthancAuthConfig());
      modality = series.data.MainDicomTags.Modality || "";
      bodyPart = series.data.MainDicomTags.BodyPartExamined || "";
    }

    res.json({
      PatientID: s.PatientMainDicomTags.PatientID,
      PatientName: s.PatientMainDicomTags.PatientName,
      PatientSex: s.PatientMainDicomTags.PatientSex,
      PatientAge: s.PatientMainDicomTags.PatientAge,
      StudyInstanceUID: uid,
      StudyDate: s.MainDicomTags.StudyDate,
      StudyTime: s.MainDicomTags.StudyTime,
      AccessionNumber: s.MainDicomTags.AccessionNumber,
      StudyDescription: s.MainDicomTags.StudyDescription,
      Modality: modality,
      BodyPartExamined: bodyPart,
      History: "", Findings: "", Conclusion: "",
    });
  } catch (err) {
    console.error("Fetch study error:", err.message);
    res.status(500).json({ error: "Failed to load study" });
  }
});

/* ======================================================
   GET ALL REPORTS (FOR DASHBOARD / TABLE)
====================================================== */
router.get("/api/reports", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        r.id,
        r.study_uid,
        r.accession_number,
        r.patient_id,
        r.patient_name,
        r.modality,
        r.status,
         r.reported_by_signature,
  r.approved_by_signature,
        r.created_at
      FROM reports r
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch reports error:", err.message);
    res.status(500).json({ error: "Failed to load reports" });
  }
});



//save and update
const saveReportHandler = async (req, res) => {
  try {
    const {
      study_uid,
      accession_number,
      patient_id,
      patient_name,
      modality,
      reported_by_signature,
      approved_by_signature,
      status,
      body_part,
      referring_doctor,
      image_paths,
      isAddendum,
    } = req.body;

    const history = req.body.history ?? req.body.report_content?.history ?? "";
    const findings = req.body.findings ?? req.body.report_content?.findings ?? "";
    const conclusion = req.body.conclusion ?? req.body.report_content?.conclusion ?? "";
    const reportTitle = req.body.reportTitle ?? req.body.report_content?.title ?? "RADIOLOGY REPORT";
    const snapshots = req.body.snapshots ?? req.body.report_content?.snapshots ?? [];

    const reportContent = { history, findings, conclusion, title: reportTitle, snapshots };
    let reportId;

    // =========================
    // SIGNED REPORT LOCK PROTECTION (LEGAL & MEDICAL COMPLIANCE)
    // =========================
    const existingSigned = await pool.query(
      `SELECT id, status FROM reports
       WHERE study_uid = $1 AND status IN ('Final', 'Signed', 'Approved', 'FINAL', 'COMPLETED')
       ORDER BY updated_at DESC LIMIT 1`,
      [study_uid]
    );

    if (existingSigned.rows.length > 0 && status !== "Addendum" && !isAddendum && req.body.allowAdminOverride !== true) {
      return res.status(403).json({
        error: "🔒 This radiology report has been FINALLY SIGNED OFF and is legally locked from direct modification. Please select 'Create Addendum' to record an official addendum."
      });
    }

    // =========================
    // Fetch existing signatures if any
    // =========================
    let existingSignatures = { reported_by_signature: null, approved_by_signature: null };
    if (status === "Final" || status === "Addendum" || isAddendum) {
      const prevReport = await pool.query(
        `SELECT reported_by_signature, approved_by_signature
         FROM reports
         WHERE study_uid=$1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [study_uid]
      );
      if (prevReport.rows.length) {
        existingSignatures = prevReport.rows[0];
      }
    }

    // Use new signature if provided, otherwise fallback to existing
    const finalReportedSignature = reported_by_signature || existingSignatures.reported_by_signature;
    const finalApprovedSignature = approved_by_signature || existingSignatures.approved_by_signature;

    // =========================
    // ADDENDUM → ALWAYS INSERT
    // =========================
    if (status === "Addendum" || isAddendum) {
      const previousReportRes = await pool.query(
        `SELECT accession_number, patient_id, patient_name, modality, report_title, body_part, referring_doctor
         FROM reports
         WHERE study_uid = $1
         ORDER BY updated_at DESC
         LIMIT 1`,
        [study_uid]
      );
      const previousReport = previousReportRes.rows[0] || {};

      const resolvedAccession = accession_number || previousReport.accession_number || null;
      const resolvedPatientId = patient_id || previousReport.patient_id || null;
      const resolvedPatientName = patient_name || previousReport.patient_name || null;
      const resolvedModality = modality || previousReport.modality || null;
      const resolvedTitle = reportTitle || previousReport.report_title || null;
      const resolvedBodyPart = body_part || previousReport.body_part || null;
      const resolvedRefDoctor = referring_doctor || previousReport.referring_doctor || null;

      const result = await pool.query(
        `INSERT INTO reports (
          study_uid, accession_number, patient_id, patient_name,
          modality, report_content, reported_by_signature, approved_by_signature,
          status, report_title, body_part, referring_doctor
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Addendum',$9,$10,$11)
        RETURNING id`,
        [
          study_uid, resolvedAccession, resolvedPatientId, resolvedPatientName,
          resolvedModality, reportContent, finalReportedSignature, finalApprovedSignature,
          resolvedTitle, resolvedBodyPart, resolvedRefDoctor
        ]
      );
      reportId = result.rows[0].id;
    }
    // =========================
    // FINAL → UPDATE DRAFT / FINAL
    // =========================
    else if (status === "Final") {
      // Try Draft first
      const draft = await pool.query(
        `SELECT id FROM reports
         WHERE study_uid=$1 AND status='Draft'
         ORDER BY updated_at DESC LIMIT 1`,
        [study_uid]
      );

      if (draft.rows.length) {
        // Draft → Final
        const result = await pool.query(
          `UPDATE reports
           SET report_content=$1,
               reported_by_signature=$2,
               approved_by_signature=$3,
               status='Final',
               report_title=$4,
               body_part=$5,
               referring_doctor=$6,
               updated_at=NOW()
           WHERE id=$7
           RETURNING id`,
          [
            reportContent,
            finalReportedSignature,
            finalApprovedSignature,
            reportTitle,
            body_part,
            referring_doctor,
            draft.rows[0].id
          ]
        );
        reportId = result.rows[0].id;
      } else {
        // Update existing Final if exists
        const final = await pool.query(
          `SELECT id FROM reports
           WHERE study_uid=$1 AND status='Final'
           ORDER BY updated_at DESC LIMIT 1`,
          [study_uid]
        );

        if (final.rows.length) {
          const result = await pool.query(
            `UPDATE reports
             SET report_content=$1,
                 reported_by_signature=$2,
                 approved_by_signature=$3,
                 report_title=$4,
                 body_part=$5,
                 referring_doctor=$6,
                 updated_at=NOW()
             WHERE id=$7
             RETURNING id`,
            [
              reportContent,
              finalReportedSignature,
              finalApprovedSignature,
              reportTitle,
              body_part,
              referring_doctor,
              final.rows[0].id
            ]
          );
          reportId = result.rows[0].id;
        } else {
          // No Draft & no Final → create Final
          const result = await pool.query(
            `INSERT INTO reports (
              study_uid, accession_number, patient_id, patient_name,
              modality, report_content, reported_by_signature, approved_by_signature,
              status, report_title, body_part, referring_doctor
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Final',$9,$10,$11)
            RETURNING id`,
            [
              study_uid, accession_number, patient_id, patient_name,
              modality, reportContent, finalReportedSignature, finalApprovedSignature,
              reportTitle, body_part, referring_doctor
            ]
          );
          reportId = result.rows[0].id;
        }
      }
    }
    // =========================
    // DRAFT → UPDATE OR INSERT
    // =========================
    else {
      const existingDraft = await pool.query(
        `SELECT id, reported_by_signature, approved_by_signature FROM reports
         WHERE study_uid=$1 AND status='Draft'
         ORDER BY updated_at DESC LIMIT 1`,
        [study_uid]
      );

      if (existingDraft.rows.length) {
        const draftSig = existingDraft.rows[0];
        const draftReportedSignature = reported_by_signature || draftSig.reported_by_signature;
        const draftApprovedSignature = approved_by_signature || draftSig.approved_by_signature;

        // UPDATE Draft
        const result = await pool.query(
          `UPDATE reports
           SET report_content=$1,
               reported_by_signature=$2,
               approved_by_signature=$3,
               report_title=$4,
               body_part=$5,
               referring_doctor=$6,
               updated_at=NOW()
           WHERE id=$7
           RETURNING id`,
          [
            reportContent,
            draftReportedSignature,
            draftApprovedSignature,
            reportTitle,
            body_part,
            referring_doctor,
            existingDraft.rows[0].id
          ]
        );
        reportId = result.rows[0].id;
      } else {
        // INSERT Draft
        const result = await pool.query(
          `INSERT INTO reports (
            study_uid, accession_number, patient_id, patient_name,
            modality, report_content, reported_by_signature, approved_by_signature,
            status, report_title, body_part, referring_doctor
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft',$9,$10,$11)
          RETURNING id`,
          [
            study_uid, accession_number, patient_id, patient_name,
            modality, reportContent, reported_by_signature, approved_by_signature,
            reportTitle, body_part, referring_doctor
          ]
        );
        reportId = result.rows[0].id;
      }
    }

    // =========================
    // IMAGES & SNAPSHOTS (replace for that row)
    // =========================
    const snapshotUrls = Array.isArray(snapshots) ? snapshots.map(s => typeof s === "string" ? s : (s.preview_url || s.url)).filter(Boolean) : [];
    const allImagePaths = Array.isArray(image_paths) && image_paths.length > 0 ? image_paths : snapshotUrls;

    if (allImagePaths.length > 0) {
      await pool.query(`DELETE FROM report_images WHERE report_id=$1`, [reportId]);
      for (let i = 0; i < allImagePaths.length; i++) {
        await pool.query(
          `INSERT INTO report_images (report_id, image_path, sort_order)
           VALUES ($1,$2,$3)`,
          [reportId, allImagePaths[i], i + 1]
        );
      }
    }

    await logAction(req, {
      event:
        status === "Final"
          ? "REPORT_FINAL_SAVED"
          : status === "Addendum" || isAddendum
          ? "REPORT_ADDENDUM_SAVED"
          : "REPORT_DRAFT_SAVED",
      details: {
        report_id: reportId,
        study_uid,
        accession_number,
        patient_id,
        patient_name,
        modality,
        report_title: reportTitle || null,
      },
    });

    res.json({ success: true, reportId });
  } catch (err) {
    console.error("Save report error:", err);
    res.status(500).json({ error: "Failed to save report" });
  }
};

router.post("/api/reports/save", saveReportHandler);
router.post("/api/reports", saveReportHandler);


/* ======================================================
   GET REPORT BY STUDY UID (PREFETCH LOGIC)
====================================================== */
router.get("/api/reports/by-study/:uid", async (req, res) => {
  try {
    const { uid } = req.params;

    // 1️⃣ Fetch the latest report (Final or Addendum)
    const reportRes = await pool.query(
  `
  SELECT *
  FROM reports
  WHERE study_uid = $1
  ORDER BY (status = 'Addendum') DESC, created_at DESC
  LIMIT 1
  `,
  [uid]
);


    if (!reportRes.rows.length) return res.json(null);

    let report = reportRes.rows[0];
    // Fetch latest addendum reason for this report
const addendumRes = await pool.query(
  `SELECT reason 
   FROM report_addendums 
   WHERE report_id = $1
   ORDER BY created_at DESC
   LIMIT 1`,
  [report.id]
);

report.addendum_reason = addendumRes.rows.length
  ? addendumRes.rows[0].reason
  : null;


    // 2️⃣ If signature missing, fallback to previous Final report
    if (!report.reported_by_signature || !report.approved_by_signature) {
      const prevFinalRes = await pool.query(
        `SELECT reported_by_signature, approved_by_signature
         FROM reports
         WHERE study_uid = $1 AND status='Final'
         ORDER BY created_at DESC
         LIMIT 1`,
        [uid]
      );
      if (prevFinalRes.rows.length) {
        report.reported_by_signature = report.reported_by_signature || prevFinalRes.rows[0].reported_by_signature;
        report.approved_by_signature = report.approved_by_signature || prevFinalRes.rows[0].approved_by_signature;
      }
    }

    // 3️⃣ Fetch report images
    const imagesRes = await pool.query(
      `SELECT image_path, image_type, sort_order
       FROM report_images
       WHERE report_id = $1
       ORDER BY sort_order`,
      [report.id]
    );

    let content = report.report_content || {};
    if (typeof content === "string") {
      try { content = JSON.parse(content); } catch { content = {}; }
    }

    // 4️⃣ Return everything explicitly
    res.json({
      id: report.id,
      study_uid: report.study_uid,
      status: report.status,
      report_content: content,
      snapshots: content.snapshots || [],
      history: content.history || "",
      findings: content.findings || "",
      conclusion: content.conclusion || "",
      report_title: content.title || report.report_title || "",
      title: content.title || report.report_title || "",
      body_part: report.body_part,
      referring_doctor: report.referring_doctor,
      reported_by_signature: report.reported_by_signature,
      approved_by_signature: report.approved_by_signature,
      addendum_reason: report.addendum_reason,
      images: imagesRes.rows
    });

  } catch (err) {
    console.error("Fetch report error:", err.message);
    res.status(500).json({ error: "Failed to load report" });
  }
});

/* ======================================================
   SAVE ADDENDUM REASON
====================================================== */
router.post("/api/addendum/save-reason", async (req, res) => {
  console.log("===== ADDENDUM API CALLED =====");
  console.log("BODY RECEIVED:", req.body);
  try {
    const { report_id, study_uid, reason, created_by } = req.body;

    if (!report_id || !reason) {
      return res.json({ success: false, message: "Missing data" });
    }

    const result = await pool.query(
      `INSERT INTO report_addendums 
       (report_id, study_uid, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [report_id, study_uid, reason, created_by]
    );

    res.json({
      success: true,
      id: result.rows[0].id
    });

  } catch (err) {
    console.error("Save addendum reason error:", err);
    res.status(500).json({ success: false });
  }
});

/* =========================
   GET PDF BY REPORT ID
========================= */
router.get("/api/reports/:id/pdf", async (req, res) => {
  try {
    const reportId = req.params.id;

    const reportRes = await pool.query(
      `SELECT
          r.*,
          COALESCE(NULLIF(r.accession_number, ''), base.accession_number) AS accession_number,
          COALESCE(NULLIF(r.patient_id, ''), base.patient_id) AS patient_id,
          COALESCE(NULLIF(r.patient_name, ''), base.patient_name) AS patient_name,
          COALESCE(NULLIF(r.modality, ''), base.modality) AS modality,
          COALESCE(NULLIF(r.report_title, ''), base.report_title) AS report_title,
          COALESCE(NULLIF(r.body_part, ''), base.body_part) AS body_part,
          COALESCE(NULLIF(r.referring_doctor, ''), base.referring_doctor) AS referring_doctor,
          s.study_date,
          s.study_time,
          (SELECT reason
           FROM report_addendums
           WHERE report_id = r.id
           ORDER BY created_at DESC
           LIMIT 1) AS addendum_reason
       FROM reports r
       LEFT JOIN LATERAL (
         SELECT
           rb.accession_number,
           rb.patient_id,
           rb.patient_name,
           rb.modality,
           rb.report_title,
           rb.body_part,
           rb.referring_doctor
         FROM reports rb
         WHERE rb.study_uid = r.study_uid
           AND rb.id <> r.id
         ORDER BY (rb.status = 'Final') DESC, rb.updated_at DESC, rb.created_at DESC
         LIMIT 1
       ) base ON TRUE
       LEFT JOIN studies s ON r.study_uid = s.study_uid
       WHERE r.id = $1`,
      [reportId]
    );

    if (!reportRes.rows.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    const report = reportRes.rows[0];

    const imagesRes = await pool.query(
      `SELECT image_path 
       FROM report_images 
       WHERE report_id = $1 
       ORDER BY sort_order`,
      [reportId]
    );

    const pdfPath = await generateFinalReportPDF(
      report,
      imagesRes.rows,
      { printMode: false }
    );

    res.contentType("application/pdf");
    res.sendFile(path.resolve(pdfPath));

  } catch (err) {
    console.error("PDF Route Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* =========================
   GET PDF BY STUDY UID (UPDATED)
========================= */
router.get("/api/reports/study/:studyUid/pdf", async (req, res) => {
  try {
    const { studyUid } = req.params;
    const requestedType = req.query.type; 

    // The subquery looks into report_addendums for the specific report_id
    // and grabs the single most recent reason string.
    let query = `
  SELECT
    r.*,
    COALESCE(NULLIF(r.accession_number, ''), base.accession_number) AS accession_number,
    COALESCE(NULLIF(r.patient_id, ''), base.patient_id) AS patient_id,
    COALESCE(NULLIF(r.patient_name, ''), base.patient_name) AS patient_name,
    COALESCE(NULLIF(r.modality, ''), base.modality) AS modality,
    COALESCE(NULLIF(r.report_title, ''), base.report_title) AS report_title,
    COALESCE(NULLIF(r.body_part, ''), base.body_part) AS body_part,
    COALESCE(NULLIF(r.referring_doctor, ''), base.referring_doctor) AS referring_doctor,
    s.study_date,
    s.study_time,
    (SELECT reason
     FROM report_addendums
     WHERE report_id = r.id
     ORDER BY created_at DESC
     LIMIT 1) AS addendum_reason
  FROM reports r
  LEFT JOIN LATERAL (
    SELECT
      rb.accession_number,
      rb.patient_id,
      rb.patient_name,
      rb.modality,
      rb.report_title,
      rb.body_part,
      rb.referring_doctor
    FROM reports rb
    WHERE rb.study_uid = r.study_uid
      AND rb.id <> r.id
    ORDER BY (rb.status = 'Final') DESC, rb.updated_at DESC, rb.created_at DESC
    LIMIT 1
  ) base ON TRUE
  LEFT JOIN studies s ON r.study_uid = s.study_uid
  WHERE r.study_uid = $1
`;

    const params = [studyUid];

    if (requestedType) {
      query += ` AND r.status = $2 ORDER BY r.created_at DESC LIMIT 1`;
      params.push(requestedType);
    } else {
      query += ` ORDER BY (r.status = 'Addendum') DESC, r.created_at DESC LIMIT 1`;
    }

    const reportRes = await pool.query(query, params);
    
    if (reportRes.rows.length === 0) {
      return res.status(404).json({ error: "No report found for this study" });
    }

    const report = reportRes.rows[0];
    
    // Fetch associated images
    const imagesRes = await pool.query(
      `SELECT image_path FROM report_images WHERE report_id = $1 ORDER BY sort_order`,
      [report.id]
    );

    const pdfPath = await generateFinalReportPDF(
  report,
  imagesRes.rows,
  { printMode: false }   // explicitly VIEW MODE
);

    res.contentType("application/pdf").sendFile(path.resolve(pdfPath));

  } catch (err) {
    console.error("Study PDF Route Error:", err);
    res.status(500).send("Error generating PDF");
  }
});

/* =========================
   PRINT PDF (STATUS HIDDEN)
========================= */
router.get("/api/reports/:id/pdf/print", async (req, res) => {
  try {
    const reportId = req.params.id;
const reportRes = await pool.query(
  `SELECT
      r.*,
      COALESCE(NULLIF(r.accession_number, ''), base.accession_number) AS accession_number,
      COALESCE(NULLIF(r.patient_id, ''), base.patient_id) AS patient_id,
      COALESCE(NULLIF(r.patient_name, ''), base.patient_name) AS patient_name,
      COALESCE(NULLIF(r.modality, ''), base.modality) AS modality,
      COALESCE(NULLIF(r.report_title, ''), base.report_title) AS report_title,
      COALESCE(NULLIF(r.body_part, ''), base.body_part) AS body_part,
      COALESCE(NULLIF(r.referring_doctor, ''), base.referring_doctor) AS referring_doctor,
      s.study_date,
      s.study_time,
      (SELECT reason FROM report_addendums
       WHERE report_id = r.id
       ORDER BY created_at DESC LIMIT 1) AS addendum_reason
   FROM reports r
   LEFT JOIN LATERAL (
     SELECT
       rb.accession_number,
       rb.patient_id,
       rb.patient_name,
       rb.modality,
       rb.report_title,
       rb.body_part,
       rb.referring_doctor
     FROM reports rb
     WHERE rb.study_uid = r.study_uid
       AND rb.id <> r.id
     ORDER BY (rb.status = 'Final') DESC, rb.updated_at DESC, rb.created_at DESC
     LIMIT 1
   ) base ON TRUE
   LEFT JOIN studies s ON r.study_uid = s.study_uid
   WHERE r.id = $1`,
  [reportId]
);


    if (!reportRes.rows.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    const imagesRes = await pool.query(
      `SELECT image_path FROM report_images 
       WHERE report_id = $1 ORDER BY sort_order`,
      [reportId]
    );

    const pdfPath = await generateFinalReportPDF(
      reportRes.rows[0],
      imagesRes.rows,
      { printMode: true }
    );

    res.contentType("application/pdf").sendFile(path.resolve(pdfPath));
  } catch (err) {
    console.error("Print PDF error:", err);
    res.status(500).send("Error generating PDF");
  }
});

/* =========================
   DELETE REPORT (COMPLIANCE PROTECTED)
========================= */
router.delete("/api/reports/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const reportCheck = await pool.query("SELECT id, status, study_uid FROM reports WHERE id=$1", [id]);
    
    if (!reportCheck.rows.length) {
      return res.status(404).json({ error: "Report not found" });
    }

    const rep = reportCheck.rows[0];
    const isSigned = ["Final", "Signed", "Approved", "FINAL", "COMPLETED"].includes(rep.status);

    if (isSigned && req.user?.role !== "ADMIN" && req.query.adminOverride !== "true") {
      return res.status(403).json({
        error: "🔒 Signed radiology reports are legally locked and cannot be deleted per medical-legal compliance requirements."
      });
    }

    await pool.query("DELETE FROM report_images WHERE report_id=$1", [id]);
    await pool.query("DELETE FROM report_addendums WHERE report_id=$1", [id]);
    await pool.query("DELETE FROM reports WHERE id=$1", [id]);

    await logAction(req, {
      event: "REPORT_DELETED",
      details: { report_id: id, study_uid: rep.study_uid, status: rep.status }
    });

    res.json({ success: true, message: "Report deleted successfully" });
  } catch (err) {
    console.error("Delete report error:", err.message);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

module.exports = router;
