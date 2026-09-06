const express = require("express");
const router = express.Router();
const pool = require("../db");

async function getAppointmentColumns() {
  const result = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments'
    `
  );
  return new Set(result.rows.map((r) => r.column_name));
}

async function ensureAppointmentTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.appointments (
        id SERIAL PRIMARY KEY,
        patient_id VARCHAR(100),
        patient_name VARCHAR(255),
        contact VARCHAR(50),
        appointment_date DATE,
        appointment_time TIME,
        modality VARCHAR(50),
        doctor VARCHAR(255),
        scheduled_station_aetitle VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.warn("Table auto-create notice for appointments:", e.message);
  }
}

async function ensureAppointmentStationAetColumn() {
  await ensureAppointmentTable();
  await pool.query(
    "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS scheduled_station_aetitle text"
  ).catch(() => {});
}

function pickFromRow(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return fallback;
}

function normalizeDateForDb(input) {
  if (input === undefined || input === null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return raw;
}

function formatDateForUi(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${day}`;
  }
  return String(value);
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

function mapAppointmentRow(row) {
  return {
    id: pickFromRow(row, ["id", "appointment_id"], ""),
    patientId: String(pickFromRow(row, ["patient_id", "patientid", "uhid"], "")),
    date: formatDateForUi(pickFromRow(row, ["appointment_date", "date"], "")),
    patientName: String(pickFromRow(row, ["patient_name", "name", "full_name"], "")),
    contact: String(pickFromRow(row, ["contact", "contact_number", "mobile", "phone"], "")),
    time: String(pickFromRow(row, ["appointment_time", "time"], "")),
    modality: String(pickFromRow(row, ["modality"], "")),
    doctor: String(pickFromRow(row, ["doctor", "referring_doctor", "attending_physician"], "")),
    status: String(pickFromRow(row, ["status"], "Pending")),
    scheduled_station_aetitle: String(
      pickFromRow(row, ["scheduled_station_aetitle", "station_aet", "station_aetitle"], "")
    ),
  };
}

function setFirstAvailable(record, columns, candidates, value) {
  for (const c of candidates) {
    if (columns.has(c)) {
      record[c] = value;
      return c;
    }
  }
  return null;
}

function normalizeTimeForDb(input) {
  if (input === undefined || input === null) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  const m = raw.match(/^(\d{1,2})(?:[:.](\d{1,2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = Number(m[1]);
    const mm = Number(m[2] || "0");
    const mer = (m[3] || "").toLowerCase();

    if (Number.isNaN(h) || Number.isNaN(mm) || h > 23 || mm > 59) return raw;

    if (mer === "am") {
      if (h === 12) h = 0;
    } else if (mer === "pm") {
      if (h < 12) h += 12;
    }

    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  }

  const m24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (m24) {
    return `${String(Number(m24[1])).padStart(2, "0")}:${m24[2]}:${m24[3] || "00"}`;
  }

  return raw;
}

router.get("/scheduled-ids", async (req, res) => {
  try {
    const columns = await getAppointmentColumns();
    const patientIdCol = ["patient_id", "patientid", "uhid"].find((c) => columns.has(c));

    if (!patientIdCol) {
      return res.json({ success: true, ids: [] });
    }

    const statusCol = columns.has("status") ? "status" : null;
    const query = statusCol
      ? `SELECT DISTINCT ${patientIdCol}::text AS patient_id FROM appointments WHERE COALESCE(${statusCol}, '') <> ''`
      : `SELECT DISTINCT ${patientIdCol}::text AS patient_id FROM appointments`;

    const result = await pool.query(query);
    const ids = result.rows
      .map((r) => String(r.patient_id || "").trim())
      .filter(Boolean);

    return res.json({ success: true, ids });
  } catch (err) {
    console.error("Error fetching scheduled ids:", err.message);
    return res.status(500).json({ success: false, error: "Failed to fetch scheduled ids" });
  }
});

router.get("/", async (req, res) => {
  const { date } = req.query;

  try {
    await ensureAppointmentTable();
    const columns = await getAppointmentColumns();
    const dateCol = ["appointment_date", "date"].find((c) => columns.has(c));
    const timeCol = ["appointment_time", "time"].find((c) => columns.has(c));

    let query = "SELECT * FROM appointments";
    const params = [];

    if (date && dateCol) {
      params.push(date);
      query += ` WHERE ${dateCol}::text = $1`;
    }

    if (timeCol) {
      query += ` ORDER BY ${timeCol} ASC`;
    } else {
      query += " ORDER BY 1 ASC";
    }

    const result = await pool.query(query, params);
    const rows = result.rows.map(mapAppointmentRow);

    const withContacts = await Promise.all(
      rows.map(async (r) => {
        if (String(r.contact || "").trim() || !String(r.patientId || "").trim()) return r;
        try {
          const patientRes = await pool.query(
            `
            SELECT mobile, phone
            FROM patients
            WHERE uhid::text = $1 OR patient_id::text = $1 OR mrn::text = $1
            LIMIT 1
            `,
            [String(r.patientId)]
          );
          if (patientRes.rowCount > 0) {
            return { ...r, contact: patientRes.rows[0].mobile || patientRes.rows[0].phone || "" };
          }
          return r;
        } catch {
          return r;
        }
      })
    );

    return res.json(withContacts);
  } catch (err) {
    console.error("Error fetching appointments:", err.message);
    return res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

router.post("/", async (req, res) => {
  try {
    await ensureAppointmentStationAetColumn();
    let {
      patientId,
      patientName,
      contact,
      time,
      modality,
      doctor,
      status,
      date,
      scheduled_station_aetitle,
    } = req.body || {};

    if (!date) {
      return res.status(400).json({ success: false, error: "date is required" });
    }

    if (!String(patientId || "").trim()) {
      patientId = await generateNextPatientId();
    }

    const columns = await getAppointmentColumns();
    const patientIdCol = ["patient_id", "patientid", "uhid"].find((c) => columns.has(c));
    const idCol = ["id", "appointment_id"].find((c) => columns.has(c));

    if (!patientIdCol) {
      return res.status(500).json({
        success: false,
        error: "appointments table is missing patient id column",
      });
    }

    const existing = await pool.query(
      `SELECT * FROM appointments WHERE ${patientIdCol}::text = $1 LIMIT 1`,
      [String(patientId)]
    );

    const payload = {};
    let contactValue = contact || null;
    let patientNameValue = patientName || null;

    if (!contactValue || !patientNameValue) {
      try {
        const patientRes = await pool.query(
          `
          SELECT *
          FROM patients
          WHERE uhid::text = $1 OR patient_id::text = $1 OR mrn::text = $1
          LIMIT 1
          `,
          [String(patientId)]
        );
        if (patientRes.rowCount > 0) {
          const p = patientRes.rows[0];
          if (!contactValue) {
            contactValue = p.mobile || p.phone || null;
          }
          if (!patientNameValue) {
            patientNameValue =
              `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
              p.full_name ||
              null;
          }
        }
      } catch (lookupErr) {
        console.error("Appointment patient lookup failed:", lookupErr.message);
      }
    }

    setFirstAvailable(payload, columns, [patientIdCol], String(patientId));
    setFirstAvailable(payload, columns, ["patient_name", "name", "full_name"], patientNameValue);
    setFirstAvailable(
      payload,
      columns,
      ["contact", "contact_number", "contact_no", "mobile", "phone"],
      contactValue
    );
    setFirstAvailable(payload, columns, ["appointment_date", "date"], normalizeDateForDb(date));
    setFirstAvailable(payload, columns, ["appointment_time", "time"], normalizeTimeForDb(time));
    setFirstAvailable(payload, columns, ["modality"], modality || null);
    setFirstAvailable(payload, columns, ["doctor", "referring_doctor", "attending_physician"], doctor || null);
    setFirstAvailable(
      payload,
      columns,
      ["scheduled_station_aetitle", "station_aet", "station_aetitle"],
      scheduled_station_aetitle || null
    );
    setFirstAvailable(payload, columns, ["status"], status || "Pending");
    setFirstAvailable(payload, columns, ["updated_at"], new Date());

    let saved;
    if (existing.rowCount > 0) {
      const row = existing.rows[0];
      const whereCol = idCol && row[idCol] !== undefined ? idCol : patientIdCol;
      const whereValue = whereCol === patientIdCol ? String(patientId) : row[whereCol];
      const setCols = Object.keys(payload);
      const setClause = setCols.map((c, i) => `${c} = $${i + 1}`).join(", ");
      const values = setCols.map((c) => payload[c]);
      values.push(whereValue);

      const updated = await pool.query(
        `UPDATE appointments SET ${setClause} WHERE ${whereCol} = $${values.length} RETURNING *`,
        values
      );
      saved = updated.rows[0];
    } else {
      setFirstAvailable(payload, columns, ["created_at"], new Date());
      const cols = Object.keys(payload);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const values = cols.map((c) => payload[c]);
      const inserted = await pool.query(
        `INSERT INTO appointments (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      saved = inserted.rows[0];
    }

    return res.json({ success: true, appointment: mapAppointmentRow(saved) });
  } catch (err) {
    console.error("Error saving appointment:", err.message);
    return res.status(500).json({ success: false, error: "Failed to save appointment" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    await ensureAppointmentStationAetColumn();
    const { id } = req.params;
    const {
      patientId,
      patientName,
      contact,
      time,
      modality,
      doctor,
      status,
      date,
      scheduled_station_aetitle,
    } = req.body || {};

    const columns = await getAppointmentColumns();
    const idCol = ["id", "appointment_id"].find((c) => columns.has(c));
    const patientIdCol = ["patient_id", "patientid", "uhid"].find((c) => columns.has(c));
    if (!idCol) {
      return res.status(500).json({ success: false, error: "appointments table is missing id column" });
    }

    const payload = {};
    if (patientIdCol && patientId !== undefined) setFirstAvailable(payload, columns, [patientIdCol], String(patientId));
    if (patientName !== undefined) setFirstAvailable(payload, columns, ["patient_name", "name", "full_name"], patientName || null);
    if (contact !== undefined) setFirstAvailable(payload, columns, ["contact", "contact_number", "contact_no", "mobile", "phone"], contact || null);
    if (date !== undefined) setFirstAvailable(payload, columns, ["appointment_date", "date"], normalizeDateForDb(date));
    if (time !== undefined) setFirstAvailable(payload, columns, ["appointment_time", "time"], normalizeTimeForDb(time));
    if (modality !== undefined) setFirstAvailable(payload, columns, ["modality"], modality || null);
    if (doctor !== undefined) setFirstAvailable(payload, columns, ["doctor", "referring_doctor", "attending_physician"], doctor || null);
    if (scheduled_station_aetitle !== undefined)
      setFirstAvailable(
        payload,
        columns,
        ["scheduled_station_aetitle", "station_aet", "station_aetitle"],
        scheduled_station_aetitle || null
      );
    if (status !== undefined) setFirstAvailable(payload, columns, ["status"], status || "Pending");
    setFirstAvailable(payload, columns, ["updated_at"], new Date());

    const setCols = Object.keys(payload);
    if (!setCols.length) {
      return res.status(400).json({ success: false, error: "No fields to update" });
    }
    const setClause = setCols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const values = setCols.map((c) => payload[c]);
    values.push(id);

    const updated = await pool.query(
      `UPDATE appointments SET ${setClause} WHERE ${idCol}::text = $${values.length} RETURNING *`,
      values
    );
    if (updated.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }
    return res.json({ success: true, appointment: mapAppointmentRow(updated.rows[0]) });
  } catch (err) {
    console.error("Error updating appointment:", err.message);
    return res.status(500).json({ success: false, error: "Failed to update appointment" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const columns = await getAppointmentColumns();
    const idCol = ["id", "appointment_id"].find((c) => columns.has(c));
    if (!idCol) {
      return res.status(500).json({ success: false, error: "appointments table is missing id column" });
    }
    const result = await pool.query(
      `DELETE FROM appointments WHERE ${idCol}::text = $1 RETURNING *`,
      [String(id)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Appointment not found" });
    }
    return res.json({ success: true, deleted: mapAppointmentRow(result.rows[0]) });
  } catch (err) {
    console.error("Error deleting appointment:", err.message);
    return res.status(500).json({ success: false, error: "Failed to delete appointment" });
  }
});

module.exports = router;
