const express = require("express");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const router = express.Router();
const uploadSignature = require("../middleware/uploadSignature");
const axios = require("axios");
const { logAction } = require("../utils/auditLogger");

/* =========================
   CREATE USER (ADMIN)
========================= */
router.post("/", uploadSignature.single("signature"), async (req, res) => {
  const {
    title,
    full_name,
    username,
    password,
    role,
    email,
    qualification,
    designation,
    assigned_clinics
  } = req.body;

  if (!username || !password || !role || !email) {
    return res.status(400).json({ error: "Required fields missing" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const signature_path = req.file
      ? `/uploads/signatures/${req.file.filename}`
      : null;

    let parsedClinics = ["ALL"];
    if (assigned_clinics) {
      try {
        parsedClinics = typeof assigned_clinics === "string" ? JSON.parse(assigned_clinics) : assigned_clinics;
      } catch {
        parsedClinics = [String(assigned_clinics)];
      }
    }

    const result = await pool.query(
      `
      INSERT INTO users
      (title, full_name, username, password_hash, role, email,
       qualification, designation, signature_url, registration_number, assigned_clinics)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING
        id, title, full_name, username, email,
        role, qualification, designation, registration_number,
        is_active, signature_url, assigned_clinics
      `,
      [
        title || null,
        full_name || null,
        username,
        hash,
        role,
        email,
        qualification || null,
        designation || null,
        signature_path,
        req.body.registration_number || null,
        parsedClinics
      ]
    );

    await logAction(req, {
      event: "USER_CREATED",
      details: {
        target_user_id: result.rows[0].id,
        target_username: result.rows[0].username,
        target_role: result.rows[0].role,
      },
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

/* =========================
   GET USERS
========================= */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        title,
        full_name,
        username,
        email,
        role,
        qualification,
        designation,
        registration_number,
        is_active,
        signature_url,
        assigned_clinics,
        created_at
      FROM users
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch users error:", err.message);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/* =========================
   UPDATE USER
========================= */
router.put("/:id", uploadSignature.single("signature"), async (req, res) => {
  const { id } = req.params;

  try {
    const userRes = await pool.query("SELECT * FROM users WHERE id=$1", [id]);
    if (!userRes.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userRes.rows[0];

    const {
      title,
      full_name,
      username,
      password,
      role,
      email,
      qualification,
      designation,
      assigned_clinics
    } = req.body;

    const hash = password?.trim()
      ? await bcrypt.hash(password, 10)
      : user.password_hash;

    const signature_path = req.file
      ? `/uploads/signatures/${req.file.filename}`
      : user.signature_url;

    let parsedClinics = user.assigned_clinics || ["ALL"];
    if (assigned_clinics !== undefined) {
      try {
        parsedClinics = typeof assigned_clinics === "string" ? JSON.parse(assigned_clinics) : assigned_clinics;
      } catch {
        parsedClinics = [String(assigned_clinics)];
      }
    }

    if (req.file && user.signature_url) {
      const oldPath = path.join(__dirname, "..", user.signature_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const result = await pool.query(
      `
      UPDATE users SET
        title=$1,
        full_name=$2,
        username=$3,
        email=$4,
        role=$5,
        qualification=$6,
        designation=$7,
        password_hash=$8,
        signature_url=$9,
        registration_number=$10,
        assigned_clinics=$11
      WHERE id=$12
      RETURNING
        id, title, full_name, username, email,
        role, qualification, designation, registration_number,
        is_active, signature_url, assigned_clinics
      `,
      [
        title || null,
        full_name || null,
        username,
        email,
        role,
        qualification || null,
        designation || null,
        hash,
        signature_path,
        req.body.registration_number || null,
        parsedClinics,
        id
      ]
    );


    const updated = result.rows[0];
    const changed = [];
    if ((user.title || null) !== (updated.title || null)) changed.push("title");
    if ((user.full_name || null) !== (updated.full_name || null)) changed.push("full_name");
    if ((user.username || null) !== (updated.username || null)) changed.push("username");
    if ((user.email || null) !== (updated.email || null)) changed.push("email");
    if ((user.role || null) !== (updated.role || null)) changed.push("role");
    if ((user.qualification || null) !== (updated.qualification || null)) changed.push("qualification");
    if ((user.designation || null) !== (updated.designation || null)) changed.push("designation");
    if ((user.signature_url || null) !== (updated.signature_url || null)) changed.push("signature_url");
    if (password?.trim()) changed.push("password_hash");

    await logAction(req, {
      event: "USER_UPDATED",
      details: {
        target_user_id: updated.id,
        target_username: updated.username,
        changed_fields: changed,
      },
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update user error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

/* =========================
   TOGGLE ACTIVE
========================= */
router.put("/:id/toggle", async (req, res) => {
  try {
    const result = await pool.query(
      `
      UPDATE users
      SET is_active = NOT is_active
      WHERE id=$1
      RETURNING id, is_active
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    await logAction(req, {
      event: "USER_STATUS_TOGGLED",
      details: {
        target_user_id: result.rows[0].id,
        is_active: result.rows[0].is_active,
      },
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Toggle user error:", err);
    res.status(500).json({ error: "Toggle failed" });
  }
});

/* =========================
   DELETE USER
========================= */
router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM users WHERE id=$1 RETURNING id, username",
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    await logAction(req, {
      event: "USER_DELETED",
      details: {
        target_user_id: result.rows[0].id,
        target_username: result.rows[0].username,
      },
    });

    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

/* =========================
   GET USER OR REPORTER BY USERNAME/EMAIL
========================= */
router.get("/approved-by/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const result = await pool.query(
      `SELECT full_name, qualification, designation, registration_number, signature_url
       FROM users
       WHERE username = $1 AND is_active = true`,
      [username]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "User not found" });

    const u = result.rows[0];

    res.json({
      full_name: u.full_name || "",
      qualification: u.qualification || "",
      designation: u.designation || "",
      registration_number: u.registration_number || "",
      signature_url: u.signature_url || null,
      dateTime: new Date().toISOString()
    });
  } catch (err) {
    console.error("Approved by fetch error:", err);
    res.status(500).json({ error: "Failed to fetch approved by user" });
  }
});


module.exports = router;
