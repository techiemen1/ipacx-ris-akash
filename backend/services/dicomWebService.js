const axios = require("axios");
const { getOrthancUrl, orthancAuthConfig, extractCleanInstanceId } = require("../utils/orthancHelper");

class DicomWebService {
  /**
   * QIDO-RS: Search Studies via DICOMweb /dicom-web/studies or Orthanc fallback
   */
  async searchStudies(queryParams = {}) {
    const orthancUrl = await getOrthancUrl();
    try {
      const dicomWebUrl = `${orthancUrl}dicom-web/studies`;
      const response = await axios.get(dicomWebUrl, {
        params: queryParams,
        headers: { Accept: "application/dicom+json" },
        ...orthancAuthConfig(),
      });
      return response.data;
    } catch (err) {
      console.warn("[DICOMweb] QIDO-RS fallback to Orthanc tools/find:", err.message);
      // Fallback to Orthanc tools/find
      const payload = { Level: "Study", Query: queryParams, Limit: 100 };
      const { data: ids } = await axios.post(`${orthancUrl}tools/find`, payload, orthancAuthConfig());
      return Promise.all(ids.map((id) => axios.get(`${orthancUrl}studies/${id}`, orthancAuthConfig()).then((r) => r.data)));
    }
  }

  /**
   * WADO-RS: Retrieve Study Metadata /dicom-web/studies/{studyUID}/metadata
   */
  async getStudyMetadata(studyUID) {
    const orthancUrl = await getOrthancUrl();
    const dicomWebUrl = `${orthancUrl}dicom-web/studies/${studyUID}/metadata`;
    try {
      const response = await axios.get(dicomWebUrl, {
        headers: { Accept: "application/dicom+json" },
        ...orthancAuthConfig(),
      });
      return response.data;
    } catch (err) {
      console.warn("[DICOMweb] WADO-RS Metadata fallback:", err.message);
      const findRes = await axios.post(`${orthancUrl}tools/find`, { Level: "Study", Query: { StudyInstanceUID: studyUID } }, orthancAuthConfig());
      if (!findRes.data.length) throw new Error("Study not found");
      const studyId = findRes.data[0];
      const res = await axios.get(`${orthancUrl}studies/${studyId}`, orthancAuthConfig());
      return res.data;
    }
  }

  /**
   * STOW-RS: Store DICOM instance file directly to Orthanc
   */
  async storeDicomInstance(buffer, contentType = "application/dicom") {
    const orthancUrl = await getOrthancUrl();
    const response = await axios.post(`${orthancUrl}instances`, buffer, {
      headers: { "Content-Type": contentType },
      ...orthancAuthConfig(),
    });
    return response.data;
  }

  /**
   * QIDO-RS / WADO-RS: Retrieve Study Instances list
   */
  async getStudyInstances(studyUID) {
    const orthancUrl = await getOrthancUrl();
    try {
      const dicomWebUrl = `${orthancUrl}dicom-web/studies/${studyUID}/instances`;
      const response = await axios.get(dicomWebUrl, {
        headers: { Accept: "application/dicom+json" },
        ...orthancAuthConfig(),
      });
      return response.data;
    } catch (err) {
      console.warn("[DICOMweb] Fallback for getStudyInstances:", err.message);
      const findRes = await axios.post(`${orthancUrl}tools/find`, { Level: "Study", Query: { StudyInstanceUID: studyUID } }, orthancAuthConfig());
      if (!findRes.data.length) return [];
      const studyId = findRes.data[0];
      const res = await axios.get(`${orthancUrl}studies/${studyId}/instances`, orthancAuthConfig());
      return (res.data || []).map((inst, idx) => ({
        "00080018": { Value: [inst.MainDicomTags?.SOPInstanceUID || inst.ID] },
        "0020000E": { Value: [inst.ParentSeries || "series-1"] },
        "00200013": { Value: [String(inst.MainDicomTags?.InstanceNumber || idx + 1)] }
      }));
    }
  }

  /**
   * WADO-RS: Rendered JPEG Instance Stream
   */
  async getRenderedInstance(instanceId) {
    const cleanId = extractCleanInstanceId(instanceId);
    const orthancUrl = await getOrthancUrl();
    const response = await axios.get(`${orthancUrl}instances/${cleanId}/preview`, {
      responseType: "stream",
      ...orthancAuthConfig(),
    });
    return response.data;
  }
}

module.exports = new DicomWebService();
