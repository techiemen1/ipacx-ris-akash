const { Pool } = require("pg");
require("dotenv").config();

async function setup() {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "lekhana",
    database: "ris",
  });

  try {
    console.log("Adding MWL Server configuration to database...");
    
    // 1. Ensure MWL entry in pacs table
    await pool.query(`
      INSERT INTO pacs (pacs_name, pacs_type, ip_address, port, ae_title, is_active)
      VALUES ('MWL_SERVER', 'orthanc', 'localhost', 11118, 'MWL_SERVER', true)
      ON CONFLICT (ae_title) DO UPDATE 
      SET ip_address = 'localhost', port = 11118, pacs_name = 'MWL_SERVER';
    `);

    // 2. Map modalities to this MWL server (example for CT, MR, US)
    const modalities = ['CT', 'MR', 'US', 'DX', 'CR'];
    for (const mod of modalities) {
      await pool.query(`
        INSERT INTO mwl_modality_targets (modality_code, manual_host, manual_port, manual_ae_title, manual_protocol, is_active)
        VALUES ($1, 'localhost', 11118, 'MWL_SERVER', 'DIMSE', true)
        ON CONFLICT (modality_code) DO UPDATE 
        SET manual_host = 'localhost', manual_port = 11118, manual_ae_title = 'MWL_SERVER', manual_protocol = 'DIMSE';
      `, [mod]);
    }

    console.log("MWL Configuration complete.");
  } catch (err) {
    console.error("Setup failed:", err.message);
  } finally {
    await pool.end();
  }
}

setup();
