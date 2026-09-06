const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function runMigrations() {
  console.log("🔄 Running database migrations...");
  try {
    const migrationsDir = path.join(__dirname, "migrations");
    const files = fs.readdirSync(migrationsDir).sort();

    for (const file of files) {
      if (file.endsWith(".sql")) {
        console.log(`📜 Running migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        await pool.query(sql);
        console.log(`✅ Applied: ${file}`);
      }
    }
    console.log("🎉 All migrations completed successfully.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

runMigrations();
