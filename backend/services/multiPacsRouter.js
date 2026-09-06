const axios = require("axios");
const PacsRepository = require("../repositories/PacsRepository");
const cacheService = require("./cacheService");

function authConfig(username, password) {
  if (!username || !password) return {};
  return { auth: { username, password } };
}

class MultiPacsRouter {
  constructor(pool) {
    this.repository = new PacsRepository(pool);
  }

  /**
   * Performs federated study search across all active registered PACS nodes
   */
  async searchActiveNodes({ patientId, patientName, startDate, endDate, modality }) {
    const cacheKey = `pacs:federated:${patientId || "all"}:${startDate || "any"}:${endDate || "any"}:${modality || "all"}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    const activeNodes = await this.repository.findActive();
    const queryPromises = activeNodes.map((pacs) =>
      this.queryNode(pacs, { patientId, patientName, startDate, endDate, modality })
        .catch((err) => {
          console.warn(`[MultiPACS Router] Query to node '${pacs.pacs_name}' failed:`, err.message);
          return [];
        })
    );

    const nodeResults = await Promise.all(queryPromises);
    const flattened = nodeResults.flat();

    // Deduplicate by StudyInstanceUID
    const deduplicated = Object.values(
      flattened.reduce((acc, study) => {
        if (study.StudyInstanceUID && !acc[study.StudyInstanceUID]) {
          acc[study.StudyInstanceUID] = study;
        }
        return acc;
      }, {})
    );

    await cacheService.set(cacheKey, deduplicated, 30); // 30s cache TTL
    return deduplicated;
  }

  async queryNode(pacs, { patientId, patientName, startDate, endDate, modality }) {
    const type = (pacs.pacs_type || "ORTHANC").toUpperCase();
    const serverUrl = `http://${pacs.ip_address}:${pacs.port}/`.replace(/\/?$/, "/");
    const config = authConfig(pacs.username || process.env.ORTHANC_USER, pacs.password || process.env.ORTHANC_PASS);

    if (type === "ORTHANC") {
      const payload = { Level: "Study", Query: {}, Limit: 100 };
      if (patientId) payload.Query.PatientID = `*${patientId}*`;
      if (patientName) payload.Query.PatientName = `*${patientName}*`;
      if (modality) payload.Query.ModalitiesInStudy = modality;
      if (startDate && endDate) payload.Query.StudyDate = `${startDate}-${endDate}`;

      const { data: ids } = await axios.post(`${serverUrl}tools/find`, payload, config);
      const studies = await Promise.all(
        ids.map(async (id) => {
          const { data } = await axios.get(`${serverUrl}studies/${id}`, config);
          return {
            PatientID: data.PatientMainDicomTags?.PatientID || "N/A",
            PatientName: data.PatientMainDicomTags?.PatientName || "N/A",
            PatientSex: data.PatientMainDicomTags?.PatientSex || "O",
            PatientAge: data.PatientMainDicomTags?.PatientAge || "N/A",
            AccessionNumber: data.MainDicomTags?.AccessionNumber || "N/A",
            StudyDescription: data.MainDicomTags?.StudyDescription || "No Description",
            StudyDate: data.MainDicomTags?.StudyDate || "N/A",
            Modality: Array.isArray(data.ModalitiesInStudy) ? data.ModalitiesInStudy.join(",") : "N/A",
            StudyInstanceUID: data.MainDicomTags?.StudyInstanceUID || data.ID,
            PACSNode: pacs.pacs_name,
            PACSNodeId: pacs.id,
          };
        })
      );
      return studies;
    }

    return [];
  }
}

module.exports = MultiPacsRouter;
