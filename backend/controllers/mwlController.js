const pool = require("../db");

async function ensureMwlDatetimeColumn() {
  await pool.query(
    "ALTER TABLE mwl ADD COLUMN IF NOT EXISTS scheduling_datetime timestamp"
  );
}

async function ensureMwlStatusColumn() {
  await pool.query("ALTER TABLE mwl ADD COLUMN IF NOT EXISTS status text DEFAULT 'NEW'");
}

function toDicomDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function toDicomTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(11, 19).replace(/:/g, "");
}

exports.getWorklist = async (req, res) => {
  try {
    await ensureMwlDatetimeColumn();
    await ensureMwlStatusColumn();
    const { modality, date } = req.query;
    const where = [];
    const params = [];

    if (modality) {
      params.push(String(modality));
      where.push(`modality = $${params.length}`);
    }

    if (date) {
      params.push(String(date));
      where.push(`schedulingdate::date = $${params.length}::date`);
    }

    const sql = `
      SELECT *
      FROM mwl
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC
    `;
    const result = await pool.query(sql, params);

    const mwlItems = result.rows.map((row) => ({
      "00100010": { vr: "PN", Value: [row.patientname || ""] },
      "00100020": { vr: "LO", Value: [String(row.patientid || "")] },
      "00100040": {
        vr: "CS",
        Value: [(row.patientsex || "O").toString().slice(0, 1).toUpperCase()],
      },
      "00080050": { vr: "SH", Value: [row.accessionnumber || ""] },
      "0020000D": { vr: "UI", Value: [row.studyinstanceuid || ""] },
      "00400001": { vr: "AE", Value: [row.modality || ""] },
      "00400002": {
        vr: "DA",
        Value: [toDicomDate(row.scheduling_datetime || row.schedulingdate)],
      },
      "00400003": {
        vr: "TM",
        Value: [toDicomTime(row.scheduling_datetime || row.schedulingdate)],
      },
      "00321060": { vr: "LO", Value: [row.studydescription || ""] },
      "00080060": { vr: "CS", Value: [row.modality || ""] },
      id: row.id,
      patient_id: row.patientid || "",
      patient_name: row.patientname || "",
      accession_number: row.accessionnumber || "",
      modality: row.modality || "",
      status: row.status || "NEW",
      scheduled_datetime: row.scheduling_datetime || row.schedulingdate || null,
    }));

    return res.json({ success: true, data: mwlItems });
  } catch (err) {
    console.error("MWL Query Error:", err);
    return res.status(500).json({ error: "MWL Error" });
  }
};
