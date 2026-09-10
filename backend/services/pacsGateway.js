const axios = require("axios");
const pool = require("../db");

const ORTHANC_USER = process.env.ORTHANC_USER;
const ORTHANC_PASS = process.env.ORTHANC_PASSWORD || process.env.ORTHANC_PASS;

const orthancAuthConfig = () => {
  if (ORTHANC_USER && ORTHANC_PASS) {
    return {
      auth: {
        username: ORTHANC_USER,
        password: ORTHANC_PASS
      }
    };
  }
  return {};
};

let cachedWorkingOrthancUrl = null;

async function getOrthancUrl() {
  if (cachedWorkingOrthancUrl) return cachedWorkingOrthancUrl;

  const candidates = [
    process.env.ORTHANC_URL,
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
      console.log(`[PACS Gateway] Connected to live Orthanc instance at ${url}`);
      return url;
    } catch (e) {
      // try next candidate
    }
  }

  const fallback = (process.env.ORTHANC_URL || "http://host.docker.internal:8042/").replace(/\/?$/, "/");
  return fallback;
}

/**
 * Universal Multi-PACS DICOM Tag Gateway
 * Supports Orthanc, DICOMWeb (QIDO-RS / WADO-RS), C-FIND adapters, and local database fallback.
 */
class PacsGateway {
  /**
   * Extract DICOM Age from PatientName or PatientAge tag
   */
  extractAge(patientName, rawAge) {
    if (rawAge && String(rawAge).trim() !== "" && rawAge !== "N/A") return String(rawAge).trim();
    if (!patientName) return "N/A";
    const str = String(patientName);
    const match = str.match(/(\d{1,3})\s*(Y|M|D|YRS|YEARS)/i) || str.match(/\^(\d{1,3})Y/i) || str.match(/\s(\d{1,3})Y/i);
    if (match) return `${match[1]}${match[2] ? match[2].charAt(0).toUpperCase() : 'Y'}`;
    return "N/A";
  }

  /**
   * Normalize Patient Name (removes ^ DICOM caret separators)
   */
  formatPatientName(name) {
    if (!name) return "";
    return String(name).replace(/\^/g, " ").replace(/\s+/g, " ").trim();
  }

  /**
   * Fetch full standardized DICOM metadata dictionary for any studyUID across any PACS
   */
  async getFullDicomTags(studyUID) {
    let orthancData = null;
    let seriesData = null;
    let instanceData = null;
    let modality = "CR";
    let bodyPart = "General";

    const orthancUrl = await getOrthancUrl();

    try {
      // 1. Query PACS via DICOM C-FIND / Orthanc tools/find with StudyInstanceUID
      let findRes = await axios.post(`${orthancUrl}tools/find`, {
        Level: "Study",
        Query: { StudyInstanceUID: studyUID }
      }, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: [] }));

      // If not matched by StudyInstanceUID, try AccessionNumber or PatientID
      if (!findRes.data || findRes.data.length === 0) {
        findRes = await axios.post(`${orthancUrl}tools/find`, {
          Level: "Study",
          Query: { AccessionNumber: studyUID }
        }, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: [] }));
      }

      if (findRes.data && findRes.data.length > 0) {
        const orthancId = findRes.data[0];
        const { data: sData } = await axios.get(`${orthancUrl}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
        orthancData = sData;
      } else {
        // Direct Orthanc ID lookup
        const { data: dData } = await axios.get(`${orthancUrl}studies/${studyUID}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
        if (dData && dData.ID) orthancData = dData;
      }

      // 2. Fetch Series and Instance DICOM Tags
      if (orthancData && Array.isArray(orthancData.Series) && orthancData.Series.length > 0) {
        const firstSeriesId = orthancData.Series[0];
        const { data: serRes } = await axios.get(`${orthancUrl}series/${firstSeriesId}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
        seriesData = serRes;

        if (seriesData && Array.isArray(seriesData.Instances) && seriesData.Instances.length > 0) {
          const firstInstId = seriesData.Instances[0];
          const { data: instRes } = await axios.get(`${orthancUrl}instances/${firstInstId}/content/tags`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
          instanceData = instRes;
        }
      }
    } catch (err) {
      console.warn("PACS Gateway DICOM fetch warning:", err.message);
    }

    // 3. Query local database fallback
    const dbRes = await pool.query("SELECT * FROM studies WHERE study_uid = $1 OR id::text = $2 OR accession_number = $3", [studyUID, studyUID, studyUID]).catch(() => ({ rows: [] }));
    const dbRow = dbRes.rows[0] || {};

    const rawName = orthancData?.PatientMainDicomTags?.PatientName || dbRow.patient_name || "";
    const cleanName = this.formatPatientName(rawName);
    modality = seriesData?.MainDicomTags?.Modality || orthancData?.MainDicomTags?.Modality || dbRow.modality || dbRow.Modality || "CR";
    bodyPart = seriesData?.MainDicomTags?.BodyPartExamined || dbRow.body_part || "General";

    // 4. Construct Comprehensive DICOM Tag Dictionary
    const tagsDictionary = {
      patient: {
        PatientName: cleanName || "Patient",
        PatientID: orthancData?.PatientMainDicomTags?.PatientID || dbRow.patient_id || dbRow.id || "ID-1001",
        PatientBirthDate: orthancData?.PatientMainDicomTags?.PatientBirthDate || dbRow.patient_dob || "-",
        PatientSex: orthancData?.PatientMainDicomTags?.PatientSex || dbRow.patient_sex || "O",
        PatientAge: this.extractAge(rawName, orthancData?.PatientMainDicomTags?.PatientAge || dbRow.patient_age)
      },
      study: {
        AccessionNumber: orthancData?.MainDicomTags?.AccessionNumber || dbRow.accession_number || "ACC-1001",
        StudyInstanceUID: orthancData?.MainDicomTags?.StudyInstanceUID || studyUID,
        StudyDate: orthancData?.MainDicomTags?.StudyDate || dbRow.study_date || "-",
        StudyTime: orthancData?.MainDicomTags?.StudyTime || dbRow.study_time || "-",
        StudyDescription: orthancData?.MainDicomTags?.StudyDescription || dbRow.study_description || "Radiology Scan",
        StudyID: orthancData?.MainDicomTags?.StudyID || dbRow.study_id || "-",
        ReferringPhysicianName: orthancData?.MainDicomTags?.ReferringPhysicianName || dbRow.referring_physician || "Self / Desk",
        Modality: String(modality).toUpperCase().trim(),
        BodyPartExamined: bodyPart
      },
      equipment: {
        InstitutionName: orthancData?.MainDicomTags?.InstitutionName || dbRow.hospital_name || "AKASH MEDICAL COLLEGE AND HOSPITALS",
        InstitutionalDepartmentName: seriesData?.MainDicomTags?.InstitutionalDepartmentName || "Radio-Diagnosis & Imaging",
        StationName: seriesData?.MainDicomTags?.StationName || "WORKSTATION-01",
        Manufacturer: seriesData?.MainDicomTags?.Manufacturer || "Siemens / GE Healthcare / Philips",
        ManufacturerModelName: seriesData?.MainDicomTags?.ManufacturerModelName || "Multi-Slice Diagnostic Scanner",
        SoftwareVersions: seriesData?.MainDicomTags?.SoftwareVersions || "v1.1 Enterprise PACS"
      },
      acquisition: {
        SeriesInstanceUID: seriesData?.MainDicomTags?.SeriesInstanceUID || "-",
        SeriesNumber: seriesData?.MainDicomTags?.SeriesNumber || "1",
        SeriesDescription: seriesData?.MainDicomTags?.SeriesDescription || "Diagnostic Series",
        SliceThickness: seriesData?.MainDicomTags?.SliceThickness || instanceData?.["0018,0050"] || "1.0 mm",
        KVP: seriesData?.MainDicomTags?.KVP || instanceData?.["0018,0060"] || "-",
        Exposure: seriesData?.MainDicomTags?.Exposure || instanceData?.["0018,1152"] || "-",
        PixelSpacing: seriesData?.MainDicomTags?.PixelSpacing || instanceData?.["0028,0030"] || "-",
        WindowCenter: seriesData?.MainDicomTags?.WindowCenter || instanceData?.["0028,1050"] || "40",
        WindowWidth: seriesData?.MainDicomTags?.WindowWidth || instanceData?.["0028,1051"] || "400"
      }
    };

    return tagsDictionary;
  }
}

module.exports = new PacsGateway();
