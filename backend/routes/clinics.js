const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/clinics - Fetch all active clinics with full details
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, name, ae_title, institution_name, address, phone, email, 
              header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, is_active 
       FROM clinics 
       ORDER BY id ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch clinics error:", err.message);
    res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

// GET /api/clinics/active - Fetch default active clinic for report header letterhead
router.get("/active", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, name, ae_title, institution_name, address, phone, email, 
              header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq 
       FROM clinics 
       WHERE is_active = true 
       ORDER BY id ASC LIMIT 1`
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.json({
        id: 1,
        code: "MAIN",
        name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
        header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
        address: "Devanahalli, BANGALORE, KARNATAKA, INDIA",
        phone: "+91 9886517662",
        email: "info@akashmedical.edu.in",
        footer_text: "Electronically Verified Diagnostic Report"
      });
    }
  } catch (err) {
    console.error("Fetch active clinic error:", err.message);
    res.status(500).json({ error: "Failed to fetch active clinic" });
  }
});

// GET /api/clinics/user-clinics - Fetch clinics assigned to user
router.get("/user-clinics", async (req, res) => {
  try {
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
              header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq 
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
    const { code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: "Clinic code and name are required" });
    }

    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

    const result = await pool.query(
      `INSERT INTO clinics (code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
         mrn_next_seq = EXCLUDED.mrn_next_seq
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
        mrn_next_seq || 1001
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
    const { code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq } = req.body;

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
           mrn_next_seq = COALESCE($12, mrn_next_seq)
       WHERE id = $13
       RETURNING *`,
      [code, name, ae_title, institution_name, address, phone, email, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq, id]
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
