const express = require("express");
const router = express.Router();
const multer = require("multer");
const dicomWebService = require("../services/dicomWebService");

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/dicomweb/studies - QIDO-RS search studies
router.get("/studies", async (req, res, next) => {
  try {
    const data = await dicomWebService.searchStudies(req.query);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/dicomweb/studies/:studyUID/metadata - WADO-RS study metadata
router.get("/studies/:studyUID/metadata", async (req, res, next) => {
  try {
    const { studyUID } = req.params;
    const metadata = await dicomWebService.getStudyMetadata(studyUID);
    res.json(metadata);
  } catch (err) {
    next(err);
  }
});

// GET /api/dicomweb/studies/:studyUID/instances - QIDO-RS search study instances
router.get("/studies/:studyUID/instances", async (req, res, next) => {
  try {
    const { studyUID } = req.params;
    const instances = await dicomWebService.getStudyInstances(studyUID);
    res.json(instances);
  } catch (err) {
    next(err);
  }
});

// GET /api/dicomweb/studies/:studyUID/series/:seriesUID/instances/:instanceUID/rendered
router.get("/studies/:studyUID/series/:seriesUID/instances/:instanceUID/rendered", async (req, res, next) => {
  try {
    const { instanceUID } = req.params;
    const stream = await dicomWebService.getRenderedInstance(instanceUID);
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

// POST /api/dicomweb/studies - STOW-RS DICOM upload endpoint
router.post("/studies", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: "No DICOM file provided" });
    }

    const result = await dicomWebService.storeDicomInstance(req.file.buffer);
    res.status(201).json({ success: true, message: "DICOM instance stored successfully", result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
