const axios = require("axios");
const net = require("net");
const PacsRepository = require("../repositories/PacsRepository");
const cacheService = require("./cacheService");
const { BadRequestError, NotFoundError } = require("../utils/AppError");
const { getOrthancUrl, orthancAuthConfig } = require("../utils/orthancHelper");

class PacsService {
  constructor(pool) {
    this.repository = new PacsRepository(pool);
  }

  async list() {
    return this.repository.findAll();
  }

  async save(payload) {
    const { pacs_name, pacs_type, ae_title, ip_address, port } = payload;
    if (!pacs_name || !pacs_type || !ae_title || !ip_address || !port) {
      throw new BadRequestError("All fields except credentials required");
    }

    const saved = await this.repository.upsert(payload);
    if (payload.id && !saved) throw new NotFoundError("PACS not found");
    await cacheService.del("pacs:*");
    return saved;
  }

  async delete(id) {
    const deleted = await this.repository.deleteById(id);
    await cacheService.del("pacs:*");
    return deleted;
  }

  async setActive(id, isActive) {
    const updated = await this.repository.setActive(id, isActive);
    if (!updated) throw new NotFoundError("PACS not found");
    await cacheService.del("pacs:*");
    return updated;
  }

  async testNode(pacs) {
    if (!pacs || !pacs.ip_address || !pacs.port) {
      return { success: false, message: "Host and Port are required" };
    }

    const host = String(pacs.ip_address).trim();
    const port = parseInt(pacs.port, 10);
    const pacsTypeUpper = String(pacs.pacs_type || "").toUpperCase().trim();

    // 1. TCP Socket Ping
    const tcpResult = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(4000);
      socket.on("connect", () => {
        socket.destroy();
        resolve({ ok: true });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ ok: false, error: `Connection timeout to ${host}:${port}` });
      });
      socket.on("error", (err) => {
        socket.destroy();
        resolve({ ok: false, error: err.message });
      });
      socket.connect(port, host);
    });

    // 2. Specialized HTTP API check for Orthanc / DCM4CHEE
    if (pacsTypeUpper === "ORTHANC") {
      let serverUrl = `http://${host}:${port}/`;
      if (host === "localhost" || host === "127.0.0.1") {
        serverUrl = await getOrthancUrl();
      }
      try {
        const sysRes = await axios.get(`${serverUrl}system`, {
          ...orthancAuthConfig(pacs.username, pacs.password),
          timeout: 4000
        });
        if (sysRes.status === 200) {
          return { success: true, message: `Successfully connected to Orthanc PACS (${sysRes.data?.Name || "Online"})` };
        }
      } catch (e) {
        if (tcpResult.ok) {
          return { success: true, message: `TCP Port ${port} is open and active on Orthanc host (${host})` };
        }
      }
    } else if (pacsTypeUpper === "DCM4CHEE") {
      const portsToTry = [port];
      if (port === 11112) portsToTry.push(8080, 8085, 8443);
      else portsToTry.push(8080, 8085, 11112);
      const uniquePorts = [...new Set(portsToTry)];

      for (const pPort of uniquePorts) {
        const qidoUrl = `http://${host}:${pPort}/dcm4chee-arc/aets/${pacs.ae_title || "DCM4CHEE"}/rs/studies`;
        try {
          const res = await axios.get(qidoUrl, {
            ...orthancAuthConfig(pacs.username || process.env.DCM4CHEE_USER, pacs.password || process.env.DCM4CHEE_PASS),
            params: { limit: 1 },
            headers: { Accept: "application/dicom+json" },
            timeout: 4000
          });
          if (res.status === 200 || res.status === 204) {
            return { success: true, message: `Successfully connected to DCM4CHEE QIDO-RS web API on port ${pPort}!` };
          }
        } catch (e) {
          if (e.response && [200, 204, 401].includes(e.response.status)) {
            return { success: true, message: `Connected to DCM4CHEE on port ${pPort} (HTTP ${e.response.status})` };
          }
        }
      }

      if (tcpResult.ok) {
        return { success: true, message: `TCP Port ${port} is open on DCM4CHEE host (${host})` };
      }
    }

    if (tcpResult.ok) {
      return { success: true, message: `Connection successful to ${host}:${port}` };
    }

    return { success: false, message: tcpResult.error || `Could not connect to ${host}:${port}` };
  }

  async listActiveStudies({ startDate, endDate, pacsId, forceRefresh } = {}) {
    const cacheKey = `pacs:studies:${pacsId || "all"}:${startDate || "any"}:${endDate || "any"}`;
    
    if (forceRefresh) {
      await cacheService.del("pacs:*").catch(() => {});
    } else {
      const cached = await cacheService.get(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) return cached;
    }

    const activePacs = await this.repository.findActive().catch(() => []);
    const allStudies = [];

    // Filter by specific PACS ID if provided and valid
    let targetNodes = activePacs;
    if (pacsId && pacsId !== "all" && pacsId !== "orthanc") {
      const filtered = activePacs.filter(p => String(p.id) === String(pacsId) || p.ae_title === pacsId);
      if (filtered.length > 0) targetNodes = filtered;
    }

    for (const pacs of targetNodes) {
      try {
        const pacsTypeUpper = String(pacs.pacs_type || "").toUpperCase().trim();
        if (pacsTypeUpper === "ORTHANC") {
          const studies = await this.fetchOrthancStudies(pacs, { startDate, endDate });
          allStudies.push(...studies);
        } else if (pacsTypeUpper === "DCM4CHEE") {
          const studies = await this.fetchDcm4cheeStudies(pacs, { startDate, endDate });
          allStudies.push(...studies);
        }
      } catch (err) {
        console.error(`[PacsService] Node ${pacs.pacs_name || pacs.ae_title} (${pacs.ip_address}) fetch failed:`, err.message);
      }
    }

    // Dynamic Fallback to working Orthanc URL if configured nodes return empty
    if (allStudies.length === 0) {
      try {
        const dynamicUrl = await getOrthancUrl();
        const fallbackStudies = await this.fetchOrthancFromUrl(dynamicUrl, { startDate, endDate });
        allStudies.push(...fallbackStudies);
      } catch (e) {
        console.error("[PacsService] Dynamic Orthanc fallback failed:", e.message);
      }
    }

    const unique = Object.values(
      allStudies.reduce((acc, study) => {
        if (study.StudyInstanceUID && !acc[study.StudyInstanceUID]) {
          acc[study.StudyInstanceUID] = study;
        }
        return acc;
      }, {})
    );

    if (unique.length > 0) {
      await cacheService.set(cacheKey, unique, Number(process.env.PACS_CACHE_TTL_SECONDS || 45));
    }
    return unique;
  }

  async fetchOrthancStudies(pacs, { startDate, endDate }) {
    let serverUrl = `http://${pacs.ip_address}:${pacs.port}/`;
    if (pacs.ip_address === "localhost" || pacs.ip_address === "127.0.0.1") {
      serverUrl = await getOrthancUrl();
    }
    try {
      return await this.fetchOrthancFromUrl(serverUrl, { startDate, endDate });
    } catch (err) {
      console.warn(`[PacsService] Failed to fetch from ${serverUrl}, falling back to dynamic Orthanc URL:`, err.message);
      const fallbackUrl = await getOrthancUrl();
      return this.fetchOrthancFromUrl(fallbackUrl, { startDate, endDate });
    }
  }

  async fetchOrthancFromUrl(serverUrl, { startDate, endDate }) {
    const config = orthancAuthConfig();
    const payload = { Level: "Study", Query: {}, Limit: 500 };
    if (startDate && endDate) payload.Query.StudyDate = `${startDate}-${endDate}`;

    const { data: ids } = await axios.post(`${serverUrl}tools/find`, payload, config);
    const studies = await Promise.all(
      ids.map(async (id) => {
        const { data } = await axios.get(`${serverUrl}studies/${id}`, config);
        
        let modality = data.MainDicomTags?.Modality || "";
        let bodyPart = data.MainDicomTags?.BodyPartExamined || "";

        if (Array.isArray(data.Series) && data.Series.length > 0) {
          for (const sId of data.Series) {
            try {
              const seriesRes = await axios.get(`${serverUrl}series/${sId}`, config);
              if (seriesRes.data?.MainDicomTags) {
                if (!modality && seriesRes.data.MainDicomTags.Modality) {
                  modality = seriesRes.data.MainDicomTags.Modality;
                }
                if (!bodyPart && seriesRes.data.MainDicomTags.BodyPartExamined) {
                  bodyPart = seriesRes.data.MainDicomTags.BodyPartExamined;
                }
                if (modality) break;
              }
            } catch (e) {
              // fallback
            }
          }
        }

        const normMod = String(modality).toUpperCase().trim();
        if (normMod && ["CR", "DX", "XR", "CT", "MR", "MRI", "US", "USG", "MG", "EC", "ECHO"].includes(normMod)) {
          if (normMod === "MRI") modality = "MR";
          else if (normMod === "USG") modality = "US";
          else if (normMod === "ECHO") modality = "EC";
          else modality = normMod;
        } else {
          // Description Fallback
          const desc = String(data.MainDicomTags?.StudyDescription || "").toUpperCase();
          if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST PA") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) modality = "CR";
          else if (desc.includes("MRI") || desc.includes("MR") || desc.includes("SPINE") || desc.includes("BRAIN") || desc.includes("KNEE")) modality = "MR";
          else if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) modality = "US";
          else if (desc.includes("CT") || desc.includes("TOMOGRAPHY") || desc.includes("HEAD") || desc.includes("SINUS") || desc.includes("ABDOMEN")) modality = "CT";
          else modality = "CR";
        }

        return {
          PatientID: data.PatientMainDicomTags?.PatientID || "N/A",
          PatientName: data.PatientMainDicomTags?.PatientName || "N/A",
          PatientAge: data.PatientMainDicomTags?.PatientAge || "N/A",
          PatientSex: data.PatientMainDicomTags?.PatientSex || "O",
          AccessionNumber: data.MainDicomTags?.AccessionNumber || "N/A",
          StudyDescription: data.MainDicomTags?.StudyDescription || "No Description",
          StudyDate: data.MainDicomTags?.StudyDate || "N/A",
          Modality: modality.toUpperCase(),
          BodyPartExamined: bodyPart,
          StudyInstanceUID: data.MainDicomTags?.StudyInstanceUID || data.ID,
          PACS: "ORTHANC",
        };
      })
    );

    return studies;
  }

  async fetchDcm4cheeStudies(pacs, { startDate, endDate }) {
    const portsToTry = [parseInt(pacs.port, 10)];
    if (pacs.port === 11112 || pacs.port === "11112") {
      portsToTry.unshift(8080, 8085);
    } else {
      portsToTry.push(8080, 8085);
    }
    const uniquePorts = [...new Set(portsToTry.filter(Boolean))];

    let lastError = null;
    for (const port of uniquePorts) {
      const qidoUrl = `http://${pacs.ip_address}:${port}/dcm4chee-arc/aets/${pacs.ae_title}/rs/studies`;
      const params = { includefield: "all", limit: 200 };
      if (startDate && endDate) params.StudyDate = `${startDate}-${endDate}`;

      try {
        const response = await axios.get(qidoUrl, {
          ...orthancAuthConfig(pacs.username || process.env.DCM4CHEE_USER, pacs.password || process.env.DCM4CHEE_PASS),
          params,
          headers: { Accept: "application/dicom+json" },
          timeout: 6000,
        });

        if (Array.isArray(response.data)) {
          return response.data.map((study) => ({
            PatientID: study["00100020"]?.Value?.[0] || "N/A",
            PatientName: study["00100010"]?.Value?.[0]?.Alphabetic || study["00100010"]?.Value?.[0] || "N/A",
            PatientAge: study["00101010"]?.Value?.[0] || "N/A",
            PatientSex: study["00100040"]?.Value?.[0] || "O",
            AccessionNumber: study["00080050"]?.Value?.[0] || "N/A",
            StudyDescription: study["00081030"]?.Value?.[0] || "",
            StudyDate: study["00080020"]?.Value?.[0] || "",
            Modality: (study["00080061"]?.Value?.[0] || "CR").toUpperCase(),
            StudyInstanceUID: study["0020000D"]?.Value?.[0],
            PACS: pacs.pacs_name || "DCM4CHEE",
          }));
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError || new Error(`Failed to fetch DCM4CHEE studies from ${pacs.ip_address}`);
  }
}

module.exports = PacsService;

