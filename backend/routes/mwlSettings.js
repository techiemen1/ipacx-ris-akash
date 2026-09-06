const express = require("express");
const router = express.Router();
const pool = require("../db");

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mwl_settings (
      id INTEGER PRIMARY KEY,
      autopush_enabled BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await pool.query(
    "INSERT INTO mwl_settings (id, autopush_enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING"
  );
}

router.get("/", async (req, res) => {
  try {
    await ensureSettingsTable();
    const result = await pool.query(
      "SELECT autopush_enabled FROM mwl_settings WHERE id = 1"
    );
    const enabled = result.rows[0]?.autopush_enabled || false;
    res.json({ success: true, autopush_enabled: enabled });
  } catch (err) {
    console.error("MWL settings fetch error:", err.message);
    res.status(500).json({ success: false, error: "Failed to load settings" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureSettingsTable();
    const enabled = Boolean(req.body?.autopush_enabled);
    await pool.query(
      "UPDATE mwl_settings SET autopush_enabled = $1 WHERE id = 1",
      [enabled]
    );
    res.json({ success: true, autopush_enabled: enabled });
  } catch (err) {
    console.error("MWL settings update error:", err.message);
    res.status(500).json({ success: false, error: "Failed to save settings" });
  }
});

module.exports = router;
