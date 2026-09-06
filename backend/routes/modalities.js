const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ============================
   GET ALL ACTIVE MODALITIES
============================ */
router.get("/modalities", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name FROM modalities WHERE is_active = true ORDER BY id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch modalities error:", err.message);
    res.status(500).json({ error: "Failed to fetch modalities" });
  }
});

/* ============================
   GET BODY PARTS BY MODALITY
============================ */
router.get("/body-parts", async (req, res) => {
  try {
    const { modality_id } = req.query;
    if (!modality_id) {
      return res.status(400).json({ error: "modality_id is required" });
    }

    const result = await pool.query(
      `SELECT id, name 
       FROM body_parts 
       WHERE modality_id = $1 AND is_active = true 
       ORDER BY id`,
      [modality_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch body parts error:", err.message);
    res.status(500).json({ error: "Failed to fetch body parts" });
  }
});

module.exports = router;
