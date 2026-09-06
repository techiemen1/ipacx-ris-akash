const express = require("express");
const axios = require("axios");
const pool = require("../db");
const cacheService = require("../services/cacheService");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

async function checkDatabase() {
  const startedAt = Date.now();
  await pool.query("SELECT 1");
  return { status: "ok", latencyMs: Date.now() - startedAt };
}

async function checkPacs() {
  const orthancUrl = (process.env.ORTHANC_URL || "http://orthanc:8042/").replace(/\/?$/, "/");
  const username = process.env.ORTHANC_USER || "";
  const password = process.env.ORTHANC_PASS || "";
  const startedAt = Date.now();

  await axios.get(`${orthancUrl}system`, {
    timeout: Number(process.env.HEALTHCHECK_TIMEOUT_MS || 3000),
    ...(username && password ? { auth: { username, password } } : {}),
  });

  return { status: "ok", latencyMs: Date.now() - startedAt };
}

async function settleCheck(name, check) {
  try {
    return [name, await check()];
  } catch (err) {
    return [name, { status: "down", message: err.message }];
  }
}

router.get("/live", (req, res) => {
  res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

router.get("/ready", asyncHandler(async (req, res) => {
  const checks = Object.fromEntries(await Promise.all([
    settleCheck("database", checkDatabase),
    settleCheck("cache", cacheService.health),
    settleCheck("pacs", checkPacs),
  ]));

  const requiredHealthy = checks.database.status === "ok";
  res.status(requiredHealthy ? 200 : 503).json({
    status: requiredHealthy ? "ok" : "degraded",
    checks,
  });
}));

module.exports = router;
