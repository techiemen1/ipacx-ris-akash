const pool = require("../db");
const { sendMWL } = require("./mwlExporter");

const DEFAULT_MWL_TARGET_AE = process.env.DEFAULT_MWL_TARGET_AE || "IPACXPACS";

async function ensureMwlTargetsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mwl_modality_targets (
      id SERIAL PRIMARY KEY,
      modality_code VARCHAR(16) NOT NULL UNIQUE,
      pacs_id INTEGER REFERENCES pacs(id) ON DELETE SET NULL,
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
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_host VARCHAR(128)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_port INTEGER");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_ae_title VARCHAR(64)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_type VARCHAR(32)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_protocol VARCHAR(16)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_calling_ae VARCHAR(64)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS manual_called_ae VARCHAR(64)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS viewer_protocol VARCHAR(32)");
  await pool.query("ALTER TABLE mwl_modality_targets ADD COLUMN IF NOT EXISTS viewer_base_url VARCHAR(256)");
}

async function ensureMwlStatusColumn() {
  await pool.query("ALTER TABLE mwl ADD COLUMN IF NOT EXISTS status text DEFAULT 'NEW'");
}

async function ensureMwlDatetimeColumn() {
  await pool.query(
    "ALTER TABLE mwl ADD COLUMN IF NOT EXISTS scheduling_datetime timestamp"
  );
}

async function ensureSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mwl_settings (
      id INTEGER PRIMARY KEY,
      autopush_enabled BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await pool.query(
    "INSERT INTO mwl_settings (id, autopush_enabled) VALUES (1, false) ON CONFLICT (id) DO NOTHING"
  );
}

async function pickTargetPacs(modality) {
  await ensureMwlTargetsTable();
  const key = String(modality || "").toUpperCase();

  const targetConfigResult = await pool.query(
    `
    SELECT modality_code, pacs_id, orthanc_modality_name, manual_host, manual_port, manual_ae_title, manual_type, manual_protocol, manual_calling_ae, manual_called_ae
    FROM mwl_modality_targets
    WHERE UPPER(modality_code) = UPPER($1)
      AND is_active = true
    LIMIT 1
    `,
    [key]
  );
  const targetConfig = targetConfigResult.rows[0] || null;

  let targetPacs = null;
  if (targetConfig?.manual_host && targetConfig?.manual_port) {
    const manualProtocol = String(targetConfig.manual_protocol || "").trim().toUpperCase();
    if (manualProtocol === "DIMSE") {
      return null;
    }
    return {
      pacs_name: "Manual",
      pacs_type: targetConfig.manual_type || "",
      ip_address: targetConfig.manual_host,
      port: targetConfig.manual_port,
      ae_title: targetConfig.manual_ae_title || "",
    };
  }

  if (targetConfig?.pacs_id) {
    const byId = await pool.query(
      "SELECT * FROM pacs WHERE id = $1 AND is_active = true LIMIT 1",
      [targetConfig.pacs_id]
    );
    targetPacs = byId.rows[0] || null;
  }

  if (!targetPacs) {
    const target = targetConfig?.orthanc_modality_name || DEFAULT_MWL_TARGET_AE;
    const pacsResult = await pool.query(
      `
      SELECT *
      FROM pacs
      WHERE is_active = true
        AND (
          UPPER(COALESCE(ae_title, '')) = UPPER($1)
          OR UPPER(COALESCE(pacs_name, '')) = UPPER($1)
        )
      ORDER BY id ASC
      LIMIT 1
      `,
      [target]
    );
    targetPacs = pacsResult.rows[0] || null;
  }

  if (!targetPacs) {
    const fallback = await pool.query(
      "SELECT * FROM pacs WHERE is_active = true ORDER BY id ASC LIMIT 1"
    );
    targetPacs = fallback.rows[0] || null;
  }

  return targetPacs;
}

async function processDueMwl() {
  await ensureMwlStatusColumn();
  await ensureMwlDatetimeColumn();

  const dueRes = await pool.query(
    `
    SELECT *
    FROM mwl
    WHERE COALESCE(scheduling_datetime, schedulingdate) <= NOW() + INTERVAL '1 second'
      AND COALESCE(status, 'NEW') = 'NEW'
    ORDER BY id ASC
    LIMIT 25
    `
  );

  for (const entry of dueRes.rows) {
    try {
      const targetPacs = await pickTargetPacs(entry.modality || "");
      if (!targetPacs) {
        continue;
      }

      await sendMWL(targetPacs, {
        patient_name: entry.patientname || "",
        patient_id: entry.patientid || "",
        accession_number: entry.accessionnumber || "",
        requested_procedure_id: "",
        modality: entry.modality || "",
        scheduled_start: entry.scheduling_datetime || entry.schedulingdate || new Date().toISOString(),
        station_aet: targetPacs.ae_title || "",
      });

      await pool.query(
        "UPDATE mwl SET status = $1 WHERE id = $2",
        ["SYNCED", entry.id]
      );
    } catch (err) {
      console.error("Auto-push MWL failed:", err.message);
    }
  }
}

let autoPushTimer = null;
let running = false;

function startMwlAutoPushScheduler() {
  const enabled = String(process.env.MWL_AUTOPUSH_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) return;

  const intervalMs = Number(process.env.MWL_AUTOPUSH_INTERVAL_MS || 1000);
  if (autoPushTimer) return;

  autoPushTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await ensureSettingsTable();
      const settingRes = await pool.query(
        "SELECT autopush_enabled FROM mwl_settings WHERE id = 1"
      );
      const autopushEnabled =
        settingRes.rows.length === 0 ? false : Boolean(settingRes.rows[0].autopush_enabled);
      if (!autopushEnabled) return;
      await processDueMwl();
    } finally {
      running = false;
    }
  }, intervalMs);
}

module.exports = { startMwlAutoPushScheduler };
