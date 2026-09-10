const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { z } = require("zod");
const logger = require("../utils/logger");

const dbUser = process.env.DB_USER || process.env.POSTGRES_USER;
const dbPassword = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD;
const orthancUser = process.env.ORTHANC_USER;
const orthancPassword = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS;
const jwtSecret = process.env.JWT_SECRET;

const missingVars = [];
if (!dbUser || !String(dbUser).trim()) missingVars.push("DB_USER / POSTGRES_USER");
if (dbPassword === undefined || dbPassword === null || String(dbPassword).trim() === "") missingVars.push("DB_PASSWORD / POSTGRES_PASSWORD");
if (!orthancUser || !String(orthancUser).trim()) missingVars.push("ORTHANC_USER");
if (!orthancPassword || !String(orthancPassword).trim()) missingVars.push("ORTHANC_PASSWORD / ORTHANC_PASS");
if (!jwtSecret || !String(jwtSecret).trim()) missingVars.push("JWT_SECRET");

if (missingVars.length > 0) {
  const errMsg = `FATAL CONFIGURATION ERROR: Missing or empty environment variables on startup: ${missingVars.join(", ")}`;
  logger.error(errMsg);
  throw new Error(errMsg);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("3015"),
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.string().default("5432"),
  POSTGRES_USER: z.string().min(1, "DB_USER / POSTGRES_USER is required"),
  POSTGRES_PASSWORD: z.string().min(1, "DB_PASSWORD / POSTGRES_PASSWORD is required"),
  POSTGRES_DB: z.string().default("ris"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters long"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ORTHANC_URL: z.string().default("http://localhost:8042/"),
  ORTHANC_USER: z.string().min(1, "ORTHANC_USER is required"),
  ORTHANC_PASS: z.string().min(1, "ORTHANC_PASSWORD / ORTHANC_PASS is required"),
  SENTRY_DSN: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
});

function loadEnv() {
  const envData = {
    ...process.env,
    POSTGRES_USER: dbUser,
    POSTGRES_PASSWORD: dbPassword,
    ORTHANC_USER: orthancUser,
    ORTHANC_PASS: orthancPassword,
  };
  const parsed = envSchema.safeParse(envData);
  if (!parsed.success) {
    logger.error("Invalid environment configuration", { errors: parsed.error.format() });
    throw new Error("FATAL CONFIGURATION ERROR: Invalid environment configuration for startup.");
  }
  return parsed.data;
}

module.exports = loadEnv();
