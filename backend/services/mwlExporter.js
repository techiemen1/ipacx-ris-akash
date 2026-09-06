const axios = require("axios");

function normalizePacs(pacs = {}) {
  return {
    id: pacs.id,
    name: pacs.pacs_name || pacs.name || "",
    type: String(pacs.pacs_type || pacs.type || "").toLowerCase(),
    host: pacs.host || pacs.ip_address || pacs.ip || "localhost",
    port: Number(pacs.port || 8042),
    username: pacs.username || "",
    password: pacs.password || "",
  };
}

function buildMWL(appointment = {}) {
  return {
    PatientName: appointment.patient_name || "",
    PatientID: appointment.patient_id || "",
    AccessionNumber: appointment.accession_number || "",
    RequestedProcedureID: appointment.requested_procedure_id || "",
    ScheduledProcedureStepSequence: [
      {
        Modality: appointment.modality || "",
        ScheduledProcedureStepStartDateTime: appointment.scheduled_start || "",
        ScheduledStationAETitle: appointment.station_aet || "",
      },
    ],
  };
}

async function sendMWL(pacsInput, appointment) {
  const pacs = normalizePacs(pacsInput);
  let baseUrl = `${pacs.host}:${pacs.port}`;
  if (!/^https?:\/\//i.test(baseUrl)) baseUrl = `http://${baseUrl}`;
  baseUrl = baseUrl.replace(/\/+$/, "");

  const payload = buildMWL(appointment);
  const config = { timeout: 10000 };
  const orthancUser = process.env.ORTHANC_USER || "";
  const orthancPass = process.env.ORTHANC_PASS || "";
  const dcmUser = process.env.DCM4CHEE_USER || "pacs";
  const dcmPass = process.env.DCM4CHEE_PASS || "pacs";

  const authUser = pacs.username || (pacs.type.includes("orthanc") ? orthancUser : dcmUser);
  const authPass = pacs.password || (pacs.type.includes("orthanc") ? orthancPass : dcmPass);
  if (authUser && authPass) {
    config.auth = { username: authUser, password: authPass };
  }

  if (pacs.type.includes("orthanc")) {
    const endpoints = String(
      process.env.ORTHANC_MWL_ENDPOINTS || "/tools/worklists,/tools/worklist,/worklists"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let lastErr = null;
    for (const endpoint of endpoints) {
      const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
      try {
        const response = await axios.post(url, payload, config);
        return { url, payload, data: response.data };
      } catch (err) {
        const status = err?.response?.status;
        const orthancError = err?.response?.data?.OrthancError || "";
        // Try next endpoint only for "not found / unknown resource" cases.
        if (status === 404 || /unknown resource/i.test(String(orthancError))) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    const msg =
      "Orthanc MWL endpoint not found. Enable Orthanc Worklist plugin HTTP route or set ORTHANC_MWL_ENDPOINTS in .env.";
    const e = new Error(msg);
    e.statusCode = 502;
    e.publicMessage = msg;
    e.cause = lastErr;
    throw e;
  }

  const url = `${baseUrl}/mwl`;
  const response = await axios.post(url, payload, config);
  return { url, payload, data: response.data };
}

module.exports = { sendMWL, buildMWL };
