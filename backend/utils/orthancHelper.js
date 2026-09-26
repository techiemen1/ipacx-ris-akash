const axios = require("axios");
const pool = require("../db");

let cachedWorkingOrthancUrl = null;
let cachedAuthHeader = null;
let cachedAuthConfig = null;
let lastAuthCacheTime = 0;

async function getActivePacsCredentials() {
  const now = Date.now();
  if (cachedAuthConfig && (now - lastAuthCacheTime < 15000)) {
    return cachedAuthConfig;
  }

  let username = process.env.ORTHANC_USER || "orthanc";
  let password = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS || "orthanc";

  try {
    let rows = [];
    try {
      const res = await pool.query(
        "SELECT username, password FROM public.pacs WHERE is_active = true ORDER BY id ASC LIMIT 1"
      );
      rows = res.rows;
    } catch (err1) {
      const res2 = await pool.query(
        "SELECT username, password FROM public.pacs_destinations WHERE is_active = true ORDER BY id ASC LIMIT 1"
      ).catch(() => ({ rows: [] }));
      rows = res2.rows;
    }

    if (rows.length > 0 && rows[0].username) {
      username = String(rows[0].username).trim();
      password = String(rows[0].password || "");
    }
  } catch (e) {
    // DB query error fallback to env
  }

  cachedAuthConfig = { username, password };
  cachedAuthHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  lastAuthCacheTime = now;
  return cachedAuthConfig;
}

function clearOrthancAuthCache() {
  cachedAuthConfig = null;
  cachedAuthHeader = null;
  cachedWorkingOrthancUrl = null;
  lastAuthCacheTime = 0;
}

function orthancAuthConfig() {
  let user = process.env.ORTHANC_USER || "orthanc";
  let pass = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS || "orthanc";
  if (cachedAuthConfig && cachedAuthConfig.username) {
    user = cachedAuthConfig.username;
    pass = cachedAuthConfig.password;
  }
  return { auth: { username: String(user).trim(), password: String(pass) } };
}

function getOrthancAuthHeader() {
  if (cachedAuthHeader) return cachedAuthHeader;
  let user = process.env.ORTHANC_USER || "orthanc";
  let pass = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS || "orthanc";
  if (cachedAuthConfig && cachedAuthConfig.username) {
    user = cachedAuthConfig.username;
    pass = cachedAuthConfig.password;
  }
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function getOrthancUrl() {
  await getActivePacsCredentials();
  const now = Date.now();
  if (cachedWorkingOrthancUrl && (now - lastAuthCacheTime < 30000)) {
    return cachedWorkingOrthancUrl;
  }

  const dbCandidates = [];
  try {
    const pacsRes = await pool.query(
      "SELECT ip_address, port, pacs_type FROM public.pacs WHERE is_active = true ORDER BY id ASC"
    ).catch(() => ({ rows: [] }));
    
    for (const r of (pacsRes.rows || [])) {
      const pType = String(r.pacs_type || "").toUpperCase();
      if (pType.includes("DCM4CHEE") || pType.includes("DICOMWEB")) continue;
      if (r.ip_address && r.port) {
        let host = String(r.ip_address).trim();
        let port = String(r.port).trim();
        if (host.startsWith("http://") || host.startsWith("https://")) {
          dbCandidates.push(`${host.replace(/\/+$/, "")}:${port}/`);
        } else {
          dbCandidates.push(`http://${host}:${port}/`);
        }
      }
    }

    const settingsRes = await pool.query(
      "SELECT setting_value FROM public.system_settings WHERE setting_key = 'external_ohif_url' LIMIT 1"
    ).catch(() => ({ rows: [] }));

    if (settingsRes.rows && settingsRes.rows.length > 0 && settingsRes.rows[0].setting_value) {
      const ohifVal = String(settingsRes.rows[0].setting_value).trim();
      try {
        const parsed = new URL(ohifVal.startsWith("http") ? ohifVal : `http://${ohifVal}`);
        dbCandidates.push(`${parsed.origin}/`);
      } catch (e) {}
    }
  } catch (e) {}

  const candidates = [
    process.env.ORTHANC_URL,
    ...dbCandidates,
    "http://Orthanc:8042/",
    "http://host.docker.internal:8042/",
    "http://172.17.0.1:8042/",
    "http://172.21.0.1:8042/",
    "http://127.0.0.1:8042/",
    "http://localhost:8042/"
  ].filter(Boolean);

  const uniqueCandidates = Array.from(new Set(candidates.map(u => u.endsWith('/') ? u : `${u}/`)));

  // Fast parallel probe across candidates with 500ms timeout
  const probePromises = uniqueCandidates.map(async (url) => {
    try {
      await axios.get(`${url}system`, { ...orthancAuthConfig(), timeout: 500 });
      return url;
    } catch (e) {
      throw e;
    }
  });

  try {
    const workingUrl = await Promise.any(probePromises);
    if (workingUrl) {
      cachedWorkingOrthancUrl = workingUrl;
      console.log(`[Orthanc Discovery] Fast parallel probe selected: ${workingUrl}`);
      return workingUrl;
    }
  } catch (e) {}

  const fallback = (process.env.ORTHANC_URL || "http://Orthanc:8042/").replace(/\/?$/, "/");
  cachedWorkingOrthancUrl = fallback;
  console.log(`[Orthanc Discovery] Fallback to default Orthanc URL: ${fallback}`);
  return fallback;
}

function extractCleanInstanceId(val) {
  if (!val) return "";
  let str = "";
  if (typeof val === "string") {
    str = val;
  } else if (Array.isArray(val)) {
    str = typeof val[0] === "string" ? val[0] : (val[0]?.ID || val[0]?.Path || val[0]?.Instance || "");
  } else if (typeof val === "object") {
    str = val.ID || val.Path || val.Instance || val.instance_id || "";
  }
  
  if (str.includes("/")) {
    const parts = str.split("/").filter(Boolean);
    const instIdx = parts.indexOf("instances");
    if (instIdx !== -1 && parts[instIdx + 1]) {
      str = parts[instIdx + 1];
    } else {
      str = parts[parts.length - 1];
    }
  }
  return str.trim();
}

module.exports = {
  getOrthancUrl,
  orthancAuthConfig,
  getOrthancAuthHeader,
  getActivePacsCredentials,
  clearOrthancAuthCache,
  extractCleanInstanceId
};
