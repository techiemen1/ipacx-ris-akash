const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("../db");

let tableReadyPromise = null;
let archiveSchedulerStarted = false;

const IST_TIME_ZONE = "Asia/Kolkata";
const AUDIT_ARCHIVE_DIR = path.join(__dirname, "..", "..", "logs", "audit");
const PROJECT_ROOT = path.join(__dirname, "..", "..");

function ensureAuditTable() {
  if (tableReadyPromise) return tableReadyPromise;
  tableReadyPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT,
      username TEXT,
      role TEXT,
      event TEXT NOT NULL,
      page TEXT,
      details JSONB,
      ip_address TEXT,
      user_agent TEXT,
      log_date DATE DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );
    
    ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS log_date DATE DEFAULT (NOW() AT TIME ZONE 'Asia/Kolkata')::date;

    UPDATE audit_logs
    SET log_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date
    WHERE log_date IS NULL;

    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_log_date ON audit_logs(log_date DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id ON audit_logs(session_id);

    CREATE TABLE IF NOT EXISTS audit_log_archives (
      id BIGSERIAL PRIMARY KEY,
      log_date DATE NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      archived_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_archives_log_date ON audit_log_archives(log_date DESC);
  `);
  return tableReadyPromise;
}

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const normalize = (ip) => {
    const value = String(ip || "").trim();
    if (!value) return "";
    if (value.startsWith("::ffff:")) return value.replace("::ffff:", "");
    return value;
  };
  if (typeof fwd === "string" && fwd.trim()) {
    return normalize(fwd.split(",")[0].trim());
  }
  return normalize(req.ip || req.socket?.remoteAddress || "");
}

function newSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

async function writeAuditLog({
  session_id = null,
  username = null,
  role = null,
  event,
  page = null,
  details = null,
  ip_address = null,
  user_agent = null,
}) {
  if (!event) return;
  await ensureAuditTable();
  await pool.query(
    `
      INSERT INTO audit_logs
      (session_id, username, role, event, page, details, ip_address, user_agent, log_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(NOW() AT TIME ZONE 'Asia/Kolkata')::date)
    `,
    [session_id, username, role, event, page, details, ip_address, user_agent]
  );
}

function getISTDateParts(baseDate = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(baseDate);
  const map = {};
  parts.forEach((p) => {
    if (p.type !== "literal") map[p.type] = p.value;
  });
  return { year: map.year, month: map.month, day: map.day };
}

function getISTDateString(baseDate = new Date()) {
  const { year, month, day } = getISTDateParts(baseDate);
  return `${year}-${month}-${day}`;
}

function getISTDateNDaysAgo(n, baseDate = new Date()) {
  const d = new Date(baseDate.getTime());
  d.setDate(d.getDate() - n);
  return getISTDateString(d);
}

function ensureArchiveDir() {
  if (!fs.existsSync(AUDIT_ARCHIVE_DIR)) {
    fs.mkdirSync(AUDIT_ARCHIVE_DIR, { recursive: true });
  }
}

function resolveArchivePath(filePath) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
}

function isReadableArchivePath(filePath) {
  return String(filePath || "").includes("audit-readable-");
}

function toArchiveLine(row) {
  return JSON.stringify({
    id: row.id,
    session_id: row.session_id,
    username: row.username,
    role: row.role,
    event: row.event,
    page: row.page,
    details: row.details,
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    log_date: row.log_date,
    created_at: row.created_at,
  });
}

function formatDetails(details) {
  if (!details) return "-";
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

function toReadableArchiveLine(row) {
  const time = row.created_at
    ? new Date(row.created_at).toLocaleString("en-IN")
    : "-";
  return [
    time,
    row.username || "-",
    row.role || "-",
    row.event || "-",
    row.page || "-",
    row.ip_address || "-",
    row.session_id || "-",
    formatDetails(row.details),
  ].join(" | ");
}

async function archiveLogDate(logDate) {
  await ensureAuditTable();
  if (!logDate) return { archived: false, reason: "no_date" };

  const rowsRes = await pool.query(
    `
      SELECT
        id, session_id, username, role, event, page, details, ip_address, user_agent,
        (created_at AT TIME ZONE 'Asia/Kolkata')::date AS log_date,
        created_at
      FROM audit_logs
      WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
      ORDER BY created_at ASC, id ASC
    `,
    [logDate]
  );

  const rows = rowsRes.rows || [];
  if (!rows.length) return { archived: false, reason: "empty" };

  ensureArchiveDir();
  const readableFileName = `audit-readable-${logDate}.txt`;
  const readablePath = path.join(AUDIT_ARCHIVE_DIR, readableFileName);
  const readableHeader = [
    "IPACX RIS - DAILY AUDIT LOG",
    `Date: ${logDate}`,
    `Total Rows: ${rows.length}`,
    "",
    "TIME | USER | ROLE | EVENT | PAGE | IP | SESSION | DETAILS",
    "--------------------------------------------------------------------------------------------------------------------------------",
  ].join("\n");
  const readableBody = rows.map(toReadableArchiveLine).join("\n");
  fs.writeFileSync(readablePath, `${readableHeader}\n${readableBody}\n`, "utf8");

  await pool.query(
    `
      INSERT INTO audit_log_archives (log_date, file_path, row_count, archived_at)
      VALUES ($1::date, $2, $3, NOW())
      ON CONFLICT (log_date)
      DO UPDATE
      SET file_path = EXCLUDED.file_path,
          row_count = EXCLUDED.row_count,
          archived_at = NOW()
    `,
    [
      logDate,
      path
        .relative(path.join(__dirname, "..", ".."), readablePath)
        .replace(/\\/g, "/"),
      rows.length,
    ]
  );

  await pool.query(
    `
      DELETE FROM audit_logs
      WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
    `,
    [logDate]
  );

  return {
    archived: true,
    logDate,
    rowCount: rows.length,
    filePath: path
      .relative(path.join(__dirname, "..", ".."), readablePath)
      .replace(/\\/g, "/"),
  };
}

async function archiveAllPastDays() {
  await ensureAuditTable();
  const todayIST = getISTDateString();
  const daysRes = await pool.query(
    `
      SELECT DISTINCT ((created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS log_date
      FROM audit_logs
      WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date < $1::date
      ORDER BY log_date ASC
    `,
    [todayIST]
  );

  const archiveMetaRes = await pool.query(
    `SELECT log_date::text AS log_date, file_path FROM audit_log_archives`
  );
  const archiveMap = new Map(archiveMetaRes.rows.map((r) => [r.log_date, r.file_path]));

  const result = [];
  for (const row of daysRes.rows) {
    const existingPath = archiveMap.get(row.log_date) || "";
    const resolvedPath = resolveArchivePath(existingPath);
    const needsRearchive =
      !existingPath || !isReadableArchivePath(existingPath) || !fs.existsSync(resolvedPath);
    if (!needsRearchive) {
      continue;
    }
    const archived = await archiveLogDate(row.log_date);
    result.push(archived);
  }
  return result;
}

function startAuditArchiveScheduler() {
  if (archiveSchedulerStarted) return;
  archiveSchedulerStarted = true;

  // startup catch-up
  archiveAllPastDays().catch((err) => {
    console.error("Audit archive startup catch-up error:", err.message);
  });

  // periodic check keeps only today's logs in DB
  setInterval(() => {
    archiveAllPastDays().catch((err) => {
      console.error("Audit archive interval error:", err.message);
    });
  }, 5 * 60 * 1000);
}

function getActorFromReq(req) {
  if (req?.user) {
    return {
      username: String(req.user.username || "").trim() || null,
      role: String(req.user.role || "").trim() || null,
      session_id: String(req.user.session_id || "").trim() || null,
    };
  }
  const username = String(req.headers["x-audit-username"] || "").trim() || null;
  const role = String(req.headers["x-audit-role"] || "").trim() || null;
  const session_id = String(req.headers["x-audit-session"] || "").trim() || null;
  return { username, role, session_id };
}

async function logAction(req, { event, page = null, details = null }) {
  const actor = getActorFromReq(req);
  await writeAuditLog({
    session_id: actor.session_id,
    username: actor.username,
    role: actor.role,
    event,
    page: page || req.originalUrl || null,
    details,
    ip_address: getClientIp(req),
    user_agent: req.headers["user-agent"] || "",
  });
}

module.exports = {
  ensureAuditTable,
  getISTDateString,
  getISTDateNDaysAgo,
  archiveLogDate,
  archiveAllPastDays,
  startAuditArchiveScheduler,
  getClientIp,
  newSessionId,
  writeAuditLog,
  getActorFromReq,
  logAction,
};
