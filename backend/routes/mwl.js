const express = require("express");
const router = express.Router();
const axios = require("axios");
const pool = require("../db");
const { sendMWL } = require("../services/mwlExporter");
const { exportDimseWorklist } = require("../services/mwlDimseExport");
const { checkTcpReachable } = require("../services/mwlConnectivity");

const ORTHANC_URL = process.env.ORTHANC_URL;
const ORTHANC_AUTH = {
  username: process.env.ORTHANC_USER,
  password: process.env.ORTHANC_PASS,
};
const DEFAULT_MWL_TARGET_AE = process.env.DEFAULT_MWL_TARGET_AE || "IPACXPACS";
const ACCESSION_SEQ_NAME = "mwl_accession_seq";
const ACCESSION_START = 100001;

async function ensureMwlDatetimeColumn() {
  return;
}

async function ensureMwlStatusColumn() {
  return;
}

async function ensureMwlStationAetColumn() {
  return;
}

async function ensureAccessionSequence() {
  await pool.query(
    `CREATE SEQUENCE IF NOT EXISTS ${ACCESSION_SEQ_NAME} START WITH ${ACCESSION_START} INCREMENT BY 1`
  );
  try {
    const maxRes = await pool.query(
      "SELECT MAX(CASE WHEN accessionnumber ~ '^[0-9]+$' THEN accessionnumber::bigint END) AS max_acc FROM mwl"
    );
    const maxAcc = maxRes.rows?.[0]?.max_acc;
    if (maxAcc && maxAcc >= ACCESSION_START) {
      await pool.query(`SELECT setval('${ACCESSION_SEQ_NAME}', $1, true)`, [maxAcc]);
    }
  } catch (err) {
    console.error("ensure accession sequence", err.message);
  }
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function buildPatientId(year, month, seq) {
  return `${year}${String(month).padStart(2, "0")}${pad3(seq)}`;
}

async function generateNextPatientId() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const prefix = `${year}${String(month).padStart(2, "0")}`;

  const result = await pool.query(
    `
    SELECT patient_id
    FROM patients
    WHERE patient_id LIKE $1
    ORDER BY patient_id DESC
    LIMIT 1
    `,
    [`${prefix}%`]
  );

  let nextSeq = 1;
  if (result.rowCount > 0 && result.rows[0]?.patient_id) {
    const raw = String(result.rows[0].patient_id);
    if (raw.includes("/")) {
      const parts = raw.split("/");
      const last = Number(parts[2]);
      if (!Number.isNaN(last)) nextSeq = last + 1;
    } else {
      const last = Number(raw.slice(-3));
      if (!Number.isNaN(last)) nextSeq = last + 1;
    }
  }

  return buildPatientId(year, month, nextSeq);
}

async function backfillSchedulingDatetime() {
  await pool.query(
    "UPDATE mwl SET scheduling_datetime = schedulingdate WHERE scheduling_datetime IS NULL"
  );
}

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
}

function pick(row, keys, fallback = "") {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
      return row[k];
    }
  }
  return fallback;
}

function toWorklistItem(row, opts = {}) {
  const patientId = String(pick(row, ["patientid", "patient_id"], ""));
  const patientName = String(pick(row, ["patientname", "patient_name"], ""));
  const patientSex = String(pick(row, ["patientsex", "patient_sex"], "O"));
  const accession = String(pick(row, ["accessionnumber", "accession_number"], ""));
  const studyUid = String(pick(row, ["studyinstanceuid", "study_instance_uid"], ""));
  const modality = String(pick(row, ["modality"], ""));
  const schedule = pick(row, ["scheduling_datetime", "schedulingdate", "scheduled_datetime"], null);
  const description = String(pick(row, ["studydescription", "study_description"], ""));
  const status = String(pick(row, ["status"], "NEW"));
  const stationAet = String(
    pick(
      opts,
      ["stationAet", "scheduledstationaetitle"],
      pick(row, ["scheduledstationaetitle", "station_aet"], "")
    )
  );
  const now = new Date();
  const scheduleDate = schedule ? new Date(schedule) : now;
  const dicomDate = scheduleDate.toISOString().slice(0, 10).replace(/-/g, "");
  const dicomTime = scheduleDate.toISOString().slice(11, 19).replace(/:/g, "");

  return {
    // DICOM JSON fields
    "00100010": { vr: "PN", Value: [{ Alphabetic: patientName }] },
    "00100020": { vr: "LO", Value: [patientId] },
    "00100040": { vr: "CS", Value: [patientSex.slice(0, 1).toUpperCase()] },
    "00080050": { vr: "SH", Value: [accession] },
    "0020000D": { vr: "UI", Value: [studyUid] },
    "00400001": { vr: "AE", Value: [stationAet] },
    "00400002": { vr: "DA", Value: [dicomDate] },
    "00400003": { vr: "TM", Value: [dicomTime] },
    "00321060": { vr: "LO", Value: [description] },
    "00080060": { vr: "CS", Value: [modality] },
    "00400100": {
      vr: "SQ",
      Value: [
        {
          "00400001": { vr: "AE", Value: [stationAet] },
          "00400002": { vr: "DA", Value: [dicomDate] },
          "00400003": { vr: "TM", Value: [dicomTime] },
          "00080060": { vr: "CS", Value: [modality] },
        },
      ],
    },
    // Flat fields for frontend
    id: row.id,
    patient_id: patientId,
    patient_name: patientName,
    accession_number: accession,
    modality,
    status,
    scheduled_datetime: schedule,
    study_instance_uid: studyUid,
    created_at: row.created_at || null,
    pacs_id: row.pacs_id || null,
    status: row.status || "NEW",
    scheduled_station_aetitle: stationAet,
  };
}

function toLegacyRow(item) {
  return {
    id: item.id,
    patientid: item.patient_id,
    patientname: item.patient_name,
    patientsex: item["00100040"]?.Value?.[0] || "O",
    patientage: "",
    accessionnumber: item.accession_number || "",
    studydescription: item["00321060"]?.Value?.[0] || "",
    schedulingdate: item.scheduled_datetime,
    modality: item.modality,
    bodypartexamined: "",
    referringphysician: "",
    status: item.status || "NEW",
  };
}

function normalizeInput(body = {}) {
  return {
    id: body.id || null,
    pacs_id: body.pacs_id || null,
    patient_id: body.patient_id || body.PatientID || "",
    patient_name: body.patient_name || body.PatientName || "",
    patient_sex: body.patient_sex || body.PatientSex || "O",
    patient_age: body.patient_age || body.PatientAge || "N/A",
    accession_number: body.accession_number || body.AccessionNumber || "",
    study_description: body.study_description || body.StudyDescription || "",
    scheduling_datetime: body.scheduled_datetime || body.SchedulingDate || new Date().toISOString(),
    modality: body.modality || body.Modality || "",
    body_part_examined: body.body_part_examined || body.BodyPartExamined || "",
    referring_physician: body.referring_physician || body.ReferringPhysician || "",
    study_instance_uid: body.study_instance_uid || body.StudyInstanceUID || "",
    scheduled_station_aetitle:
      body.scheduled_station_aetitle ||
      body.scheduledStationAETitle ||
      body.station_aet ||
      body.StationAETitle ||
      "",
  };
}

router.post("/", async (req, res) => {
  try {
    await ensureMwlDatetimeColumn();
    await ensureMwlStatusColumn();
    await ensureMwlStationAetColumn();
    await ensureAccessionSequence();
    await backfillSchedulingDatetime();
    const entry = normalizeInput(req.body);
    if (!entry.patient_name || !entry.modality) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!String(entry.patient_id || "").trim()) {
      entry.patient_id = await generateNextPatientId();
    }

    const result = await pool.query(
      `INSERT INTO mwl
       (PatientID, PatientName, PatientSex, PatientAge,
        AccessionNumber, StudyDescription, SchedulingDate, scheduling_datetime,
        Modality, BodyPartExamined, ReferringPhysician, status, ScheduledStationAETitle)
       VALUES ($1,$2,$3,$4,
               COALESCE(NULLIF($5::text, ''), nextval('${ACCESSION_SEQ_NAME}')::text),
               $6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        entry.patient_id || "",
        entry.patient_name,
        entry.patient_sex || "O",
        entry.patient_age || "N/A",
        entry.accession_number || "",
        entry.study_description || "",
        entry.scheduling_datetime || new Date(),
        entry.scheduling_datetime || new Date(),
        entry.modality,
        entry.body_part_examined || "",
        entry.referring_physician || "",
        "NEW",
        entry.scheduled_station_aetitle || "",
      ]
    );

    res.json({ message: "Added to MWL successfully", entry: result.rows[0] });
  } catch (err) {
    console.error("MWL add error:", err.message);
    res.status(500).json({ error: "Failed to add MWL" });
  }
});

router.post("/register", async (req, res) => {
  try {
    await ensureMwlDatetimeColumn();
    await ensureMwlStatusColumn();
    await ensureMwlStationAetColumn();
    await ensureAccessionSequence();
    await backfillSchedulingDatetime();
    const entry = normalizeInput(req.body);
    if (!entry.patient_name || !entry.modality) {
      return res.status(400).json({ error: "PatientName and Modality are required" });
    }
    if (!String(entry.patient_id || "").trim()) {
      entry.patient_id = await generateNextPatientId();
    }

    const created = await pool.query(
      `INSERT INTO mwl
       (PatientID, PatientName, PatientSex, PatientAge,
        AccessionNumber, StudyDescription, SchedulingDate, scheduling_datetime,
        Modality, BodyPartExamined, ReferringPhysician, status, ScheduledStationAETitle)
       VALUES ($1,$2,$3,$4,
               COALESCE(NULLIF($5::text, ''), nextval('${ACCESSION_SEQ_NAME}')::text),
               $6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        entry.patient_id || "",
        entry.patient_name,
        entry.patient_sex || "O",
        entry.patient_age || "N/A",
        entry.accession_number || "",
        entry.study_description || "",
        entry.scheduling_datetime || new Date(),
        entry.scheduling_datetime || new Date(),
        entry.modality,
        entry.body_part_examined || "",
        entry.referring_physician || "",
        "NEW",
        entry.scheduled_station_aetitle || "",
      ]
    );

    const row = created.rows[0];
    const response = { success: true, status: "NEW", data: toWorklistItem(row) };

    if (entry.pacs_id) {
      try {
        const pacsResult = await pool.query("SELECT * FROM pacs WHERE id = $1 LIMIT 1", [entry.pacs_id]);
        const pacs = pacsResult.rows[0];
        if (!pacs) {
          response.warning = `PACS ${entry.pacs_id} not found`;
        } else {
          await sendMWL(pacs, {
            patient_name: row.patientname,
            patient_id: row.patientid,
            accession_number: row.accessionnumber,
            requested_procedure_id: "",
            modality: row.modality,
            scheduled_start: row.schedulingdate,
            station_aet: pacs.ae_title || "",
          });
          response.status = "SYNCED";
        }
      } catch (pushErr) {
        console.error("MWL register push error:", pushErr.message);
        response.status = "FAILED";
        response.error = pushErr.message;
      }
    }

    return res.json(response);
  } catch (err) {
    console.error("MWL register error:", err.message);
    return res.status(500).json({ success: false, error: "MWL register failed" });
  }
});

router.get("/next-accession", async (req, res) => {
  try {
    await ensureAccessionSequence();
    const result = await pool.query(
      `SELECT nextval('${ACCESSION_SEQ_NAME}')::text AS accession_number`
    );
    return res.json({ accession_number: result.rows?.[0]?.accession_number || "" });
  } catch (err) {
    console.error("MWL next accession error:", err.message);
    return res.status(500).json({ error: "Failed to generate accession" });
  }
});

router.get("/next-patient-id", async (req, res) => {
  try {
    const patientId = await generateNextPatientId();
    return res.json({ patient_id: patientId || "" });
  } catch (err) {
    console.error("MWL next patient id error:", err.message);
    return res.status(500).json({ error: "Failed to generate patient id" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { modality, scheduled_date: scheduledDate, date, q, legacy } = req.query;
    const where = [];
    const params = [];

    if (modality) {
      params.push(String(modality));
      where.push(`modality = $${params.length}`);
    }

    const dateValue = scheduledDate || date;
    if (dateValue) {
      params.push(String(dateValue));
      where.push(`schedulingdate::date = $${params.length}::date`);
    }

    if (q) {
      params.push(`%${String(q).toLowerCase()}%`);
      const idx = params.length;
      where.push(`(
        LOWER(COALESCE(patientname, '')) LIKE $${idx}
        OR LOWER(COALESCE(patientid, '')) LIKE $${idx}
        OR LOWER(COALESCE(accessionnumber, '')) LIKE $${idx}
      )`);
    }

    const sql = `
      SELECT *
      FROM mwl
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
    `;

    const result = await pool.query(sql, params);

    let stationMap = {};
    try {
      const targets = await pool.query(
        `
        SELECT
          t.modality_code,
          t.manual_calling_ae,
          t.manual_called_ae,
          t.manual_ae_title,
          p.ae_title AS pacs_ae_title
        FROM mwl_modality_targets t
        LEFT JOIN pacs p ON p.id = t.pacs_id
        WHERE t.is_active = true
        `
      );
      stationMap = targets.rows.reduce((acc, row) => {
        const key = String(row.modality_code || "").toUpperCase();
        if (!key) return acc;
        acc[key] =
          row.manual_calling_ae ||
          row.manual_called_ae ||
          row.manual_ae_title ||
          row.pacs_ae_title ||
          acc[key] ||
          "";
        return acc;
      }, {});
    } catch (mapErr) {
      console.warn("MWL station AE mapping not available:", mapErr.message);
    }

    const mwlItems = result.rows.map((row) => {
      const key = String(row.modality || "").toUpperCase();
      const stationAet = row.scheduledstationaetitle || stationMap[key] || "";
      return toWorklistItem(row, { stationAet });
    });

    if (legacy === "1") {
      return res.json(mwlItems.map(toLegacyRow));
    }
    return res.json({ success: true, data: mwlItems });
  } catch (err) {
    console.error("MWL fetch error:", err.message);
    return res.status(500).json({ success: false, error: "MWL Error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM mwl WHERE id=$1 RETURNING *", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "MWL entry not found" });
    res.json({ message: "MWL entry deleted", deleted: result.rows[0] });
  } catch (err) {
    console.error("MWL delete error:", err.message);
    res.status(500).json({ error: "Failed to delete MWL" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await ensureMwlDatetimeColumn();
    await ensureMwlStatusColumn();
    await ensureMwlStationAetColumn();
    await backfillSchedulingDatetime();
    const entry = normalizeInput(req.body);
    const result = await pool.query(
      `UPDATE mwl SET
       PatientID=$1, PatientName=$2, PatientSex=$3, PatientAge=$4,
       AccessionNumber=$5, StudyDescription=$6, SchedulingDate=$7, scheduling_datetime=$8,
       Modality=$9, BodyPartExamined=$10, ReferringPhysician=$11, ScheduledStationAETitle=$12
       WHERE id=$13 RETURNING *`,
      [
        entry.patient_id,
        entry.patient_name,
        entry.patient_sex,
        entry.patient_age,
        entry.accession_number,
        entry.study_description,
        entry.scheduling_datetime,
        entry.scheduling_datetime,
        entry.modality,
        entry.body_part_examined,
        entry.referring_physician,
        entry.scheduled_station_aetitle || "",
        req.params.id,
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: "MWL entry not found" });
    res.json({ message: "MWL updated", entry: result.rows[0] });
  } catch (err) {
    console.error("MWL update error:", err.message);
    res.status(500).json({ error: "Failed to update MWL" });
  }
});

router.post("/:id/send", async (req, res) => {
  let target = "";
  let targetServer = null;
  let usingManualTarget = false;
  try {
    await ensureMwlStatusColumn();
    await ensureMwlTargetsTable();

    let { modality, orthancModalityName } = req.body;
    const result = await pool.query("SELECT * FROM mwl WHERE id=$1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "MWL entry not found" });

    const entry = result.rows[0];
    modality = modality || entry.modality;
    if (!modality && !orthancModalityName) {
      return res.status(400).json({ error: "No modality available to send" });
    }

    const MODALITY_MAP = {
      CT: DEFAULT_MWL_TARGET_AE,
      MR: DEFAULT_MWL_TARGET_AE,
      MRI: DEFAULT_MWL_TARGET_AE,
      US: DEFAULT_MWL_TARGET_AE,
      ULTRASOUND: DEFAULT_MWL_TARGET_AE,
      CR: DEFAULT_MWL_TARGET_AE,
      DX: DEFAULT_MWL_TARGET_AE,
      "X-RAY": DEFAULT_MWL_TARGET_AE,
      XRAY: DEFAULT_MWL_TARGET_AE,
      MG: DEFAULT_MWL_TARGET_AE,
      NM: DEFAULT_MWL_TARGET_AE,
    };
    const key = String(modality).toUpperCase();
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
    if (!targetConfig) {
      return res.status(400).json({
        error: `No active MWL mapping found for modality ${key}`,
        details: { modality: key },
      });
    }
    if (!orthancModalityName && targetConfig?.orthanc_modality_name) {
      orthancModalityName = targetConfig.orthanc_modality_name;
    }

    let targetPacs = null;

    if (targetConfig?.manual_host && targetConfig?.manual_port) {
      const manualProtocol = String(targetConfig.manual_protocol || "").trim().toUpperCase();
      const manualType = String(targetConfig.manual_type || "").trim().toUpperCase();
      const isDimse = manualProtocol === "DIMSE" || manualType === "DIMSE";
      if (isDimse) {
        try {
          await checkTcpReachable(
            targetConfig.manual_host,
            targetConfig.manual_port,
            Number(process.env.MWL_TARGET_CONNECT_TIMEOUT_MS || 3000)
          );
        } catch (err) {
          const msg = `Target not reachable at ${targetConfig.manual_host}:${targetConfig.manual_port}`;
          const e = new Error(msg);
          e.statusCode = 502;
          e.publicMessage = msg;
          e.code = err?.code || "MWL_TARGET_UNREACHABLE";
          e.cause = err;
          throw e;
        }
        const exported = await exportDimseWorklist(entry, {
          outDir: process.env.MWL_DIMSE_OUT_DIR,
        });
        await pool.query(
          "UPDATE mwl SET status = $1 WHERE id = $2",
          ["QUEUED", req.params.id]
        );
        return res.json({
          success: true,
          mode: "dimse_export",
          status: "QUEUED",
          message:
            "DIMSE MWL uses modality pull (C-FIND). Worklist exported for MWL SCP.",
          files: {
            json: exported.jsonPath,
            wl: exported.wlPath,
            directory: exported.outDir,
          },
          target: `${targetConfig.manual_host}:${targetConfig.manual_port}`,
        });
      }
      if (!manualType) {
        return res.status(400).json({
          error: "Manual MWL target requires manual_type (ORTHANC/DCM4CHEE)",
          details: {
            modality: key,
            target: "manual",
          },
        });
      }
      usingManualTarget = true;
      targetPacs = {
        pacs_name: "Manual",
        pacs_type: manualType,
        ip_address: targetConfig.manual_host,
        port: targetConfig.manual_port,
        ae_title: targetConfig.manual_ae_title || "",
      };
      target = targetPacs.ae_title || "Manual";
      targetServer = `${targetPacs.ip_address}:${targetPacs.port}`;
    } else if (targetConfig?.pacs_id) {
      const byId = await pool.query(
        `SELECT * FROM pacs WHERE id = $1 AND is_active = true LIMIT 1`,
        [targetConfig.pacs_id]
      );
      targetPacs = byId.rows[0] || null;
      target = targetPacs?.ae_title || targetPacs?.pacs_name || "";
      if (targetPacs) targetServer = `${targetPacs.ip_address}:${targetPacs.port}`;
    }

    if (!targetPacs) {
      return res.status(400).json({
        error: `No MWL target configured for modality ${key}`,
        details: { modality: key },
      });
    }

    // Preferred: push MWL JSON to selected target PACS endpoint.
    if (targetPacs) {
      try {
        await checkTcpReachable(
          targetPacs.ip_address,
          targetPacs.port,
          Number(process.env.MWL_TARGET_CONNECT_TIMEOUT_MS || 3000)
        );
      } catch (err) {
        const msg = `Target not reachable at ${targetPacs.ip_address}:${targetPacs.port}`;
        const e = new Error(msg);
        e.statusCode = 502;
        e.publicMessage = msg;
        e.code = err?.code || "MWL_TARGET_UNREACHABLE";
        e.cause = err;
        throw e;
      }
      const stationAet =
        entry.scheduledstationaetitle ||
        targetConfig?.manual_calling_ae ||
        targetConfig?.manual_called_ae ||
        targetConfig?.manual_ae_title ||
        "";
      const pushed = await sendMWL(targetPacs, {
        patient_name: entry.patientname || "",
        patient_id: entry.patientid || "",
        accession_number: entry.accessionnumber || "",
        requested_procedure_id: "",
        modality: entry.modality || "",
        scheduled_start: entry.schedulingdate || new Date().toISOString(),
        station_aet: stationAet || "",
      });
      await pool.query(
        "UPDATE mwl SET status = $1 WHERE id = $2",
        ["SYNCED", req.params.id]
      );
      return res.json({
        success: true,
        sentTo: target || targetPacs.ae_title || targetPacs.pacs_name,
        mode: "mwl_json_push",
        endpoint: pushed.url,
        server: targetServer || `${targetPacs.ip_address}:${targetPacs.port}`,
      });
    }
    return res.status(404).json({
      error: `No active PACS found. Enable one PACS row in PACS Management.`,
    });
  } catch (err) {
    const upstream = err?.response?.data || err?.cause?.response?.data || null;
    const responseStatus = err?.response?.status;
    const statusCode =
      err?.statusCode ||
      (typeof responseStatus === "number" && responseStatus >= 400 ? responseStatus : null) ||
      (err?.code ? 502 : 500);
    const publicMessage =
      err?.publicMessage ||
      (typeof upstream === "string" ? upstream : upstream?.Message || upstream?.OrthancError) ||
      err?.message ||
      "Failed to send MWL";
    res.status(statusCode).json({
      error: publicMessage,
      details: upstream || err.message,
      meta: {
        code: err?.code || null,
        message: err?.message || null,
        response_status: responseStatus || null,
        target: typeof target === "string" ? target : null,
        server: targetServer || null,
        manual: usingManualTarget || false,
      },
    });
  }
});

module.exports = router;
