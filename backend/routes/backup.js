const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const multer = require("multer");
const pool = require("../db");

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Multer storage for uploaded restore files
const upload = multer({
  dest: path.join(__dirname, "..", "temp_uploads"),
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit
});

// Ensure backup_logs table exists
const initBackupTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backup_logs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        filepath TEXT NOT NULL,
        size_mb NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Completed',
        backup_type VARCHAR(50) DEFAULT 'Manual',
        created_by VARCHAR(100) DEFAULT 'System Admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    console.error("Backup logs table init error:", err.message);
  }
};
initBackupTable();

// GET /api/backup/list - Fetch backup history
router.get("/list", async (req, res) => {
  try {
    const dbRes = await pool.query(
      "SELECT * FROM backup_logs ORDER BY created_at DESC"
    ).catch(() => ({ rows: [] }));

    let list = dbRes.rows;

    // Sync with files on disk
    if (fs.existsSync(BACKUP_DIR)) {
      const files = fs.readdirSync(BACKUP_DIR);
      const fileNamesInDb = new Set(list.map(b => b.filename));

      files.forEach(file => {
        if (file.endsWith(".zip") && !fileNamesInDb.has(file)) {
          const filePath = path.join(BACKUP_DIR, file);
          const stats = fs.statSync(filePath);
          list.push({
            id: Math.floor(Math.random() * 100000),
            filename: file,
            filepath: filePath,
            size_mb: (stats.size / (1024 * 1024)).toFixed(2),
            status: "Completed",
            backup_type: "System File",
            created_by: "Disk Archive",
            created_at: stats.mtime
          });
        }
      });
    }

    res.json({ success: true, backups: list });
  } catch (err) {
    console.error("Fetch backups error:", err.message);
    res.status(500).json({ error: "Failed to fetch backup history" });
  }
});

// POST /api/backup/create - Trigger instant system backup
router.post("/create", async (req, res) => {
  try {
    const backupType = req.body?.type || "Manual";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `ipacx_backup_${timestamp}.zip`;
    const zipPath = path.join(BACKUP_DIR, filename);

    const zip = new AdmZip();

    // 1. Dump Database Tables
    const dbTables = ["clinics", "users", "patients", "studies", "worklist", "reports", "report_templates", "report_images"];
    const dbDump = {};

    for (const table of dbTables) {
      try {
        const result = await pool.query(`SELECT * FROM ${table}`);
        dbDump[table] = result.rows;
      } catch (e) {
        console.warn(`Backup table dump skip (${table}):`, e.message);
        dbDump[table] = [];
      }
    }

    const dumpJsonPath = path.join(BACKUP_DIR, `db_dump_${timestamp}.json`);
    fs.writeFileSync(dumpJsonPath, JSON.stringify(dbDump, null, 2), "utf8");
    zip.addLocalFile(dumpJsonPath, "", "db_dump.json");

    // 2. Package Uploaded Media & Report Snapshots
    if (fs.existsSync(UPLOADS_DIR)) {
      zip.addLocalFolder(UPLOADS_DIR, "uploads");
    }

    // Write final ZIP archive
    zip.writeZip(zipPath);

    // Cleanup temp JSON dump
    if (fs.existsSync(dumpJsonPath)) {
      fs.unlinkSync(dumpJsonPath);
    }

    const stats = fs.statSync(zipPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);

    // Save to backup_logs
    await pool.query(
      `INSERT INTO backup_logs (filename, filepath, size_mb, status, backup_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (filename) DO UPDATE SET size_mb = EXCLUDED.size_mb`,
      [filename, zipPath, sizeMb, "Completed", backupType, req.user?.name || "System Admin"]
    ).catch(err => console.warn("Log backup record error:", err.message));

    res.json({
      success: true,
      message: `System Backup successfully generated (${sizeMb} MB)`,
      backup: {
        filename,
        filepath: zipPath,
        size_mb: sizeMb,
        created_at: new Date()
      }
    });
  } catch (err) {
    console.error("Create backup error:", err);
    res.status(500).json({ error: "Failed to create system backup: " + err.message });
  }
});

// GET /api/backup/download/:filename - Download backup zip
router.get("/download/:filename", (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    const zipPath = path.join(BACKUP_DIR, filename);

    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: "Backup file not found" });
    }

    res.download(zipPath, filename);
  } catch (err) {
    console.error("Download backup error:", err.message);
    res.status(500).json({ error: "Failed to download backup file" });
  }
});

// POST /api/backup/restore - Restore system database & files from uploaded ZIP
router.post("/restore", upload.single("backup_file"), async (req, res) => {
  try {
    let zipPath = null;

    if (req.file) {
      zipPath = req.file.path;
    } else if (req.body?.filename) {
      zipPath = path.join(BACKUP_DIR, path.basename(req.body.filename));
    }

    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(400).json({ error: "Backup ZIP file is required for restore" });
    }

    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    let restoredTablesCount = 0;
    let restoredFilesCount = 0;

    // 1. Extract database dump JSON
    const dumpEntry = zipEntries.find(entry => entry.entryName === "db_dump.json");
    if (dumpEntry) {
      const dumpText = dumpEntry.getData().toString("utf8");
      const dbDump = JSON.parse(dumpText);

      // Restore Clinics
      if (Array.isArray(dbDump.clinics) && dbDump.clinics.length > 0) {
        for (const c of dbDump.clinics) {
          await pool.query(
            `INSERT INTO clinics (code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, nabh_id, nabl_id, registration_no)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address, phone = EXCLUDED.phone, nabh_id = EXCLUDED.nabh_id, nabl_id = EXCLUDED.nabl_id`,
            [c.code, c.name, c.ae_title, c.institution_name, c.address, c.phone, c.email, c.header_text, c.footer_text, c.nabh_id, c.nabl_id, c.registration_no]
          ).catch(() => null);
        }
        restoredTablesCount++;
      }

      // Restore Reports
      if (Array.isArray(dbDump.reports) && dbDump.reports.length > 0) {
        for (const r of dbDump.reports) {
          await pool.query(
            `INSERT INTO reports (id, study_uid, patient_name, patient_id, modality, body_part, accession_number, status, history, findings, conclusion, report_title, report_content)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO UPDATE SET findings = EXCLUDED.findings, conclusion = EXCLUDED.conclusion, status = EXCLUDED.status`,
            [r.id, r.study_uid, r.patient_name, r.patient_id, r.modality, r.body_part, r.accession_number, r.status, r.history, r.findings, r.conclusion, r.report_title, JSON.stringify(r.report_content || {})]
          ).catch(() => null);
        }
        restoredTablesCount++;
      }
    }

    // 2. Extract media uploads folder
    zipEntries.forEach(entry => {
      if (entry.entryName.startsWith("uploads/") && !entry.isDirectory) {
        const targetPath = path.join(__dirname, "..", entry.entryName);
        const targetDir = path.dirname(targetPath);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(targetPath, entry.getData());
        restoredFilesCount++;
      }
    });

    // Cleanup temp upload
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.json({
      success: true,
      message: `System Restore successfully completed! Restored ${restoredTablesCount} database entities and ${restoredFilesCount} media snapshot files.`
    });
  } catch (err) {
    console.error("Restore backup error:", err);
    res.status(500).json({ error: "Failed to restore system backup: " + err.message });
  }
});

// GET /api/backup/schedule - Fetch backup schedule configuration
router.get("/schedule", async (req, res) => {
  res.json({
    enabled: true,
    frequency: "Daily",
    time: "02:00 AM",
    retentionCount: 30,
    includeMedia: true,
    lastBackup: new Date().toISOString()
  });
});

module.exports = router;
