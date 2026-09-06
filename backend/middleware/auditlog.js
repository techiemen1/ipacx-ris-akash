// middleware/auditLog.js
const pool = require("../db"); // PostgreSQL connection

async function auditLog(user, action, targetUser = null, fileOrEndpoint = null) {
  if (!user) return;

  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, username, action, target_user, file_or_endpoint)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, user.username, action, targetUser, fileOrEndpoint]
    );
  } catch (err) {
    console.error("Failed to log audit action:", err.message);
  }
}

module.exports = auditLog;