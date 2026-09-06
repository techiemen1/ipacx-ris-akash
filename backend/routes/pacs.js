require("dotenv").config();
const express = require("express");
const router = express.Router();
const axios = require("axios");
const net = require("net");
const multer = require("multer");
const AdmZip = require("adm-zip");
const pool = require("../db");
const { logAction } = require("../utils/auditLogger");
const asyncHandler = require("../middleware/asyncHandler");
const PacsService = require("../services/pacsService");

const pacsService = new PacsService(pool);

/* ======================================================
   ORTHANC CONFIG
====================================================== */
const ORTHANC_URL = (process.env.ORTHANC_URL || "http://localhost:8042/").replace(/\/?$/, "/");
const ORTHANC_USER = process.env.ORTHANC_USER || "orthanc";
const ORTHANC_PASS = process.env.ORTHANC_PASS || "orthanc";

function orthancAuthConfig() {
  return { auth: { username: ORTHANC_USER || "orthanc", password: ORTHANC_PASS || "orthanc" } };
}

function extractAgeFromName(name) {
  if (!name) return "N/A";
  const clean = String(name);
  const yearMatch = clean.match(/(\d{1,3})\s*\^?\s*Y\b/i);
  if (yearMatch) return yearMatch[1];
  const monthMatch = clean.match(/(\d{1,2})\s*\^?\s*(MONTH|M)\b/i);
  if (monthMatch) return `${monthMatch[1]} Months`;
  return "N/A";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max file size
    fieldSize: 1024 * 1024 * 1024, // 1GB max field size
    files: 2000 // Up to 2000 files in a single folder upload
  }
});

/* ======================================================
   UPLOAD LOCAL DICOM FILES / ZIP ARCHIVES / FOLDERS (1GB payload)
====================================================== */
router.post("/upload", upload.any(), asyncHandler(async (req, res) => {
  console.log(`[PACS Upload] Processing upload request with ${req.files ? req.files.length : 0} files...`);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: "No DICOM files or ZIP archives received in upload payload" });
  }

  const cacheService = require("../services/cacheService");
  const uploadedResults = [];

  const processSingleBuffer = async (filename, buffer) => {
    if (!buffer || buffer.length === 0) return;
    try {
      const orthancRes = await axios.post(`${ORTHANC_URL}instances`, buffer, {
        headers: { "Content-Type": "application/dicom" },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000, // 10 minutes timeout per file
        ...orthancAuthConfig(),
      });
      uploadedResults.push({ filename, status: "Success", id: orthancRes.data?.ID });
    } catch (err) {
      console.error(`[PACS Upload] Failed to upload ${filename} to Orthanc:`, err.response?.data || err.message);
      uploadedResults.push({ filename, status: "Failed", error: err.response?.data?.Message || err.message });
    }
  };

  for (const file of req.files) {
    const isZip = file.originalname.toLowerCase().endsWith(".zip") ||
                  file.mimetype === "application/zip" ||
                  file.mimetype === "application/x-zip-compressed";

    if (isZip) {
      console.log(`[PACS Upload] Extracting ZIP archive: ${file.originalname}`);
      try {
        const zip = new AdmZip(file.buffer);
        const zipEntries = zip.getEntries();
        for (const entry of zipEntries) {
          if (!entry.isDirectory) {
            const entryBuffer = entry.getData();
            if (entryBuffer && entryBuffer.length > 128) {
              await processSingleBuffer(entry.entryName, entryBuffer);
            }
          }
        }
      } catch (zipErr) {
        console.error(`[PACS Upload] ZIP extraction error for ${file.originalname}:`, zipErr.message);
        uploadedResults.push({ filename: file.originalname, status: "Failed", error: `ZIP extraction error: ${zipErr.message}` });
      }
    } else {
      await processSingleBuffer(file.originalname, file.buffer);
    }
  }

  await cacheService.del("pacs:*");

  const successCount = uploadedResults.filter(r => r.status === "Success").length;
  console.log(`[PACS Upload] Ingestion complete. ${successCount}/${uploadedResults.length} instances ingested to Orthanc.`);

  res.json({
    success: true,
    message: `Successfully uploaded ${successCount} of ${uploadedResults.length} DICOM instances to Orthanc PACS`,
    data: uploadedResults
  });
}));

/* ======================================================
   GET ALL PACS
====================================================== */
router.get("/", asyncHandler(async (req, res) => {
  const pacs = await pacsService.list();
  const sanitized = (pacs || []).map((item) => ({
    ...item,
    password: item.password ? "********" : "",
  }));
  res.json(sanitized);
}));

/* ======================================================
   ADD / UPDATE PACS
====================================================== */
router.post("/", asyncHandler(async (req, res) => {
  const { id, pacs_name, pacs_type, ae_title, ip_address, port, username, password } = req.body;

  const saved = await pacsService.save({
    id,
    pacs_name,
    pacs_type,
    ae_title,
    ip_address,
    port,
    username,
    password,
  });

  await logAction(req, {
    event: id ? "UPDATE_PACS" : "CREATE_PACS",
    page: "PACS_SETTINGS",
    details: { pacs_id: saved.id, pacs_name, ip_address, port }
  });

  res.json(saved);
}));

/* ======================================================
   DELETE PACS
====================================================== */
router.delete("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  await pacsService.delete(id);
  await logAction(req, {
    event: "DELETE_PACS",
    page: "PACS_SETTINGS",
    details: { pacs_id: id }
  });
  res.json({ success: true, message: "PACS configuration removed" });
}));

/* ======================================================
   GET ACTIVE PACS LOGS / METRICS
====================================================== */
router.get("/logs", asyncHandler(async (req, res) => {
  const activePacs = await pacsService.repository.findActive();
  res.json({
    activeNodeCount: activePacs.length,
    activeNodes: activePacs.map(p => ({
      id: p.id,
      name: p.pacs_name,
      type: p.pacs_type,
      ip: p.ip_address,
      port: p.port,
    })),
    timestamp: new Date().toISOString(),
  });
}));

/* ======================================================
   GET STUDIES (ACTIVE PACS)
====================================================== */
router.get("/studies", asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const studies = await pacsService.listActiveStudies({ startDate, endDate });
  res.json(studies);
}));

/* ======================================================
   GET INDIVIDUAL STUDY DETAIL (TRUE DICOM MODALITY & BODY PART)
====================================================== */
router.get("/study/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;

    const findRes = await axios.post(`${ORTHANC_URL}tools/find`, {
      Level: "Study",
      Query: { StudyInstanceUID: studyUID }
    }, orthancAuthConfig()).catch(() => ({ data: [] }));

    let orthancData = null;
    let modality = "CR";
    let bodyPart = "";

    if (findRes.data && findRes.data.length > 0) {
      const orthancId = findRes.data[0];
      const { data } = await axios.get(`${ORTHANC_URL}studies/${orthancId}`, orthancAuthConfig());
      orthancData = data;

      if (Array.isArray(data.Series) && data.Series.length > 0) {
        try {
          const seriesRes = await axios.get(`${ORTHANC_URL}series/${data.Series[0]}`, orthancAuthConfig());
          if (seriesRes.data?.MainDicomTags) {
            modality = seriesRes.data.MainDicomTags.Modality || modality;
            bodyPart = seriesRes.data.MainDicomTags.BodyPartExamined || bodyPart;
          }
        } catch (e) {}
      }
    }

    const dbRes = await pool.query("SELECT * FROM studies WHERE study_uid = $1", [studyUID]).catch(() => ({ rows: [] }));
    const dbRow = dbRes.rows[0] || {};

    const rawMod = modality || dbRow.modality || dbRow.Modality || "CR";
    const normMod = String(rawMod).toUpperCase().trim();

    const result = {
      PatientID: orthancData?.PatientMainDicomTags?.PatientID || dbRow.patient_id || "N/A",
      PatientName: orthancData?.PatientMainDicomTags?.PatientName || dbRow.patient_name || "N/A",
      PatientSex: orthancData?.PatientMainDicomTags?.PatientSex || dbRow.patient_sex || "O",
      PatientAge: extractAgeFromName(orthancData?.PatientMainDicomTags?.PatientName || dbRow.patient_name),
      AccessionNumber: orthancData?.MainDicomTags?.AccessionNumber || dbRow.accession_number || "N/A",
      StudyDescription: orthancData?.MainDicomTags?.StudyDescription || dbRow.study_description || "",
      StudyDate: orthancData?.MainDicomTags?.StudyDate || dbRow.study_date || "",
      StudyTime: orthancData?.MainDicomTags?.StudyTime || dbRow.study_time || "",
      Modality: normMod,
      StudyInstanceUID: studyUID,
      ReferringPhysicianName: orthancData?.MainDicomTags?.ReferringPhysicianName || dbRow.referring_physician || "",
      BodyPartExamined: bodyPart || dbRow.body_part || "",
    };

    res.json(result);
  } catch (err) {
    console.error("Fetch study detail failed:", err.message);
    res.status(500).json({ error: "Failed to fetch study details" });
  }
});

/* ======================================================
   PROXY INSTANCE PREVIEW IMAGE (SAFE AUTHENTICATED PREVIEW)
====================================================== */
router.get("/instance-preview/:instanceId", asyncHandler(async (req, res) => {
  const { instanceId } = req.params;
  try {
    const previewStream = await axios.get(`${ORTHANC_URL}instances/${instanceId}/preview`, {
      responseType: "stream",
      ...orthancAuthConfig(),
    });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    previewStream.data.pipe(res);
  } catch (err) {
    console.error(`[PACS Proxy] Failed fetching instance preview ${instanceId}:`, err.message);
    res.status(404).send("Preview unavailable");
  }
}));

/* ======================================================
   PACS KEY IMAGES (TARGET SINGLE KEY IMAGE CAPTURE)
====================================================== */
router.get("/snapshots/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const findRes = await axios.post(`${ORTHANC_URL}tools/find`, {
      Level: "Study",
      Query: { StudyInstanceUID: studyUID }
    }, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: [] }));

    if (!findRes.data || !findRes.data.length) {
      return res.json({ success: true, data: [] });
    }

    const orthancId = findRes.data[0];
    const { data: studyData } = await axios.get(`${ORTHANC_URL}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: null }));

    if (!studyData || !Array.isArray(studyData.Series) || studyData.Series.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Pick first series and its middle instance for fast 1-click capture
    const firstSeriesId = studyData.Series[0];
    const { data: seriesData } = await axios.get(`${ORTHANC_URL}series/${firstSeriesId}`, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: null }));

    const snapshots = [];
    if (seriesData && Array.isArray(seriesData.Instances) && seriesData.Instances.length > 0) {
      const midIndex = Math.floor(seriesData.Instances.length / 2);
      const instanceId = seriesData.Instances[midIndex] || seriesData.Instances[0];
      const seriesDesc = seriesData.MainDicomTags?.SeriesDescription || "Key Diagnostic Frame";

      snapshots.push({
        instance_id: instanceId,
        preview_url: `/api/pacs/instance-preview/${instanceId}`,
        caption: `${seriesDesc}`
      });
    }

    res.json({ success: true, data: snapshots });
  } catch (err) {
    console.error("Snapshots fetch failed:", err.message);
    res.json({ success: true, data: [] });
  }
});

/* ======================================================
   PACS DICOM STUDY SERIES & FULL ORDERED SLICES ROUTE
====================================================== */
router.get("/study-series-instances/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const findRes = await axios.post(`${ORTHANC_URL}tools/find`, {
      Level: "Study",
      Query: { StudyInstanceUID: studyUID }
    }, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: [] }));

    if (!findRes.data || !findRes.data.length) {
      return res.json({ success: true, series: [] });
    }

    const orthancId = findRes.data[0];
    const { data: studyData } = await axios.get(`${ORTHANC_URL}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));

    if (!studyData || !Array.isArray(studyData.Series)) {
      return res.json({ success: true, series: [] });
    }

    const seriesPromises = studyData.Series.map((seriesId, idx) =>
      axios.get(`${ORTHANC_URL}series/${seriesId}`, { ...orthancAuthConfig(), timeout: 4000 })
        .then(r => ({ ...r.data, idx }))
        .catch(() => null)
    );

    const seriesResults = await Promise.all(seriesPromises);
    const seriesList = [];

    for (const sData of seriesResults) {
      if (sData && Array.isArray(sData.Instances)) {
        const seriesDesc = sData.MainDicomTags?.SeriesDescription || `Series ${sData.idx + 1}`;
        const seriesNum = sData.MainDicomTags?.SeriesNumber || (sData.idx + 1);

        // Fetch simplified tags in parallel for all instances to sort by exact DICOM InstanceNumber
        const instTagPromises = sData.Instances.map(instId =>
          axios.get(`${ORTHANC_URL}instances/${instId}/simplified-tags`, { ...orthancAuthConfig(), timeout: 3000 })
            .then(r => ({
              instance_id: instId,
              instance_number: parseInt(r.data?.InstanceNumber || 0, 10)
            }))
            .catch(() => ({ instance_id: instId, instance_number: 0 }))
        );

        const instTags = await Promise.all(instTagPromises);
        instTags.sort((a, b) => a.instance_number - b.instance_number);

        seriesList.push({
          series_id: sData.ID,
          series_description: seriesDesc,
          series_number: seriesNum,
          total_slices: instTags.length,
          instances: instTags.map((item, sliceIdx) => ({
            instance_id: item.instance_id,
            slice_number: item.instance_number || (sliceIdx + 1),
            preview_url: `/api/pacs/instance-preview/${item.instance_id}`,
            caption: `${seriesDesc} (Slice ${item.instance_number || (sliceIdx + 1)}/${instTags.length})`
          }))
        });
      }
    }

    seriesList.sort((a, b) => {
      const numA = parseInt(a.series_number, 10) || 0;
      const numB = parseInt(b.series_number, 10) || 0;
      return numA - numB;
    });

    res.json({ success: true, series: seriesList });
  } catch (err) {
    console.error("Failed to fetch study series instances:", err.message);
    res.json({ success: true, series: [] });
  }
});

/* ======================================================
   EXPORT STUDY: DICOM ARCHIVE (.zip / .dcm)
====================================================== */
router.get("/export/dicom/:studyUID", asyncHandler(async (req, res) => {
  const { studyUID } = req.params;
  console.log(`[PACS Export] Requesting DICOM archive for StudyUID: ${studyUID}`);

  const findRes = await axios.post(`${ORTHANC_URL}tools/find`, {
    Level: "Study",
    Query: { StudyInstanceUID: studyUID }
  }, orthancAuthConfig()).catch(() => ({ data: [] }));

  if (!findRes.data || !findRes.data.length) {
    return res.status(404).json({ success: false, message: "Study not found in PACS storage" });
  }

  const orthancId = findRes.data[0];
  const archiveUrl = `${ORTHANC_URL}studies/${orthancId}/archive`;

  try {
    const archiveStream = await axios.get(archiveUrl, {
      responseType: "stream",
      ...orthancAuthConfig(),
    });

    const safeFilename = `DICOM_Study_${studyUID.slice(-8)}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);

    archiveStream.data.pipe(res);
  } catch (err) {
    console.error("[PACS Export] DICOM archive fetch error:", err.message);
    res.status(500).json({ success: false, message: "Failed to generate DICOM archive from PACS" });
  }
}));

/* ======================================================
   EXPORT STUDY: JPEG / PNG IMAGES PACKAGE (.zip)
====================================================== */
router.get("/export/images/:format/:studyUID", asyncHandler(async (req, res) => {
  const { format, studyUID } = req.params; // format: 'jpeg' | 'png'
  const isPng = String(format).toLowerCase() === "png";
  const ext = isPng ? "png" : "jpg";
  const contentType = isPng ? "image/png" : "image/jpeg";

  console.log(`[PACS Export] Requesting ${format.toUpperCase()} image bundle for StudyUID: ${studyUID}`);

  const findRes = await axios.post(`${ORTHANC_URL}tools/find`, {
    Level: "Study",
    Query: { StudyInstanceUID: studyUID }
  }, orthancAuthConfig()).catch(() => ({ data: [] }));

  if (!findRes.data || !findRes.data.length) {
    return res.status(404).json({ success: false, message: "Study not found in PACS storage" });
  }

  const orthancId = findRes.data[0];
  const { data: studyData } = await axios.get(`${ORTHANC_URL}studies/${orthancId}`, orthancAuthConfig());

  const zip = new AdmZip();
  let imageCount = 0;

  if (Array.isArray(studyData.Series)) {
    for (let sIdx = 0; sIdx < studyData.Series.length; sIdx++) {
      const seriesId = studyData.Series[sIdx];
      const { data: seriesData } = await axios.get(`${ORTHANC_URL}series/${seriesId}`, orthancAuthConfig());
      const seriesDesc = (seriesData.MainDicomTags?.SeriesDescription || `Series_${sIdx + 1}`)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      if (Array.isArray(seriesData.Instances)) {
        for (let iIdx = 0; iIdx < seriesData.Instances.length; iIdx++) {
          const instanceId = seriesData.Instances[iIdx];
          try {
            const previewRes = await axios.get(`${ORTHANC_URL}instances/${instanceId}/preview`, {
              responseType: "arraybuffer",
              headers: { Accept: contentType },
              ...orthancAuthConfig(),
            });

            if (previewRes.data && previewRes.data.byteLength > 0) {
              const fileName = `${seriesDesc}_Image_${String(iIdx + 1).padStart(3, "0")}.${ext}`;
              zip.addFile(fileName, Buffer.from(previewRes.data));
              imageCount++;
            }
          } catch (imgErr) {
            console.error(`[PACS Export] Failed fetching preview for instance ${instanceId}:`, imgErr.message);
          }
        }
      }
    }
  }

  if (imageCount === 0) {
    return res.status(404).json({ success: false, message: "No medical preview images could be generated for this study" });
  }

  const zipBuffer = zip.toBuffer();
  const safeFilename = `${format.toUpperCase()}_Study_${studyUID.slice(-8)}.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  res.send(zipBuffer);
}));

/* ======================================================
   EXPORT SINGLE KEY IMAGE PREVIEW (.jpg)
====================================================== */
router.get("/export/single/:studyUID", asyncHandler(async (req, res) => {
  const { studyUID } = req.params;

  const findRes = await axios.post(`${ORTHANC_URL}tools/find`, {
    Level: "Study",
    Query: { StudyInstanceUID: studyUID }
  }, orthancAuthConfig()).catch(() => ({ data: [] }));

  if (!findRes.data || !findRes.data.length) {
    return res.status(404).json({ success: false, message: "Study not found in PACS storage" });
  }

  const orthancId = findRes.data[0];
  const { data: studyData } = await axios.get(`${ORTHANC_URL}studies/${orthancId}`, orthancAuthConfig());

  if (Array.isArray(studyData.Series) && studyData.Series.length > 0) {
    const seriesId = studyData.Series[0];
    const { data: seriesData } = await axios.get(`${ORTHANC_URL}series/${seriesId}`, orthancAuthConfig());
    if (Array.isArray(seriesData.Instances) && seriesData.Instances.length > 0) {
      const instanceId = seriesData.Instances[0];
      const previewStream = await axios.get(`${ORTHANC_URL}instances/${instanceId}/preview`, {
        responseType: "stream",
        ...orthancAuthConfig(),
      });

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Disposition", `attachment; filename="KeyImage_${studyUID.slice(-8)}.jpg"`);
      return previewStream.data.pipe(res);
    }
  }

  res.status(404).json({ success: false, message: "No key preview image found for study" });
}));

module.exports = router;
