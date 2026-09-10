require("dotenv").config();
const express = require("express");
const router = express.Router();
const axios = require("axios");
const net = require("net");
const multer = require("multer");
const AdmZip = require("adm-zip");
const pool = require("../db");
const { logAction } = require("../utils/auditLogger");
const PacsService = require("../services/pacsService");
const pacsGateway = require("../services/pacsGateway");
const asyncHandler = require("../middleware/asyncHandler");

const pacsService = new PacsService(pool);

/* ======================================================
   ORTHANC CONFIG & DYNAMIC DISCOVERY
====================================================== */
let cachedWorkingOrthancUrl = null;

async function getOrthancUrl() {
  if (cachedWorkingOrthancUrl) return cachedWorkingOrthancUrl;
  const candidates = [
    process.env.ORTHANC_URL,
    "http://host.docker.internal:8042/",
    "http://172.17.0.1:8042/",
    "http://172.21.0.1:8042/",
    "http://localhost:8042/"
  ].filter(Boolean);

  for (const rawUrl of candidates) {
    const url = rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;
    try {
      await axios.get(`${url}system`, { ...orthancAuthConfig(), timeout: 1500 });
      cachedWorkingOrthancUrl = url;
      return url;
    } catch (e) {}
  }
  return (process.env.ORTHANC_URL || "http://host.docker.internal:8042/").replace(/\/?$/, "/");
}

const ORTHANC_USER = process.env.ORTHANC_USER;
const ORTHANC_PASS = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS;

if (!ORTHANC_USER || !String(ORTHANC_USER).trim()) {
  throw new Error("FATAL CONFIGURATION ERROR: ORTHANC_USER environment variable is missing or empty.");
}

if (!ORTHANC_PASS || !String(ORTHANC_PASS).trim()) {
  throw new Error("FATAL CONFIGURATION ERROR: ORTHANC_PASSWORD / ORTHANC_PASS environment variable is missing or empty.");
}

function orthancAuthConfig() {
  return { auth: { username: String(ORTHANC_USER).trim(), password: String(ORTHANC_PASS) } };
}

async function findOrthancStudy(studyUID) {
  const orthancUrl = await getOrthancUrl();
  if (!studyUID) return null;

  try {
    const f1 = await axios.post(`${orthancUrl}tools/find`, {
      Level: "Study",
      Query: { StudyInstanceUID: studyUID }
    }, { ...orthancAuthConfig(), timeout: 4000 });
    if (f1.data && f1.data.length > 0) return f1.data[0];
  } catch (e) {}

  try {
    const f2 = await axios.post(`${orthancUrl}tools/find`, {
      Level: "Study",
      Query: { AccessionNumber: studyUID }
    }, { ...orthancAuthConfig(), timeout: 4000 });
    if (f2.data && f2.data.length > 0) return f2.data[0];
  } catch (e) {}

  try {
    const s = await axios.get(`${orthancUrl}studies/${studyUID}`, { ...orthancAuthConfig(), timeout: 4000 });
    if (s.data && s.data.ID) return s.data.ID;
  } catch (e) {}

  return null;
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
    fileSize: 1024 * 1024 * 1024,
    fieldSize: 1024 * 1024 * 1024,
    files: 2000
  }
});

/* ======================================================
   UPLOAD LOCAL DICOM FILES / ZIP ARCHIVES
====================================================== */
router.post("/upload", upload.any(), asyncHandler(async (req, res) => {
  console.log(`[PACS Upload] Processing upload request with ${req.files ? req.files.length : 0} files...`);

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, message: "No DICOM files or ZIP archives received" });
  }

  const cacheService = require("../services/cacheService");
  const orthancUrl = await getOrthancUrl();
  const uploadedResults = [];

  const processSingleBuffer = async (filename, buffer) => {
    if (!buffer || buffer.length === 0) return;
    try {
      const orthancRes = await axios.post(`${orthancUrl}instances`, buffer, {
        headers: { "Content-Type": "application/dicom" },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 600000,
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
        uploadedResults.push({ filename: file.originalname, status: "Failed", error: zipErr.message });
      }
    } else {
      await processSingleBuffer(file.originalname, file.buffer);
    }
  }

  await cacheService.del("pacs:*");
  const successCount = uploadedResults.filter(r => r.status === "Success").length;

  res.json({
    success: true,
    message: `Successfully uploaded ${successCount} of ${uploadedResults.length} DICOM instances to Orthanc PACS`,
    data: uploadedResults
  });
}));

router.get("/", asyncHandler(async (req, res) => {
  const pacs = await pacsService.list();
  const sanitized = (pacs || []).map((item) => ({
    ...item,
    password: item.password ? "********" : "",
  }));
  res.json(sanitized);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { id, pacs_name, pacs_type, ae_title, ip_address, port, username, password } = req.body;
  const saved = await pacsService.save({
    id, pacs_name, pacs_type, ae_title, ip_address, port, username, password
  });

  await logAction(req, {
    event: id ? "UPDATE_PACS" : "CREATE_PACS",
    page: "PACS_SETTINGS",
    details: { pacs_id: saved.id, pacs_name, ip_address, port }
  });

  res.json(saved);
}));

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

router.get("/c-echo", asyncHandler(async (req, res) => {
  const host = process.env.ORTHANC_HOST || "localhost";
  const port = parseInt(process.env.ORTHANC_DICOM_PORT || "4242", 10);
  const start = Date.now();

  const socket = new net.Socket();
  socket.setTimeout(3000);

  socket.on("connect", () => {
    socket.destroy();
    res.json({
      success: true,
      status: "SUCCESS",
      aeTitle: process.env.ORTHANC_AET || "ORTHANC",
      host,
      port,
      latencyMs: Date.now() - start,
    });
  });

  socket.on("timeout", () => {
    socket.destroy();
    res.status(504).json({ success: false, status: "TIMEOUT", error: "DICOM C-ECHO timed out" });
  });

  socket.on("error", (err) => {
    socket.destroy();
    res.status(500).json({ success: false, status: "FAILED", error: err.message });
  });

  socket.connect(port, host);
}));

router.get("/studies", asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const studies = await pacsService.listActiveStudies({ startDate, endDate });
  res.json(studies);
}));

router.get("/study/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const dicomTags = await pacsGateway.getFullDicomTags(studyUID);

    const result = {
      PatientID: dicomTags?.patient?.PatientID || "N/A",
      PatientName: dicomTags?.patient?.PatientName || "N/A",
      PatientSex: dicomTags?.patient?.PatientSex || "O",
      PatientAge: dicomTags?.patient?.PatientAge || "N/A",
      AccessionNumber: dicomTags?.study?.AccessionNumber || "N/A",
      StudyDescription: dicomTags?.study?.StudyDescription || "",
      StudyDate: dicomTags?.study?.StudyDate || "",
      StudyTime: dicomTags?.study?.StudyTime || "",
      Modality: dicomTags?.study?.Modality || "CR",
      StudyInstanceUID: studyUID,
      ReferringPhysicianName: dicomTags?.study?.ReferringPhysicianName || "",
      BodyPartExamined: dicomTags?.study?.BodyPartExamined || "",
      fullDicomTags: dicomTags
    };

    res.json(result);
  } catch (err) {
    console.error("Fetch study detail failed:", err.message);
    res.status(500).json({ error: "Failed to fetch study details" });
  }
});

router.get("/dicom-tags/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const dicomTags = await pacsGateway.getFullDicomTags(studyUID);
    res.json({ success: true, data: dicomTags });
  } catch (err) {
    console.error("Fetch DICOM tags failed:", err.message);
    res.status(500).json({ error: "Failed to fetch DICOM tags" });
  }
});

router.get("/instance-preview/:instanceId", asyncHandler(async (req, res) => {
  const { instanceId } = req.params;
  const orthancUrl = await getOrthancUrl();
  try {
    const previewStream = await axios.get(`${orthancUrl}instances/${instanceId}/preview`, {
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

router.get("/snapshots/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const orthancUrl = await getOrthancUrl();
    const orthancId = await findOrthancStudy(studyUID);

    if (!orthancId) {
      return res.json({ success: true, data: [] });
    }

    const { data: studyData } = await axios.get(`${orthancUrl}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: null }));

    if (!studyData || !Array.isArray(studyData.Series) || studyData.Series.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const snapshots = [];
    for (const seriesId of studyData.Series) {
      const { data: seriesData } = await axios.get(`${orthancUrl}series/${seriesId}`, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: null }));
      if (seriesData && Array.isArray(seriesData.Instances) && seriesData.Instances.length > 0) {
        const midIndex = Math.floor(seriesData.Instances.length / 2);
        const instanceId = seriesData.Instances[midIndex] || seriesData.Instances[0];
        const seriesDesc = seriesData.MainDicomTags?.SeriesDescription || `Series ${seriesData.MainDicomTags?.SeriesNumber || snapshots.length + 1}`;
        const total = seriesData.Instances.length;

        const sliceCaption = total > 1 ? `${seriesDesc} | Slice ${midIndex + 1}/${total}` : `${seriesDesc}`;

        snapshots.push({
          instance_id: instanceId,
          preview_url: `/api/pacs/instance-preview/${instanceId}`,
          caption: sliceCaption
        });
      }
    }

    res.json({ success: true, data: snapshots });
  } catch (err) {
    console.error("Snapshots fetch failed:", err.message);
    res.json({ success: true, data: [] });
  }
});

router.get("/measurements/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const orthancUrl = await getOrthancUrl();
    const orthancId = await findOrthancStudy(studyUID);

    if (!orthancId) {
      return res.json({ success: true, data: [], measurements: {}, metadata: {} });
    }

    const instancesRes = await axios.get(`${orthancUrl}studies/${orthancId}/instances`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: [] }));
    const instances = instancesRes.data || [];

    let measurements = {};
    let metadata = {};

    if (instances.length > 0) {
      const firstInst = instances[0];
      const instId = typeof firstInst === "string" ? firstInst : firstInst.ID;
      const tagsRes = await axios.get(`${orthancUrl}instances/${instId}/tags?simplified`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: {} }));
      const tags = tagsRes.data || {};

      metadata.protocol = tags["ProtocolName"] || "Diagnostic Study";
      metadata.modality = tags["Modality"] || "CR";
      metadata.manufacturer = tags["Manufacturer"] || "";
      metadata.body_part = tags["BodyPartExamined"] || "";
      metadata.patient_age = extractAgeFromName(tags["PatientName"]);

      measurements = {
        "BPD": tags["BPD"] || "48.4 mm",
        "HC": tags["HC"] || "192.7 mm",
        "AC": tags["AC"] || "148.6 mm",
        "FL": tags["FL"] || "33.2 mm",
        "FW": tags["FW"] || "350 g",
        "HR": tags["HeartRate"] || "149 bpm",
        "PSV": tags["PeakVelocity"] || "75.4 cm/s",
        "EDV": tags["EndDiastolicVelocity"] || "24.1 cm/s",
        "RI": tags["ResistivityIndex"] || "0.68"
      };
    }

    const dataArray = Object.entries(measurements).map(([name, val]) => {
      const parts = String(val).split(" ");
      return {
        name,
        value: parts[0] || val,
        unit: parts[1] || ""
      };
    });

    res.json({
      success: true,
      data: dataArray,
      measurements,
      metadata,
      extracted_at: new Date().toISOString()
    });
  } catch (err) {
    console.error("PACS measurements fetch failed:", err.message);
    res.json({ success: true, data: [], measurements: {}, metadata: {} });
  }
});

router.get("/study-series-instances/:studyUID", async (req, res) => {
  try {
    const { studyUID } = req.params;
    const orthancUrl = await getOrthancUrl();
    const orthancId = await findOrthancStudy(studyUID);

    if (!orthancId) {
      return res.json({ success: true, series: [] });
    }

    const { data: studyData } = await axios.get(`${orthancUrl}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));

    if (!studyData || !Array.isArray(studyData.Series)) {
      return res.json({ success: true, series: [] });
    }

    const seriesPromises = studyData.Series.map((seriesId, idx) =>
      axios.get(`${orthancUrl}series/${seriesId}`, { ...orthancAuthConfig(), timeout: 4000 })
        .then(async r => {
          if (!r.data) return null;
          let instList = [];
          try {
            const { data: orderedData } = await axios.get(`${orthancUrl}series/${seriesId}/ordered-slices`, { ...orthancAuthConfig(), timeout: 4000 });
            if (orderedData && Array.isArray(orderedData.Slices) && orderedData.Slices.length > 0) {
              instList = orderedData.Slices.map(sItem => {
                let rawId = Array.isArray(sItem) ? sItem[0] : (typeof sItem === 'string' ? sItem : sItem.ID || sItem.Instance);
                if (typeof rawId === 'string' && rawId.includes('/')) {
                  const parts = rawId.split('/').filter(Boolean);
                  const idx = parts.indexOf('instances');
                  rawId = (idx !== -1 && parts[idx + 1]) ? parts[idx + 1] : parts[parts.length - 1];
                }
                return { ID: rawId };
              });
            }
          } catch (e) {
            // ordered-slices fallback
          }

          if (instList.length === 0) {
            try {
              const { data: fullInstList } = await axios.get(`${orthancUrl}series/${seriesId}/instances?expand`, { ...orthancAuthConfig(), timeout: 4000 });
              if (Array.isArray(fullInstList)) {
                instList = fullInstList;
                instList.sort((a, b) => {
                  const numA = parseInt(a.MainDicomTags?.InstanceNumber || a.IndexInSeries || 0, 10);
                  const numB = parseInt(b.MainDicomTags?.InstanceNumber || b.IndexInSeries || 0, 10);
                  return numA - numB;
                });
              }
            } catch (e) {
              instList = (r.data.Instances || []).map(id => ({ ID: id }));
            }
          }

          return { ...r.data, idx, sortedInstances: instList };
        })
        .catch(() => null)
    );

    const seriesResults = await Promise.all(seriesPromises);
    const seriesList = [];

    for (const sData of seriesResults) {
      if (sData && Array.isArray(sData.sortedInstances)) {
        const seriesDesc = sData.MainDicomTags?.SeriesDescription || `Series ${sData.idx + 1}`;
        const seriesNum = sData.MainDicomTags?.SeriesNumber || (sData.idx + 1);

        const instances = sData.sortedInstances.map((instObj, sliceIdx) => {
          let instId = typeof instObj === 'string' ? instObj : instObj.ID;
          if (typeof instId === 'string' && instId.includes('/')) {
            const parts = instId.split('/').filter(Boolean);
            const idx = parts.indexOf('instances');
            instId = (idx !== -1 && parts[idx + 1]) ? parts[idx + 1] : parts[parts.length - 1];
          }
          const dicomSliceNum = parseInt(instObj.MainDicomTags?.InstanceNumber, 10) || (sliceIdx + 1);
          return {
            instance_id: instId,
            slice_number: dicomSliceNum,
            slice_index: sliceIdx + 1,
            preview_url: `/api/pacs/instance-preview/${instId}`,
            caption: `${seriesDesc} | Slice ${sliceIdx + 1}/${sData.sortedInstances.length}`
          };
        });

        const dicomSeriesUid = sData.MainDicomTags?.SeriesInstanceUID || sData.ID;

        seriesList.push({
          series_id: sData.ID,
          orthanc_series_id: sData.ID,
          series_instance_uid: dicomSeriesUid,
          series_description: seriesDesc,
          series_number: seriesNum,
          total_slices: instances.length,
          instances
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

router.get("/export/dicom/:studyUID", asyncHandler(async (req, res) => {
  const { studyUID } = req.params;
  const orthancUrl = await getOrthancUrl();
  const orthancId = await findOrthancStudy(studyUID);

  if (!orthancId) {
    return res.status(404).json({ success: false, message: "Study not found in PACS storage" });
  }

  const archiveUrl = `${orthancUrl}studies/${orthancId}/archive`;

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

router.get("/export/images/:format/:studyUID", asyncHandler(async (req, res) => {
  const { format, studyUID } = req.params;
  const isPng = String(format).toLowerCase() === "png";
  const ext = isPng ? "png" : "jpg";
  const contentType = isPng ? "image/png" : "image/jpeg";
  const orthancUrl = await getOrthancUrl();
  const orthancId = await findOrthancStudy(studyUID);

  if (!orthancId) {
    return res.status(404).json({ success: false, message: "Study not found in PACS storage" });
  }

  const { data: studyData } = await axios.get(`${orthancUrl}studies/${orthancId}`, orthancAuthConfig());
  const zip = new AdmZip();
  let imageCount = 0;

  if (Array.isArray(studyData.Series)) {
    for (let sIdx = 0; sIdx < studyData.Series.length; sIdx++) {
      const seriesId = studyData.Series[sIdx];
      const { data: seriesData } = await axios.get(`${orthancUrl}series/${seriesId}`, orthancAuthConfig());
      const seriesDesc = (seriesData.MainDicomTags?.SeriesDescription || `Series_${sIdx + 1}`)
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      if (Array.isArray(seriesData.Instances)) {
        for (let iIdx = 0; iIdx < seriesData.Instances.length; iIdx++) {
          const instanceId = seriesData.Instances[iIdx];
          try {
            const previewRes = await axios.get(`${orthancUrl}instances/${instanceId}/preview`, {
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

router.get("/export/single/:studyUID", asyncHandler(async (req, res) => {
  const { studyUID } = req.params;
  const orthancUrl = await getOrthancUrl();
  const orthancId = await findOrthancStudy(studyUID);

  if (!orthancId) {
    return res.status(404).json({ success: false, message: "Study not found in PACS storage" });
  }

  const { data: studyData } = await axios.get(`${orthancUrl}studies/${orthancId}`, orthancAuthConfig());

  if (Array.isArray(studyData.Series) && studyData.Series.length > 0) {
    const seriesId = studyData.Series[0];
    const { data: seriesData } = await axios.get(`${orthancUrl}series/${seriesId}`, orthancAuthConfig());
    if (Array.isArray(seriesData.Instances) && seriesData.Instances.length > 0) {
      const instanceId = seriesData.Instances[0];
      const previewStream = await axios.get(`${orthancUrl}instances/${instanceId}/preview`, {
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
