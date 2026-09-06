// backend/db.js
const { Pool } = require("pg");
require("dotenv").config(); // load .env variables

const host = process.env.POSTGRES_HOST || "localhost";

const pool = new Pool({
  host,
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "",
  database: process.env.POSTGRES_DB || "RIS",
});

module.exports = pool;

