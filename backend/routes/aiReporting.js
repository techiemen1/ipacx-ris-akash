const express = require("express");
const router = express.Router();
const aiReportingService = require("../services/aiReportingService");

// POST /api/ai/match-template - Match best template for study
router.post("/match-template", async (req, res, next) => {
  try {
    const { modality, bodyPart, studyDescription } = req.body;
    const clinicId = req.clinicId || 1;
    const template = await aiReportingService.matchBestTemplate({ modality, bodyPart, studyDescription, clinicId });
    res.json({ success: true, template });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/auto-fill-measurements - Auto fill DICOM measurements
router.post("/auto-fill-measurements", async (req, res, next) => {
  try {
    const { findings, measurements } = req.body;
    const updatedFindings = aiReportingService.autoFillMeasurements(findings, measurements);
    res.json({ success: true, findings: updatedFindings });
  } catch (err) {
    next(err);
  }
});

// POST /api/ai/generate-impression - Generate AI impression summary
router.post("/generate-impression", async (req, res, next) => {
  try {
    const { history, findings, modality, bodyPart } = req.body;
    const impression = await aiReportingService.generateAIImpression({ history, findings, modality, bodyPart });
    res.json({ success: true, impression });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
