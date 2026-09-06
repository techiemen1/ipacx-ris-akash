// routes/reportTemplates.js
const express = require("express");
const router = express.Router();
const pool = require("../db"); // import your pool from db.js
const { logAction } = require("../utils/auditLogger");

// ========================
// MODALITIES & BODY PARTS
// ========================

// Get all active modalities
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

// Get active body parts by modality_id
router.get("/body-parts", async (req, res) => {
  try {
    const modality_id = req.query.modality_id;
    if (!modality_id) return res.status(400).json({ error: "modality_id is required" });

    const result = await pool.query(
      "SELECT id, name FROM body_parts WHERE modality_id = $1 AND is_active = true ORDER BY id",
      [modality_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch body parts error:", err.message);
    res.status(500).json({ error: "Failed to fetch body parts" });
  }
});

// ========================
// REPORT TEMPLATES ROUTES
// ========================

// Create a new template
router.post("/report-templates", async (req, res) => {
  try {
    const { template_name, modality, body_part, template_type, content, created_by, created_by_role } = req.body;

    if (!content) return res.status(400).json({ error: "Content is required" });

    const finalTemplateName =
      template_name && template_name.trim() !== ""
        ? template_name
        : modality && body_part
        ? `${modality}_${body_part}_${template_type || "plain"}`
        : null;

    const result = await pool.query(
      `INSERT INTO report_templates
        (template_name, modality, body_part, template_type, content, created_by, created_by_role, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
       RETURNING *`,
      [
        finalTemplateName,
        modality || null,
        body_part || null,
        template_type || "plain",
        JSON.stringify(content),
        created_by || null,
        created_by_role || null
      ]
    );

    const created = result.rows[0];
    created.content = content;

    await logAction(req, {
      event: "TEMPLATE_CREATED",
      details: {
        template_id: created.id,
        template_name: created.template_name,
        modality: created.modality,
        body_part: created.body_part,
      },
    });

    res.json({ success: true, template: created });
  } catch (err) {
    console.error("Create template error:", err.message);
    if (err.code === "23505") {
      return res.status(409).json({ error: "Template with same Modality + Body Part + Name already exists" });
    }
    res.status(500).json({ error: "Failed to create template" });
  }
});

// Get all templates
router.get("/report-templates", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM report_templates ORDER BY updated_at DESC");
    const templates = result.rows.map(r => ({ ...r, content: r.content }));
    res.json(templates);
  } catch (err) {
    console.error("Fetch templates error:", err.message);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// Get template by ID
router.get("/report-templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM report_templates WHERE id=$1", [id]);
    if (!result.rows.length) return res.status(404).json({ error: "Template not found" });

    const template = result.rows[0];
    template.content = template.content;
    res.json(template);
  } catch (err) {
    console.error("Fetch template error:", err.message);
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

// Update template
router.put("/report-templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { template_name, modality, body_part, template_type, content, created_by, created_by_role } = req.body;

    if (!content) return res.status(400).json({ error: "Content is required" });

    const finalTemplateName =
      template_name && template_name.trim() !== ""
        ? template_name
        : modality && body_part
        ? `${modality}_${body_part}_${template_type || "plain"}`
        : null;

    const result = await pool.query(
      `UPDATE report_templates
       SET
         template_name = COALESCE($1, template_name),
         modality = COALESCE($2, modality),
         body_part = COALESCE($3, body_part),
         template_type = COALESCE($4, template_type),
         content = $5::jsonb,
         created_by = COALESCE($6, created_by),
         created_by_role = COALESCE($7, created_by_role),
         updated_at = NOW()
       WHERE id=$8
       RETURNING *`,
      [
        finalTemplateName,
        modality || null,
        body_part || null,
        template_type || null,
        JSON.stringify(content),
        created_by || null,
        created_by_role || null,
        id
      ]
    );

    if (!result.rows.length) return res.status(404).json({ error: "Template not found" });

    const updated = result.rows[0];
    updated.content = content;

    await logAction(req, {
      event: "TEMPLATE_UPDATED",
      details: {
        template_id: updated.id,
        template_name: updated.template_name,
        modality: updated.modality,
        body_part: updated.body_part,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("Update template error:", err.message);
    if (err.code === "23505") {
      return res.status(409).json({ error: "Template with same Modality + Body Part + Name already exists" });
    }
    res.status(500).json({ error: "Failed to update template" });
  }
});

// Filter templates
router.get("/report-templates/filter", async (req, res) => {
  try {
    const { modality, body_part } = req.query;
    const conditions = [];
    const values = [];

    if (modality) {
      values.push(modality);
      conditions.push(`modality = $${values.length}`);
    }
    if (body_part) {
      values.push(body_part);
      conditions.push(`body_part = $${values.length}`);
    }

    const query = `SELECT * FROM report_templates ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY updated_at DESC`;
    const result = await pool.query(query, values);
    res.json(result.rows.map(r => ({ ...r, content: r.content })));
  } catch (err) {
    console.error("Filter templates error:", err.message);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// Delete template
router.delete("/report-templates/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("DELETE FROM report_templates WHERE id=$1 RETURNING *", [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Template not found" });

    await logAction(req, {
      event: "TEMPLATE_DELETED",
      details: {
        template_id: result.rows[0].id,
        template_name: result.rows[0].template_name,
      },
    });

    res.json({ success: true, message: "Template deleted", deleted: result.rows[0] });
  } catch (err) {
    console.error("Delete template error:", err.message);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

module.exports = router;
