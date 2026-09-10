// backend/db.js
const { Pool } = require("pg");
require("dotenv").config(); // load .env variables

const dbUser = process.env.DB_USER || process.env.POSTGRES_USER;
const dbPassword = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;

if (!dbUser || !String(dbUser).trim()) {
  throw new Error("FATAL CONFIGURATION ERROR: DB_USER / POSTGRES_USER environment variable is missing or empty.");
}

if (dbPassword === undefined || dbPassword === null || String(dbPassword).trim() === "") {
  throw new Error("FATAL CONFIGURATION ERROR: DB_PASSWORD / POSTGRES_PASSWORD environment variable is missing or empty.");
}

const host = process.env.POSTGRES_HOST || process.env.DB_HOST || "localhost";

const pool = new Pool({
  host,
  port: process.env.POSTGRES_PORT || process.env.DB_PORT || 5432,
  user: String(dbUser).trim(),
  password: String(dbPassword),
  database: process.env.POSTGRES_DB || process.env.DB_NAME || "RIS",
});

module.exports = pool;

