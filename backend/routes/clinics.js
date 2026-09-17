const express = require("express");
const router = express.Router();
const pool = require("../db");

async function ensureClinicsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clinics (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      ae_title VARCHAR(100),
      institution_name VARCHAR(255),
      address TEXT,
      phone VARCHAR(50),
      header_text TEXT,
      footer_text TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS email VARCHAR(100);
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS mrn_prefix VARCHAR(50) DEFAULT 'MRN';
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS mrn_format VARCHAR(50) DEFAULT '{PREFIX}-{YY}{MM}-{SEQ}';
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS mrn_next_seq INTEGER DEFAULT 1001;
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS nabh_id VARCHAR(100);
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS nabl_id VARCHAR(100);
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS registration_no VARCHAR(100);
    ALTER TABLE clinics ADD COLUMN IF NOT EXISTS logo_url TEXT;
  `).catch(() => {});
}

// GET /api/clinics - Fetch all active clinics with full details
router.get("/", async (req, res) => {
  try {
    await ensureClinicsTable();
    const result = await pool.query(
      `SELECT id, code, name, ae_title, institution_name, address, phone, email, 
              header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, is_active,
              nabh_id, nabl_id, registration_no, logo_url
       FROM clinics 
       ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch clinics error:", err.message);
    res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

// GET /api/clinics/active - Fetch default active hospital/clinic for report header letterhead
router.get("/active", async (req, res) => {
  try {
    await ensureClinicsTable();
    const result = await pool.query(
      `SELECT id, code, name, ae_title, institution_name, address, phone, email, 
              header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq,
              nabh_id, nabl_id, registration_no, logo_url
       FROM clinics 
       WHERE is_active = true 
       ORDER BY id ASC LIMIT 1`
    ).catch(() => ({ rows: [] }));

    if (result.rows && result.rows.length > 0) {
      const c = result.rows[0];
      res.json({
        ...c,
        name: c.name || "AKASH MEDICAL COLLEGE AND HOSPITALS",
        header_text: c.header_text || "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
        address: c.address || "Prasannahalli Main Road, Devanahalli, Bengaluru, Karnataka 562110",
        phone: c.phone || "+91 80 7115 9900 / +91 98865 17662",
        email: c.email || "info@akashmedical.edu.in",
        nabh_id: c.nabh_id || "NABH-H-2024-0891",
        nabl_id: c.nabl_id || "NABL-M-4821",
        registration_no: c.registration_no || "KMC/MED/REG/48190",
        footer_text: c.footer_text || "Electronically Verified Diagnostic Report • NABH & NABL Accredited"
      });
    } else {
      res.json({
        id: 1,
        code: "MAIN",
        name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
        header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
        address: "Prasannahalli Main Road, Devanahalli, Bengaluru, Karnataka 562110",
        phone: "+91 80 7115 9900 / +91 98865 17662",
        email: "info@akashmedical.edu.in",
        nabh_id: "NABH-H-2024-0891",
        nabl_id: "NABL-M-4821",
        registration_no: "KMC/MED/REG/48190",
        footer_text: "Electronically Verified Diagnostic Report • NABH & NABL Accredited"
      });
    }
  } catch (err) {
    console.error("Fetch active clinic error:", err.message);
    res.status(500).json({ error: "Failed to fetch active hospital details" });
  }
});

// GET /api/clinics/user-clinics - Fetch clinics assigned to user
router.get("/user-clinics", async (req, res) => {
  try {
    await ensureClinicsTable();
    const username = req.user?.username || req.user?.name || "admin";
    const userRes = await pool.query(
      "SELECT role, assigned_clinics FROM users WHERE username = $1 LIMIT 1",
      [username]
    ).catch(() => ({ rows: [] }));

    const user = userRes.rows[0];
    const role = user?.role || req.user?.role || "admin";
    const assigned = user?.assigned_clinics || ["ALL"];

    const allClinicsRes = await pool.query(
      `SELECT id, code, name, ae_title, institution_name, address, phone, email, 
              header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq,
              nabh_id, nabl_id, registration_no, logo_url
       FROM clinics 
       WHERE is_active = true 
       ORDER BY id ASC`
    );
    const allClinics = allClinicsRes.rows;

    if (role.toLowerCase() === "admin" || assigned.includes("ALL")) {
      return res.json({ role, assignedClinics: assigned, availableClinics: allClinics });
    }

    const filtered = allClinics.filter(c => assigned.includes(c.code) || assigned.includes(String(c.id)));
    res.json({ role, assignedClinics: assigned, availableClinics: filtered });
  } catch (err) {
    console.error("Fetch user clinics error:", err.message);
    res.status(500).json({ error: "Failed to fetch user assigned clinics" });
  }
});

// POST /api/clinics - Create or update clinic branch
router.post("/", async (req, res) => {
  try {
    const { code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, nabh_id, nabl_id, registration_no, logo_url } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: "Clinic code and name are required" });
    }

    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

    const result = await pool.query(
      `INSERT INTO clinics (code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, nabh_id, nabl_id, registration_no, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         ae_title = EXCLUDED.ae_title,
         institution_name = EXCLUDED.institution_name,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         email = EXCLUDED.email,
         header_text = EXCLUDED.header_text,
         footer_text = EXCLUDED.footer_text,
         mrn_prefix = EXCLUDED.mrn_prefix,
         mrn_format = EXCLUDED.mrn_format,
         mrn_next_seq = EXCLUDED.mrn_next_seq,
         nabh_id = EXCLUDED.nabh_id,
         nabl_id = EXCLUDED.nabl_id,
         registration_no = EXCLUDED.registration_no,
         logo_url = EXCLUDED.logo_url
       RETURNING *`,
      [
        cleanCode, 
        name.trim(), 
        ae_title?.trim() || cleanCode, 
        institution_name?.trim() || name.trim(), 
        address || "", 
        phone || "",
        email || "",
        header_text || "",
        footer_text || "",
        mrn_prefix || "MRN",
        mrn_format || "{PREFIX}-{YY}{MM}-{SEQ}",
        mrn_next_seq || 1001,
        nabh_id || "",
        nabl_id || "",
        registration_no || "",
        logo_url || ""
      ]
    );

    res.json({ success: true, clinic: result.rows[0] });
  } catch (err) {
    console.error("Create clinic error:", err.message);
    res.status(500).json({ error: "Failed to create clinic" });
  }
});

// PUT /api/clinics/:id - Update existing clinic branch
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, nabh_id, nabl_id, registration_no, logo_url } = req.body;

    const result = await pool.query(
      `UPDATE clinics
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           ae_title = COALESCE($3, ae_title),
           institution_name = COALESCE($4, institution_name),
           address = COALESCE($5, address),
           phone = COALESCE($6, phone),
           email = COALESCE($7, email),
           header_text = COALESCE($8, header_text),
           footer_text = COALESCE($9, footer_text),
           mrn_prefix = COALESCE($10, mrn_prefix),
           mrn_format = COALESCE($11, mrn_format),
           mrn_next_seq = COALESCE($12, mrn_next_seq),
           nabh_id = COALESCE($13, nabh_id),
           nabl_id = COALESCE($14, nabl_id),
           registration_no = COALESCE($15, registration_no),
           logo_url = COALESCE($16, logo_url)
       WHERE id = $17
       RETURNING *`,
      [code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, nabh_id, nabl_id, registration_no, logo_url, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Clinic branch not found" });
    }

    res.json({ success: true, clinic: result.rows[0] });
  } catch (err) {
    console.error("Update clinic error:", err.message);
    res.status(500).json({ error: "Failed to update clinic branch" });
  }
});

// DELETE /api/clinics/:id - Delete clinic branch
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM clinics WHERE id = $1", [id]);
    res.json({ success: true, message: "Clinic branch deleted" });
  } catch (err) {
    console.error("Delete clinic error:", err.message);
    res.status(500).json({ error: "Failed to delete clinic branch" });
  }
});

module.exports = router;
