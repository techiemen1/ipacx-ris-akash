const axios = require("axios");

const ORTHANC_URL = (process.env.ORTHANC_URL || "http://localhost:8042/").replace(/\/?$/, "/");
const ORTHANC_USER = process.env.ORTHANC_USER || "";
const ORTHANC_PASS = process.env.ORTHANC_PASS || "";

function authConfig() {
  if (!ORTHANC_USER || !ORTHANC_PASS) return {};
  return { auth: { username: ORTHANC_USER, password: ORTHANC_PASS } };
}

class DicomWebService {
  /**
   * QIDO-RS: Search Studies via DICOMweb /dicom-web/studies or Orthanc fallback
   */
  async searchStudies(queryParams = {}) {
    try {
      const dicomWebUrl = `${ORTHANC_URL}dicom-web/studies`;
      const response = await axios.get(dicomWebUrl, {
        params: queryParams,
        headers: { Accept: "application/dicom+json" },
        ...authConfig(),
      });
      return response.data;
    } catch (err) {
      console.warn("[DICOMweb] QIDO-RS fallback to Orthanc tools/find:", err.message);
      // Fallback to Orthanc tools/find
      const payload = { Level: "Study", Query: queryParams, Limit: 100 };
      const { data: ids } = await axios.post(`${ORTHANC_URL}tools/find`, payload, authConfig());
      return Promise.all(ids.map((id) => axios.get(`${ORTHANC_URL}studies/${id}`, authConfig()).then((r) => r.data)));
    }
  }

  /**
   * WADO-RS: Retrieve Study Metadata /dicom-web/studies/{studyUID}/metadata
   */
  async getStudyMetadata(studyUID) {
    const dicomWebUrl = `${ORTHANC_URL}dicom-web/studies/${studyUID}/metadata`;
    try {
      const response = await axios.get(dicomWebUrl, {
        headers: { Accept: "application/dicom+json" },
        ...authConfig(),
      });
      return response.data;
    } catch (err) {
      console.warn("[DICOMweb] WADO-RS Metadata fallback:", err.message);
      const findRes = await axios.post(`${ORTHANC_URL}tools/find`, { Level: "Study", Query: { StudyInstanceUID: studyUID } }, authConfig());
      if (!findRes.data.length) throw new Error("Study not found");
      const studyId = findRes.data[0];
      const res = await axios.get(`${ORTHANC_URL}studies/${studyId}`, authConfig());
      return res.data;
    }
  }

  /**
   * STOW-RS: Store DICOM instance file directly to Orthanc
   */
  async storeDicomInstance(buffer, contentType = "application/dicom") {
    const response = await axios.post(`${ORTHANC_URL}instances`, buffer, {
      headers: { "Content-Type": contentType },
      ...authConfig(),
    });
    return response.data;
  }
}

module.exports = new DicomWebService();
