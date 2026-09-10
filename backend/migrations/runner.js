const fs = require("fs");
const path = require("path");
const pool = require("../db");

/**
 * Migration runner to execute versioned SQL schema migrations idempotently.
 */
async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `);

    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const res = await client.query(
        "SELECT filename FROM schema_migrations WHERE filename = $1",
        [file]
      );
      if (res.rowCount === 0) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, "utf8");
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`[MIGRATION] Successfully executed migration ${file}`);
      }
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[MIGRATION_ERROR] Failed to run schema migrations:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
