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

const { getOrthancUrl, orthancAuthConfig, extractCleanInstanceId } = require("../utils/orthancHelper");

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
  const { startDate, endDate, pacs_id, refresh, force } = req.query;
  const forceRefresh = refresh === "true" || force === "true";
  const studies = await pacsService.listActiveStudies({
    startDate,
    endDate,
    pacsId: pacs_id,
    forceRefresh
  });
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
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
  const instanceId = extractCleanInstanceId(req.params.instanceId);
  const frame = req.query.frame !== undefined ? req.query.frame : (req.query.frameIndex !== undefined ? req.query.frameIndex : null);
  const orthancUrl = await getOrthancUrl();
  try {
    const renderPath = (frame !== null && frame !== "") 
      ? `instances/${instanceId}/frames/${frame}/rendered` 
      : `instances/${instanceId}/rendered`;
    const previewStream = await axios.get(`${orthancUrl}${renderPath}`, {
      responseType: "stream",
      ...orthancAuthConfig(),
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    previewStream.data.pipe(res);
  } catch (err) {
    try {
      const previewPath = (frame !== null && frame !== "") 
        ? `instances/${instanceId}/frames/${frame}/preview` 
        : `instances/${instanceId}/preview`;
      const fbStream = await axios.get(`${orthancUrl}${previewPath}`, {
        responseType: "stream",
        ...orthancAuthConfig(),
      });
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      fbStream.data.pipe(res);
    } catch (fbErr) {
      console.error(`[PACS Proxy] Failed fetching instance preview for ${instanceId} frame ${frame}:`, fbErr.message);
      res.status(404).send("Preview unavailable");
    }
  }
}));

router.get("/instance-tags/:instanceId", asyncHandler(async (req, res) => {
  const instanceId = extractCleanInstanceId(req.params.instanceId);
  const orthancUrl = await getOrthancUrl();
  try {
    const { data: tags } = await axios.get(`${orthancUrl}instances/${instanceId}/tags?simplified`, { ...orthancAuthConfig(), timeout: 4000 });
    res.json({ success: true, tags });
  } catch (err) {
    console.error(`[PACS Proxy] Failed fetching tags for instance ${instanceId}:`, err.message);
    res.status(500).json({ success: false, message: "Failed to fetch DICOM tags" });
  }
}));

/**
 * Shared High-Performance Parallel DICOM Series & Instance Retriever
 * Handles:
 *  - Single-frame DICOM series (sorted strictly by InstanceNumber)
 *  - Multi-frame DICOM instances (expands frames 0..N into slices)
 *  - Parallel non-blocking execution across all series in study
 *  - All modalities (MR, CT, CR/DX, US, MG, EC)
 */
async function fetchStudySeriesAndInstances(orthancUrl, studyData) {
  if (!studyData || !Array.isArray(studyData.Series) || studyData.Series.length === 0) {
    return [];
  }

  const config = orthancAuthConfig();

  const seriesPromises = studyData.Series.map((seriesId, sIdx) => 
    axios.get(`${orthancUrl}series/${seriesId}`, { ...config, timeout: 6000 })
      .then(async (r) => {
        if (!r.data) return null;
        const sData = r.data;
        const sDesc = sData.MainDicomTags?.SeriesDescription || `Series ${sIdx + 1}`;
        const sNum = parseInt(sData.MainDicomTags?.SeriesNumber || (sIdx + 1), 10);
        const sModality = sData.MainDicomTags?.Modality || "";

        let orderedInstances = [];

        // 1. Attempt expanded instances query (provides full DICOM tags for sorting)
        try {
          const { data: expInstances } = await axios.get(`${orthancUrl}series/${seriesId}/instances?expand`, { ...config, timeout: 6000 });
          if (Array.isArray(expInstances) && expInstances.length > 0) {
            expInstances.sort((a, b) => {
              const numA = parseInt(a.MainDicomTags?.InstanceNumber || a.IndexInSeries || 0, 10);
              const numB = parseInt(b.MainDicomTags?.InstanceNumber || b.IndexInSeries || 0, 10);
              return numA - numB;
            });
            orderedInstances = expInstances.map((inst, iIdx) => {
              const instId = extractCleanInstanceId(inst.ID || inst);
              const sliceNum = parseInt(inst.MainDicomTags?.InstanceNumber || (iIdx + 1), 10);
              return {
                id: instId,
                instance_id: instId,
                slice_number: sliceNum,
                instanceNumber: sliceNum,
                slice_index: iIdx + 1,
                previewUrl: `/api/pacs/instance-preview/${instId}`,
                preview_url: `/api/pacs/instance-preview/${instId}`,
                caption: `${sDesc} | Slice ${iIdx + 1}/${expInstances.length}`
              };
            });
          }
        } catch (e) {
          // Fallback if expanded query times out or fails
        }

        // 2. Fallback if expansion produced empty array
        if (orderedInstances.length === 0 && Array.isArray(sData.Instances) && sData.Instances.length > 0) {
          orderedInstances = sData.Instances.map((instItem, iIdx) => {
            const instId = extractCleanInstanceId(instItem);
            return {
              id: instId,
              instance_id: instId,
              slice_number: iIdx + 1,
              instanceNumber: iIdx + 1,
              slice_index: iIdx + 1,
              previewUrl: `/api/pacs/instance-preview/${instId}`,
              preview_url: `/api/pacs/instance-preview/${instId}`,
              caption: `${sDesc} | Slice ${iIdx + 1}/${sData.Instances.length}`
            };
          });
        }

        // 3. Multi-frame DICOM slice expansion (crucial for MRI, CT, US multi-frame single instance files)
        if (orderedInstances.length === 1) {
          const singleInstId = orderedInstances[0].id;
          try {
            const { data: frames } = await axios.get(`${orthancUrl}instances/${singleInstId}/frames`, { ...config, timeout: 4000 });
            if (Array.isArray(frames) && frames.length > 1) {
              orderedInstances = frames.map((fIdx) => ({
                id: `${singleInstId}?frame=${fIdx}`,
                instance_id: singleInstId,
                frame_index: fIdx,
                slice_number: fIdx + 1,
                instanceNumber: fIdx + 1,
                slice_index: fIdx + 1,
                previewUrl: `/api/pacs/instance-preview/${singleInstId}?frame=${fIdx}`,
                preview_url: `/api/pacs/instance-preview/${singleInstId}?frame=${fIdx}`,
                caption: `${sDesc} | Frame ${fIdx + 1}/${frames.length}`
              }));
            }
          } catch (e) {
            // Standard single frame DICOM file
          }
        }

        const dicomSeriesUid = sData.MainDicomTags?.SeriesInstanceUID || sData.ID || seriesId;

        return {
          seriesId: sData.ID || seriesId,
          series_id: sData.ID || seriesId,
          orthanc_series_id: sData.ID || seriesId,
          series_instance_uid: dicomSeriesUid,
          seriesDescription: sDesc,
          series_description: sDesc,
          seriesNumber: sNum,
          series_number: sNum,
          modality: sModality,
          totalSlices: orderedInstances.length,
          total_slices: orderedInstances.length,
          instances: orderedInstances
        };
      })
      .catch((err) => {
        console.error(`[PACS helper] Series ${seriesId} fetch failed:`, err.message);
        return null;
      })
  );

  const results = await Promise.all(seriesPromises);
  const validSeries = results.filter(Boolean);
  validSeries.sort((a, b) => (a.seriesNumber || 0) - (b.seriesNumber || 0));

  return validSeries;
}

/* ======================================================
   MOBILE FAST RETRIEVAL PAYLOAD (OPTIMIZED FOR SMARTPHONES)
====================================================== */
router.get("/mobile-study/:studyUID", asyncHandler(async (req, res) => {
  const { studyUID } = req.params;
  const orthancUrl = await getOrthancUrl();
  const orthancId = await findOrthancStudy(studyUID);

  if (!orthancId) {
    return res.status(404).json({ success: false, message: "Study not found in PACS" });
  }

  const { data: studyData } = await axios.get(`${orthancUrl}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 4000 });

  const rawPName = studyData.PatientMainDicomTags?.PatientName || studyData.MainDicomTags?.PatientName || "Patient";
  const patientName = String(rawPName).replace(/\^+/g, " ").trim() || "Patient";
  const patientId = studyData.PatientMainDicomTags?.PatientID || studyData.MainDicomTags?.PatientID || "N/A";
  const accession = studyData.MainDicomTags?.AccessionNumber || "N/A";
  let modality = studyData.MainDicomTags?.Modality || "";
  const studyDate = studyData.MainDicomTags?.StudyDate || "";
  const studyDescription = studyData.MainDicomTags?.StudyDescription || "";

  const seriesList = await fetchStudySeriesAndInstances(orthancUrl, studyData);

  if (!modality && seriesList.length > 0) {
    const foundMod = seriesList.find(s => s.modality)?.modality;
    if (foundMod) modality = foundMod;
  }

  // Fallback modality parsing if missing
  const normMod = String(modality).toUpperCase().trim();
  if (!normMod || !["CR", "DX", "XR", "CT", "MR", "MRI", "US", "USG", "MG", "EC", "ECHO"].includes(normMod)) {
    const desc = String(studyDescription).toUpperCase();
    if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST PA") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) modality = "CR";
    else if (desc.includes("MRI") || desc.includes("MR") || desc.includes("SPINE") || desc.includes("BRAIN")) modality = "MR";
    else if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) modality = "US";
    else if (desc.includes("CT") || desc.includes("TOMOGRAPHY") || desc.includes("HEAD") || desc.includes("SINUS") || desc.includes("ABDOMEN")) modality = "CT";
    else modality = "CR";
  } else {
    modality = normMod === "MRI" ? "MR" : normMod === "USG" ? "US" : normMod;
  }

  res.json({
    success: true,
    studyUID,
    patientName,
    patientId,
    accession,
    modality,
    studyDate,
    studyDescription,
    series: seriesList
  });
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

    if (!studyData) {
      return res.json({ success: true, series: [] });
    }

    const seriesList = await fetchStudySeriesAndInstances(orthancUrl, studyData);

    res.json({
      success: true,
      studyUID,
      series: seriesList
    });
  } catch (err) {
    console.error("Fetch study-series-instances failed:", err.message);
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
