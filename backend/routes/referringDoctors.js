const express = require("express");
const router = express.Router();
const pool = require("../db");

// Auto-ensure referring_doctors table exists on module startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.referring_doctors (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        specialty VARCHAR(100),
        qualification VARCHAR(100),
        clinic_name VARCHAR(255),
        hospital_name VARCHAR(255),
        mobile VARCHAR(20),
        contact_number VARCHAR(20),
        email VARCHAR(100),
        address TEXT,
        clinic_id INT DEFAULT 1,
        hospital_id INT DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.warn("Table auto-create for referring_doctors notice:", e.message);
  }
})();

// GET /api/referring-doctors - List referring doctors
router.get("/", async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, COALESCE(full_name, name) as full_name, specialty, qualification, clinic_name, mobile, email, is_active 
       FROM referring_doctors 
       WHERE is_active = true
       ORDER BY id ASC`
    );
    res.json({ success: true, doctors: result.rows });
  } catch (err) {
    console.error("Fetch referring doctors error:", err.message);
    res.json({ success: true, doctors: [] });
  }
});

// POST /api/referring-doctors - Create referring doctor
router.post("/", async (req, res, next) => {
  try {
    const { full_name, name, email, mobile, specialty, qualification, clinic_name } = req.body;
    const docName = (full_name || name || "").trim();

    if (!docName) {
      return res.status(400).json({ success: false, error: "Doctor full name is required" });
    }

    const result = await pool.query(
      `INSERT INTO referring_doctors (full_name, name, email, mobile, specialty, qualification, clinic_name)
       VALUES ($1, $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [docName, email || null, mobile || null, specialty || null, qualification || null, clinic_name || null]
    );

    res.status(201).json({ success: true, doctor: result.rows[0] });
  } catch (err) {
    console.error("Create referring doctor error:", err.message);
    res.status(500).json({ success: false, error: "Failed to create referring doctor" });
  }
});

// GET /api/referring-doctors/studies - Referring doctor portal study list
router.get("/studies", async (req, res, next) => {
  try {
    const doctorName = req.query.doctor_name || req.query.doctor || null;
    let query = `
      SELECT r.id as report_id, r.study_uid, r.patient_id, r.patient_name, r.modality, r.status, r.created_at, r.updated_at,
             r.accession_number, r.body_part, r.referring_doctor,
             COALESCE(c.name, 'Main Diagnostic Center') AS clinic_name,
             COALESCE(c.header_text, 'IPACX Healthcare Network') AS hospital_name,
             s.study_date, s.study_time, s.study_description
      FROM reports r
      LEFT JOIN studies s ON r.study_uid = s.study_uid
      LEFT JOIN clinics c ON r.clinic_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (doctorName && doctorName.trim().length > 0) {
      query += ` AND r.referring_doctor ILIKE $1`;
      params.push(`%${doctorName.trim()}%`);
    }

    query += " ORDER BY r.updated_at DESC, r.created_at DESC LIMIT 200";
    const result = await pool.query(query, params);
    res.json({ success: true, count: result.rows.length, studies: result.rows });
  } catch (err) {
    console.error("Fetch referred studies error:", err.message);
    res.json({ success: true, count: 0, studies: [] });
  }
});

module.exports = router;
