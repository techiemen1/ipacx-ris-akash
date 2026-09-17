const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const reportService = require("../services/ReportService");

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

// ======================================================
// REPORT IMAGE UPLOAD CONFIG
// ======================================================
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

    const existingFiles = fs
      .readdirSync(reportImagesDir)
      .filter((f) => f.startsWith(safeStudyUID));

    const suffix = existingFiles.length ? `_${existingFiles.length + 1}` : "";
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
// UPLOAD REPORT IMAGES
// ======================================================
router.post("/api/reports/upload", upload.array("images", 10), (req, res) => {
  try {
    const paths = req.files.map((f) => `/uploads/report_images/${f.filename}`);
    res.json({ success: true, paths });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ======================================================
// GET STUDY + REPORT BY STUDY UID
// ======================================================
router.get("/api/study-report/:uid", async (req, res) => {
  try {
    const data = await reportService.getStudyReportByUid(req, req.params.uid);
    res.json(data);
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error("Study-Report fetch error:", err);
    res.status(500).json({ error: "Failed to fetch study and report data" });
  }
});

// ======================================================
// GET STUDY DETAILS BY UID (PACS Proxy)
// ======================================================
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

    let modality = "",
      bodyPart = "";
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
      History: "",
      Findings: "",
      Conclusion: "",
    });
  } catch (err) {
    console.error("Fetch study error:", err.message);
    res.status(500).json({ error: "Failed to load study" });
  }
});

// ======================================================
// GET ALL REPORTS
// ======================================================
router.get("/api/reports", async (req, res) => {
  try {
    const reports = await reportService.getAllReports(req);
    res.json(reports);
  } catch (err) {
    console.error("Fetch reports error:", err.message);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

// ======================================================
// SAVE REPORT HANDLER
// ======================================================
const saveReportHandler = async (req, res) => {
  try {
    const reportId = await reportService.saveReport(req);
    res.json({ success: true, reportId });
  } catch (err) {
    if (err.statusCode === 403) {
      return res.status(403).json({ error: err.message });
    }
    console.error("Save report error:", err);
    res.status(500).json({ error: "Failed to save report" });
  }
};

router.post("/api/reports/save", saveReportHandler);
router.post("/api/reports", saveReportHandler);

// ======================================================
// GET REPORT BY STUDY UID
// ======================================================
router.get("/api/reports/by-study/:uid", async (req, res) => {
  try {
    const reportData = await reportService.getReportByStudyUid(req, req.params.uid);
    res.json(reportData);
  } catch (err) {
    console.error("Fetch report error:", err.message);
    res.status(500).json({ error: "Failed to load report" });
  }
});

// ======================================================
// SAVE ADDENDUM REASON
// ======================================================
router.post("/api/addendum/save-reason", async (req, res) => {
  try {
    const id = await reportService.saveAddendumReason(req);
    res.json({ success: true, id });
  } catch (err) {
    if (err.statusCode === 400 || err.statusCode === 403) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error("Save addendum reason error:", err);
    res.status(500).json({ success: false });
  }
});

// ======================================================
// GET PDF BY REPORT ID
// ======================================================
router.get("/api/reports/:id/pdf", async (req, res) => {
  try {
    const pdfPath = await reportService.generateReportPdf(req, req.params.id, false);
    res.contentType("application/pdf");
    res.sendFile(path.resolve(pdfPath));
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error("PDF Route Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ======================================================
// GET PDF BY STUDY UID
// ======================================================
router.get("/api/reports/study/:studyUid/pdf", async (req, res) => {
  try {
    const pdfPath = await reportService.generateStudyReportPdf(req, req.params.studyUid, req.query.type);
    res.contentType("application/pdf").sendFile(path.resolve(pdfPath));
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error("Study PDF Route Error:", err);
    res.status(500).send("Error generating PDF");
  }
});

// ======================================================
// PRINT PDF
// ======================================================
router.get("/api/reports/:id/pdf/print", async (req, res) => {
  try {
    const pdfPath = await reportService.generateReportPdf(req, req.params.id, true);
    res.contentType("application/pdf").sendFile(path.resolve(pdfPath));
  } catch (err) {
    if (err.statusCode === 404) {
      return res.status(404).json({ error: err.message });
    }
    console.error("Print PDF error:", err);
    res.status(500).send("Error generating PDF");
  }
});

// ======================================================
// DELETE REPORT
// ======================================================
router.delete("/api/reports/:id", async (req, res) => {
  try {
    await reportService.deleteReport(req, req.params.id);
    res.json({ success: true, message: "Report deleted successfully" });
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 403) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error("Delete report error:", err.message);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

// ======================================================
// SAVE KEY IMAGES FOR STUDY / REPORT
// ======================================================
router.post("/api/studies/:studyId/key-images", async (req, res) => {
  try {
    const studyId = req.params.studyId;
    const keyImages = req.body.keyImages || req.body.images || req.body.snapshots || [];
    const savedImages = await reportService.saveKeyImagesForStudy(req, studyId, keyImages);
    res.json({ success: true, count: savedImages.length, data: savedImages });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.message });
    }
    console.error("Save study key images error:", err);
    res.status(500).json({ success: false, error: "Failed to save key images for study" });
  }
});

router.post("/api/v1/reports/:id/key-images", async (req, res) => {
  try {
    const reportId = req.params.id;
    const report = await reportService.findReportForPdf(req, reportId);
    if (!report) {
      return res.status(404).json({ success: false, error: "Report not found" });
    }
    const keyImages = req.body.keyImages || req.body.images || req.body.snapshots || [];
    const savedImages = await reportService.saveKeyImagesForStudy(req, report.study_uid, keyImages);
    res.json({ success: true, count: savedImages.length, data: savedImages });
  } catch (err) {
    console.error("Save report key images error:", err);
    res.status(500).json({ success: false, error: "Failed to save key images for report" });
  }
});

// GET PRIOR STUDIES FOR PATIENT
router.get("/api/reports/priors/:patientId", async (req, res) => {
  try {
    const priors = await reportService.getPatientPriorStudies(req.params.patientId, req.query.currentUid);
    res.json({ success: true, priors });
  } catch (err) {
    console.error("Fetch prior studies error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch prior studies" });
  }
});

// ======================================================
// CONCURRENT REPORTING SESSION LOCK ENDPOINTS
// ======================================================
const reportingLockManager = require("../utils/reportingLockManager");

router.post("/api/reports/session/lock", (req, res) => {
  try {
    const { studyUID } = req.body;
    const user = req.user || { id: req.body.userId || 'user_1', name: req.body.doctorName || 'Radiologist' };
    const lockResult = reportingLockManager.acquireLock(studyUID, user);
    res.json(lockResult);
  } catch (err) {
    console.error("Acquire reporting lock error:", err);
    res.status(500).json({ success: false, isLocked: false, error: "Lock failed" });
  }
});

router.post("/api/reports/session/heartbeat", (req, res) => {
  try {
    const { studyUID } = req.body;
    const userId = req.user?.id || req.body.userId || 'user_1';
    const ok = reportingLockManager.heartbeat(studyUID, userId);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.post("/api/reports/session/unlock", (req, res) => {
  try {
    const { studyUID } = req.body;
    const userId = req.user?.id || req.body.userId || 'user_1';
    const ok = reportingLockManager.releaseLock(studyUID, userId);
    res.json({ success: ok });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.get("/api/reports/session/active-locks", (req, res) => {
  try {
    const locks = reportingLockManager.getActiveLocks();
    res.json({ success: true, locks });
  } catch (err) {
    res.status(500).json({ success: false, locks: {} });
  }
});

module.exports = router;

