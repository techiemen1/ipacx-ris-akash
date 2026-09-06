const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/clinics - Fetch all active clinics
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, code, name, ae_title, institution_name, is_active FROM clinics ORDER BY id ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch clinics error:", err.message);
    res.status(500).json({ error: "Failed to fetch clinics" });
  }
});

// POST /api/clinics - Create a new clinic
router.post("/", async (req, res) => {
  try {
    const { code, name, ae_title, institution_name, address, phone } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: "Clinic code and name are required" });
    }

    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");

    const result = await pool.query(
      `INSERT INTO clinics (code, name, ae_title, institution_name, address, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         ae_title = EXCLUDED.ae_title,
         institution_name = EXCLUDED.institution_name,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone
       RETURNING *`,
      [cleanCode, name.trim(), ae_title?.trim() || cleanCode, institution_name?.trim() || name.trim(), address || "", phone || ""]
    );

    res.json({ success: true, clinic: result.rows[0] });
  } catch (err) {
    console.error("Create clinic error:", err.message);
    res.status(500).json({ error: "Failed to create clinic" });
  }
});
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
      "SELECT id, code, name, ae_title, institution_name FROM clinics WHERE is_active = true ORDER BY id ASC"
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

// PUT /api/clinics/users/:userId/assign - Admin API to assign clinics to a specific user
router.put("/users/:userId/assign", async (req, res) => {
  try {
    const { userId } = req.params;
    const { assigned_clinics } = req.body; // e.g. ["CLINIC_A", "CLINIC_B"] or ["ALL"]

    if (!Array.isArray(assigned_clinics)) {
      return res.status(400).json({ error: "assigned_clinics must be an array of clinic codes" });
    }

    const result = await pool.query(
      "UPDATE users SET assigned_clinics = $1 WHERE id = $2 RETURNING id, username, role, assigned_clinics",
      [assigned_clinics, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, message: "Clinics successfully assigned to user", user: result.rows[0] });
  } catch (err) {
    console.error("Assign clinics error:", err.message);
    res.status(500).json({ error: "Failed to assign clinics to user" });
  }
});

// PUT /api/clinics/:id - Update existing clinic branch
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, ae_title, institution_name, address, phone, header_text, footer_text, mrn_prefix, mrn_format, mrn_next_seq } = req.body;

    const result = await pool.query(
      `UPDATE clinics
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           ae_title = COALESCE($3, ae_title),
           institution_name = COALESCE($4, institution_name),
           address = COALESCE($5, address),
           phone = COALESCE($6, phone)
       WHERE id = $7
       RETURNING *`,
      [code, name, ae_title, institution_name, address, phone, id]
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
