const express = require("express");
const multer = require("multer");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Blob } = require("buffer");

const router = express.Router();

const tmpDir = path.join(__dirname, "../uploads/audio_tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  let tempPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Audio file is required" });
    }
    tempPath = req.file.path;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Speech transcription is not configured (missing OPENAI_API_KEY)" });
    }

    const model = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";
    const language = String(req.body?.language || "en").trim();

    const audioBuffer = await fsp.readFile(tempPath);
    const mimeType = req.file.mimetype || "audio/webm";
    const filename = req.file.originalname || "dictation.webm";

    const form = new FormData();
    form.append("model", model);
    if (language) form.append("language", language);
    form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const msg = payload?.error?.message || "Transcription request failed";
      return res.status(500).json({ error: msg });
    }

    return res.json({ text: String(payload?.text || "").trim() });
  } catch (err) {
    console.error("Speech transcribe error:", err);
    return res.status(500).json({ error: "Failed to transcribe audio" });
  } finally {
    if (tempPath) {
      await fsp.unlink(tempPath).catch(() => {});
    }
  }
});

module.exports = router;
