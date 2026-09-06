const multer = require("multer");
const path = require("path");
const fs = require("fs");

const signatureDir = path.join(__dirname, "../uploads/signatures");
if (!fs.existsSync(signatureDir)) {
  fs.mkdirSync(signatureDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, signatureDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    const title = (req.body.title || "SIGN").replace(/\s+/g, "_");
    const username = (req.body.username || "USER").replace(/\s+/g, "_");
    cb(null, `SIGN_${title}_${username}_${Date.now()}${ext}`);
  }
});

const uploadSignature = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  }
});

module.exports = uploadSignature;
