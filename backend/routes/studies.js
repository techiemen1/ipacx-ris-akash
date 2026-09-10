const express = require("express");
const router = express.Router();
const pool = require("../db");
const { getTenantScope } = require("../utils/tenantScope");
const { logAction } = require("../utils/auditLogger");

// =============================
// GET ALL STUDIES (Tenant Scoped)
// =============================
router.get("/", async (req, res) => {
  try {
    const scope = getTenantScope(req, "s");
    const query = `
      SELECT s.*
      FROM studies s
      WHERE ${scope.sql(1, 2)}
      ORDER BY s.created_at DESC
    `;
    const result = await pool.query(query, [scope.clinicId, scope.userId]);

    await logAction(req, {
      event: "READ_STUDY_LIST",
      page: "/api/studies",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_STUDY_LIST",
        count: result.rowCount,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({
      success: true,
      count: result.rowCount,
      studies: result.rows,
    });
  } catch (err) {
    console.error("Fetch studies error:", err.message);
    res.status(500).json({ success: false, message: "Failed to fetch studies" });
  }
});

// =============================
// GET SINGLE STUDY BY UID (Tenant Scoped)
// =============================
router.get("/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const scope = getTenantScope(req, "s");
    const query = `
      SELECT s.*
      FROM studies s
      WHERE (s.study_uid = $1 OR s.accession_number = $1)
        AND ${scope.sql(2, 3)}
      LIMIT 1
    `;
    const result = await pool.query(query, [uid, scope.clinicId, scope.userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Study not found or unauthorized" });
    }

    const study = result.rows[0];

    await logAction(req, {
      event: "READ_STUDY_DETAILS",
      page: `/api/studies/${uid}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_STUDY_DETAILS",
        target_patient_id: study.patient_id,
        study_uid: uid,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({ success: true, study });
  } catch (err) {
    console.error("Get study details error:", err.message);
    res.status(500).json({ success: false, message: "Failed to load study details" });
  }
});

// =============================
// CREATE STUDY (Tenant Scoped)
// =============================
router.post("/", async (req, res) => {
  try {
    const scope = getTenantScope(req);
    const {
      study_uid,
      patient_id,
      patient_name,
      patient_sex,
      patient_age,
      accession_number,
      study_date,
      study_time,
      study_description,
      modality,
      instances,
      source,
    } = req.body;

    if (!study_uid) {
      return res.status(400).json({ success: false, message: "study_uid is required" });
    }

    const insertQuery = `
      INSERT INTO studies (
        study_uid, patient_id, patient_name, patient_sex, patient_age,
        accession_number, study_date, study_time, study_description,
        modality, instances, source, clinic_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (study_uid)
      DO UPDATE SET
        patient_name = EXCLUDED.patient_name,
        accession_number = EXCLUDED.accession_number,
        modality = EXCLUDED.modality,
        clinic_id = EXCLUDED.clinic_id
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      study_uid,
      patient_id || null,
      patient_name || null,
      patient_sex || null,
      patient_age || null,
      accession_number || null,
      study_date || null,
      study_time || null,
      study_description || null,
      modality || null,
      instances || 0,
      source || "PACS",
      scope.clinicId,
    ]);

    const created = result.rows[0];

    await logAction(req, {
      event: "CREATE_STUDY",
      page: "/api/studies",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "CREATE_STUDY",
        target_patient_id: created.patient_id,
        study_uid: created.study_uid,
        timestamp: new Date().toISOString(),
      },
    });

    res.status(201).json({ success: true, study: created });
  } catch (err) {
    console.error("Create study error:", err.message);
    res.status(500).json({ success: false, message: "Failed to create study" });
  }
});

// =============================
// UPDATE STUDY (Tenant Scoped)
// =============================
router.put("/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const scope = getTenantScope(req);
    const { patient_name, study_description, modality, accession_number } = req.body;

    const updateQuery = `
      UPDATE studies
      SET
        patient_name = COALESCE($1, patient_name),
        study_description = COALESCE($2, study_description),
        modality = COALESCE($3, modality),
        accession_number = COALESCE($4, accession_number)
      WHERE (study_uid = $5 OR accession_number = $5)
        AND ${scope.sql(6, 7)}
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      patient_name || null,
      study_description || null,
      modality || null,
      accession_number || null,
      uid,
      scope.clinicId,
      scope.userId,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Study not found or unauthorized" });
    }

    const updated = result.rows[0];

    await logAction(req, {
      event: "UPDATE_STUDY",
      page: `/api/studies/${uid}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "UPDATE_STUDY",
        target_patient_id: updated.patient_id,
        study_uid: updated.study_uid,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({ success: true, study: updated });
  } catch (err) {
    console.error("Update study error:", err.message);
    res.status(500).json({ success: false, message: "Failed to update study" });
  }
});

// =============================
// DELETE STUDY (Tenant Scoped)
// =============================
router.delete("/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    const scope = getTenantScope(req);

    const selectResult = await pool.query(
      `SELECT patient_id, study_uid FROM studies WHERE study_uid = $1 AND ${scope.sql(2, 3)}`,
      [uid, scope.clinicId, scope.userId]
    );

    if (selectResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Study not found or unauthorized" });
    }

    const targetPatientId = selectResult.rows[0].patient_id;

    await pool.query(
      `DELETE FROM studies WHERE study_uid = $1 AND ${scope.sql(2, 3)}`,
      [uid, scope.clinicId, scope.userId]
    );

    await logAction(req, {
      event: "DELETE_STUDY",
      page: `/api/studies/${uid}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "DELETE_STUDY",
        target_patient_id: targetPatientId,
        study_uid: uid,
        timestamp: new Date().toISOString(),
      },
    });

    res.json({ success: true, message: "Study deleted successfully" });
  } catch (err) {
    console.error("Delete study error:", err.message);
    res.status(500).json({ success: false, message: "Failed to delete study" });
  }
});

module.exports = router;
