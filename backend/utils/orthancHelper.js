const axios = require("axios");

let cachedWorkingOrthancUrl = null;

function orthancAuthConfig() {
  const user = process.env.ORTHANC_USER || "orthanc";
  const pass = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS || "orthanc";
  return { auth: { username: String(user).trim(), password: String(pass) } };
}

async function getOrthancUrl() {
  if (cachedWorkingOrthancUrl) return cachedWorkingOrthancUrl;
  const candidates = [
    process.env.ORTHANC_URL,
    "http://Orthanc:8042/",
    "http://host.docker.internal:8042/",
    "http://172.17.0.1:8042/",
    "http://172.21.0.1:8042/",
    "http://localhost:8042/"
  ].filter(Boolean);

  for (const rawUrl of candidates) {
    const url = rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;
    try {
      await axios.get(`${url}system`, { ...orthancAuthConfig(), timeout: 1500 });
      cachedWorkingOrthancUrl = url;
      console.log(`[Orthanc Discovery] Selected working Orthanc URL: ${cachedWorkingOrthancUrl}`);
      return url;
    } catch (e) {}
  }
  const fallback = (process.env.ORTHANC_URL || "http://Orthanc:8042/").replace(/\/?$/, "/");
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
  extractCleanInstanceId
};
