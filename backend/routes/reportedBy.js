const express = require("express");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const router = express.Router();
const uploadSignature = require("../middleware/uploadSignature");

/* =========================
   CREATE REPORTED BY USER
========================= */
router.post("/", uploadSignature.single("signature"), async (req, res) => {
  const { title, full_name, email, qualification, designation, registration_number, specialty } = req.body;

  if (!full_name) {
    return res.status(400).json({ error: "Full Name is required" });
  }

  try {
    const signature_path = req.file ? `/uploads/signatures/${req.file.filename}` : null;

    const result = await pool.query(
      `
      INSERT INTO reporters
      (title, full_name, email, qualification, designation, registration_number, specialty, signature_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
      `,
      [
        title || null,
        full_name,
        email || null,
        qualification || null,
        designation || null,
        registration_number || null,
        specialty || null,
        signature_path
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Create reporter error:", err);
    res.status(500).json({ error: "Failed to create reported by user" });
  }
});


/* =========================
   GET ALL REPORTED BY USERS
========================= */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM reporters ORDER BY id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch reporters error:", err);
    res.status(500).json({ error: "Failed to fetch reported by users" });
  }
});

/* =========================
   UPDATE REPORTED BY USER
========================= */
router.put("/:id", uploadSignature.single("signature"), async (req, res) => {
  const { id } = req.params;
  const { title, full_name, email, qualification, designation, registration_number, specialty } = req.body;

  try {
    const userRes = await pool.query("SELECT * FROM reporters WHERE id=$1", [id]);
    if (!userRes.rows.length) return res.status(404).json({ error: "Reported by user not found" });

    const user = userRes.rows[0];
    const signature_path = req.file ? `/uploads/signatures/${req.file.filename}` : user.signature_url;

    // Delete old signature if replaced
    if (req.file && user.signature_url) {
      const oldPath = path.join(__dirname, "..", user.signature_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const result = await pool.query(
      `
      UPDATE reporters SET
        title=$1,
        full_name=$2,
        email=$3,
        qualification=$4,
        designation=$5,
        registration_number=$6,
        specialty=$7,
        signature_url=$8,
        updated_at=NOW()
      WHERE id=$9
      RETURNING *
      `,
      [
        title || null,
        full_name,
        email || null,
        qualification || null,
        designation || null,
        registration_number || null,
        specialty || null,
        signature_path,
        id
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update reporter error:", err);
    res.status(500).json({ error: "Failed to update reported by user" });
  }
});


/* =========================
   TOGGLE ACTIVE STATUS
========================= */
router.put("/:id/toggle", async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE reporters
      SET is_active = NOT is_active, updated_at = NOW()
      WHERE id=$1
      RETURNING id, is_active
      `,
      [req.params.id]
    );

    if (!result.rows.length) return res.status(404).json({ error: "Reported by user not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Toggle reporter error:", err);
    res.status(500).json({ error: "Toggle failed" });
  }
});

/* =========================
   DELETE REPORTED BY USER
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const userRes = await pool.query("SELECT * FROM reporters WHERE id=$1", [req.params.id]);
    if (!userRes.rows.length) return res.status(404).json({ error: "Reported by user not found" });

    const user = userRes.rows[0];

    // Delete signature file if exists
    if (user.signature_url) {
      const filePath = path.join(__dirname, "..", user.signature_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    const result = await pool.query("DELETE FROM reporters WHERE id=$1 RETURNING id, full_name", [req.params.id]);
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error("Delete reporter error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* =========================
   GET REPORTER BY NAME (AUTOFILL)
========================= */
router.get("/by-name/:name", async (req, res) => {
  try {
    const { name } = req.params;

    const result = await pool.query(
      `SELECT full_name, qualification, signature_url
       FROM reporters
       WHERE full_name ILIKE $1 AND is_active = true
       LIMIT 1`,
      [`%${name}%`]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Reporter not found" });
    }

    const r = result.rows[0];

    res.json({
      full_name: r.full_name || "",
      qualification: r.qualification || "",
      signature_url: r.signature_url || null,
      dateTime: new Date().toISOString()
    });
  } catch (err) {
    console.error("Reported by fetch error:", err);
    res.status(500).json({ error: "Failed to fetch reporter" });
  }
});


module.exports = router;
