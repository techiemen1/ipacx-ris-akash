const axios = require("axios");
const PacsRepository = require("../repositories/PacsRepository");
const cacheService = require("./cacheService");
const { BadRequestError, NotFoundError } = require("../utils/AppError");

function authConfig(username, password) {
  if (!username || !password) return {};
  return { auth: { username, password } };
}

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

  async listActiveStudies({ startDate, endDate }) {
    const cacheKey = `pacs:studies:${startDate || "any"}:${endDate || "any"}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const activePacs = await this.repository.findActive();
    const allStudies = [];

    for (const pacs of activePacs) {
      try {
        if (pacs.pacs_type === "ORTHANC") {
          const studies = await this.fetchOrthancStudies(pacs, { startDate, endDate });
          allStudies.push(...studies);
        }

        if (pacs.pacs_type === "DCM4CHEE") {
          const studies = await this.fetchDcm4cheeStudies(pacs, { startDate, endDate });
          allStudies.push(...studies);
        }
      } catch (err) {
        console.error(`${pacs.pacs_type} (${pacs.ip_address}) fetch failed:`, err.message);
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

    await cacheService.set(cacheKey, unique, Number(process.env.PACS_CACHE_TTL_SECONDS || 45));
    return unique;
  }

  async fetchOrthancStudies(pacs, { startDate, endDate }) {
    const serverUrl = `http://${pacs.ip_address}:${pacs.port}/`;
    const config = authConfig(
      pacs.username || process.env.ORTHANC_USER,
      pacs.password || process.env.ORTHANC_PASS
    );
    const payload = { Level: "Study", Query: {}, Limit: 200 };
    if (startDate && endDate) payload.Query.StudyDate = `${startDate}-${endDate}`;

    const { data: ids } = await axios.post(`${serverUrl}tools/find`, payload, config);
    const studies = await Promise.all(
      ids.map(async (id) => {
        const { data } = await axios.get(`${serverUrl}studies/${id}`, config);
        
        let modality = "";
        let bodyPart = "";

        if (Array.isArray(data.Series) && data.Series.length > 0) {
          try {
            const seriesRes = await axios.get(`${serverUrl}series/${data.Series[0]}`, config);
            if (seriesRes.data?.MainDicomTags) {
              modality = seriesRes.data.MainDicomTags.Modality || modality;
              bodyPart = seriesRes.data.MainDicomTags.BodyPartExamined || "";
            }
          } catch (e) {
            // fallback
          }
        }

        const normMod = String(modality).toUpperCase().trim();
        if (normMod && ["CR", "DX", "XR", "CT", "MR", "MRI", "US", "USG", "MG", "EC", "ECHO"].includes(normMod)) {
          if (normMod === "MRI") modality = "MR";
          else if (normMod === "USG") modality = "US";
          else if (normMod === "ECHO") modality = "EC";
          else modality = normMod;
        } else {
          // Description Fallback (Prioritize X-Ray before CT!)
          const desc = String(data.MainDicomTags?.StudyDescription || "").toUpperCase();
          if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST PA") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) modality = "CR";
          else if (desc.includes("MRI") || desc.includes("MR") || desc.includes("SPINE") || desc.includes("KNEE")) modality = "MR";
          else if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) modality = "US";
          else if (desc.includes("CT") || desc.includes("TOMOGRAPHY")) modality = "CT";
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
          PACS: pacs.pacs_name || "ORTHANC",
        };
      })
    );

    return studies;
  }

  async fetchDcm4cheeStudies(pacs, { startDate, endDate }) {
    const qidoUrl = `http://${pacs.ip_address}:${pacs.port}/dcm4chee-arc/aets/${pacs.ae_title}/rs/studies`;
    const params = { includefield: "all", limit: 200 };
    if (startDate && endDate) params.StudyDate = `${startDate}-${endDate}`;

    const response = await axios.get(qidoUrl, {
      ...authConfig(pacs.username || process.env.DCM4CHEE_USER, pacs.password || process.env.DCM4CHEE_PASS),
      params,
      headers: { Accept: "application/dicom+json" },
    });

    return response.data.map((study) => ({
      PatientID: study["00100020"]?.Value?.[0] || "N/A",
      PatientName: study["00100010"]?.Value?.[0]?.Alphabetic || "N/A",
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
}

module.exports = PacsService;
