const express = require("express");
const router = express.Router();
const pool = require("../db");
const { testDicomConnection } = require("../utils/dicomTest");

router.post("/ping", async (req, res) => {
  const { host, port } = req.body;
  if (!host || !port) {
    return res.status(400).json({ success: false, error: "Host and Port required" });
  }
  const result = await testDicomConnection(host, port);
  res.json(result);
});

router.get("/service-status", async (req, res) => {
  const host = process.env.MWL_SERVICE_HOST || "mwl-service";
  const port = process.env.MWL_SCP_PORT || 11112;
  
  let result = await testDicomConnection(host, port, 2000);
  
  // If first attempt fails with DNS resolution error and we're not on localhost, try localhost as fallback
  if (!result.success && (result.error.includes("EAI_AGAIN") || result.error.includes("ENOTFOUND")) && host !== "localhost") {
    console.warn(`MWL status: could not resolve ${host}, trying localhost...`);
    result = await testDicomConnection("localhost", port, 2000);
  }
  
  res.json(result);
});

async function ensureMwlTargetsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mwl_modality_targets (
      id SERIAL PRIMARY KEY,
      modality_code VARCHAR(16) NOT NULL UNIQUE,
      target_pacs_id INTEGER REFERENCES pacs(id) ON DELETE SET NULL,
      orthanc_modality_name VARCHAR(64),
      manual_host VARCHAR(128),
      manual_port INTEGER,
      manual_ae_title VARCHAR(64),
      manual_type VARCHAR(32),
      manual_protocol VARCHAR(16),
      manual_calling_ae VARCHAR(64),
      manual_called_ae VARCHAR(64),
      viewer_protocol VARCHAR(32),
      viewer_base_url VARCHAR(256),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

router.get("/options", async (req, res) => {
  try {
    await ensureMwlTargetsTable();
    const [modalitiesRes, pacsRes] = await Promise.all([
      pool.query("SELECT id, code, name FROM modalities WHERE is_active = true ORDER BY id"),
      pool.query("SELECT id, pacs_name, ae_title, ip_address, port, is_active FROM pacs ORDER BY id"),
    ]);
    return res.json({
      success: true,
      modalities: modalitiesRes.rows,
      pacs: pacsRes.rows,
    });
  } catch (err) {
    console.error("MWL target options error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to load MWL options" });
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureMwlTargetsTable();
    const result = await pool.query(`
      SELECT
        t.id,
        t.modality_code,
        t.target_pacs_id,
        t.orthanc_modality_name,
        t.manual_host,
        t.manual_port,
        t.manual_ae_title,
        t.manual_type,
        t.manual_protocol,
        t.manual_calling_ae,
        t.manual_called_ae,
        t.viewer_protocol,
        t.viewer_base_url,
        t.is_active,
        t.updated_at,
        p.pacs_name,
        p.ae_title,
        p.ip_address,
        p.port
      FROM mwl_modality_targets t
      LEFT JOIN pacs p ON p.id = t.target_pacs_id
      ORDER BY t.modality_code ASC
    `);
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("MWL target fetch error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch MWL targets" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureMwlTargetsTable();
    const {
      modality_code,
      pacs_id,
      orthanc_modality_name,
      manual_host,
      manual_port,
      manual_ae_title,
      manual_type,
      manual_protocol,
      manual_calling_ae,
      manual_called_ae,
      viewer_protocol,
      viewer_base_url,
      is_active = true,
    } = req.body || {};

    const modalityCode = String(modality_code || "").trim().toUpperCase() || "ALL";
    const hasManual = String(manual_host || "").trim() && Number(manual_port);

    if (!pacs_id && !hasManual) {
      return res.status(400).json({ success: false, error: "manual_host/manual_port required" });
    }

    const result = await pool.query(
      `
      INSERT INTO mwl_modality_targets
        (modality_code, target_pacs_id, orthanc_modality_name, manual_host, manual_port, manual_ae_title, manual_type, manual_protocol, manual_calling_ae, manual_called_ae, viewer_protocol, viewer_base_url, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (modality_code)
      DO UPDATE SET
        target_pacs_id = EXCLUDED.target_pacs_id,
        orthanc_modality_name = EXCLUDED.orthanc_modality_name,
        manual_host = EXCLUDED.manual_host,
        manual_port = EXCLUDED.manual_port,
        manual_ae_title = EXCLUDED.manual_ae_title,
        manual_type = EXCLUDED.manual_type,
        manual_protocol = EXCLUDED.manual_protocol,
        manual_calling_ae = EXCLUDED.manual_calling_ae,
        manual_called_ae = EXCLUDED.manual_called_ae,
        viewer_protocol = EXCLUDED.viewer_protocol,
        viewer_base_url = EXCLUDED.viewer_base_url,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING *
      `,
      [
        modalityCode,
        pacs_id ? Number(pacs_id) : null,
        orthanc_modality_name || null,
        manual_host || null,
        manual_port ? Number(manual_port) : null,
        manual_ae_title || null,
        manual_type || null,
        manual_protocol || null,
        manual_calling_ae || null,
        manual_called_ae || null,
        viewer_protocol || null,
        viewer_base_url || null,
        Boolean(is_active),
      ]
    );
    return res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("MWL target save error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to save MWL target" });
  }
});

router.delete("/:modalityCode", async (req, res) => {
  try {
    await ensureMwlTargetsTable();
    const modalityCode = String(req.params.modalityCode || "").trim().toUpperCase();
    const deleted = await pool.query(
      "DELETE FROM mwl_modality_targets WHERE UPPER(modality_code) = UPPER($1) RETURNING id",
      [modalityCode]
    );
    if (!deleted.rows.length) {
      return res.status(404).json({ success: false, error: "Mapping not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("MWL target delete error:", err.message);
    return res.status(500).json({ success: false, error: "Failed to delete MWL target" });
  }
});

module.exports = router;
