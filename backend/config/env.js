const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const { z } = require("zod");
const logger = require("../utils/logger");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.string().default("5000"),
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.string().default("5432"),
  POSTGRES_USER: z.string().default("postgres"),
  POSTGRES_PASSWORD: z.string().default(""),
  POSTGRES_DB: z.string().default("ris"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters long"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ORTHANC_URL: z.string().default("http://localhost:8042/"),
  ORTHANC_USER: z.string().optional().default(""),
  ORTHANC_PASS: z.string().optional().default(""),
  SENTRY_DSN: z.string().optional(),
  AWS_S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    logger.error("Invalid environment configuration", { errors: parsed.error.format() });
    if (process.env.NODE_ENV === "production") {
      throw new Error("Critical: Missing or invalid environment variables for production startup.");
    }
  }
  return parsed.data || process.env;
}

module.exports = loadEnv();
