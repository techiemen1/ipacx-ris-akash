const { runMigrations } = require("./migrations/runner");

async function main() {
  console.log("🔄 Running database migrations via Migration Runner...");
  try {
    await runMigrations();
    console.log("🎉 All migrations completed successfully.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  }
}

main();
