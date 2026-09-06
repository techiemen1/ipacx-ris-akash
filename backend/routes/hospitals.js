const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/hospitals - List all hospital networks
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM hospitals WHERE is_active = true ORDER BY name ASC");
    res.json({ success: true, hospitals: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/hospitals - Create new hospital
router.post("/", async (req, res, next) => {
  try {
    const { code, name, logo_url } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, error: "Hospital code and name are required" });
    }
    const result = await pool.query(
      "INSERT INTO hospitals (code, name, logo_url) VALUES ($1, $2, $3) RETURNING *",
      [code.toUpperCase(), name, logo_url || null]
    );
    res.status(201).json({ success: true, hospital: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/hospitals/:id - Update hospital
router.put("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, logo_url, is_active } = req.body;
    const result = await pool.query(
      `UPDATE hospitals 
       SET name = COALESCE($1, name), 
           logo_url = COALESCE($2, logo_url), 
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [name, logo_url, is_active, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: "Hospital not found" });
    }
    res.json({ success: true, hospital: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
