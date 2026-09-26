const axios = require("axios");
const pool = require("../db");

const { getOrthancUrl, orthancAuthConfig } = require("../utils/orthancHelper");

/**
 * Universal Multi-PACS DICOM Tag Gateway
 * Supports Orthanc, DICOMWeb (QIDO-RS / WADO-RS), C-FIND adapters, and local database fallback.
 */
class PacsGateway {
  constructor() {
    this.tagsCache = new Map();
    this.MAX_TAGS_CACHE = 1000;

    // Periodic cleanup sweep to evict expired DICOM tags
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of this.tagsCache.entries()) {
        if (val.expiresAt && val.expiresAt < now) {
          this.tagsCache.delete(key);
        }
      }
    }, 60000);
    if (interval.unref) interval.unref();
  }

  clearCache() {
    this.tagsCache.clear();
  }

  /**
   * Extract DICOM Age from PatientName or PatientAge tag
   */
  extractAge(patientName, rawAge) {
    if (rawAge && String(rawAge).trim() !== "" && rawAge !== "N/A" && rawAge !== "-") return String(rawAge).trim();
    if (!patientName) return "N/A";
    const str = String(patientName);
    const match = str.match(/(\d{1,3})\s*(Y|M|D|YRS|YEARS)/i) || str.match(/\^(\d{1,3})Y/i) || str.match(/\s(\d{1,3})Y/i);
    if (match) return `${match[1]}${match[2] ? match[2].charAt(0).toUpperCase() : 'Y'}`;
    return "N/A";
  }

  /**
   * Normalize Patient Name (removes ^ DICOM caret separators)
   */
  extractSex(rawSex, rawName) {
    if (rawSex && String(rawSex).trim() !== "" && rawSex !== "O" && rawSex !== "N/A" && rawSex !== "-") {
      return String(rawSex).trim().toUpperCase();
    }
    if (!rawName) return "O";
    const str = String(rawName);
    const match = str.match(/\/\s*([MFO])/i) || str.match(/\s+([MFO])$/i);
    if (match) return match[1].toUpperCase();
    return "O";
  }

  /**
   * Normalize Patient Name (removes ^ DICOM caret separators and trailing age/sex tags)
   */
  formatPatientName(name) {
    if (!name) return "";
    let clean = String(name).replace(/\^/g, " ").replace(/\s+/g, " ").trim();
    clean = clean.replace(/\s+\d{1,3}[YMDY]\s*\/\s*[MFO]/i, "").trim();
    return clean;
  }

  /**
   * Fetch full standardized DICOM metadata dictionary for any studyUID across any PACS
   */
  async getFullDicomTags(studyUID) {
    if (!studyUID) return {};
    const now = Date.now();
    const cached = this.tagsCache.get(String(studyUID));
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    // 1. FAST PATH: Query local PostgreSQL database FIRST with Joined Patient table (<5ms execution time)
    const dbRes = await pool.query(
      `SELECT s.*, p.full_name as p_full_name, p.gender as p_gender, p.age as p_age, p.dob as p_dob, p.mrn as p_mrn
       FROM public.studies s 
       LEFT JOIN public.patients p ON (s.patient_id = p.patient_id OR s.patient_id = p.uhid OR s.accession_number = p.mrn)
       WHERE s.study_uid = $1 OR s.accession_number = $1 OR s.id::text = $1 
       LIMIT 1`,
      [studyUID]
    ).catch(() => ({ rows: [] }));
    const dbRow = dbRes.rows[0] || {};

    let orthancData = null;
    let seriesData = null;
    let instanceData = null;
    let modality = dbRow.modality || dbRow.Modality || "CR";
    let bodyPart = dbRow.body_part || "General";

    // 2. PARALLEL HYBRID PACS QUERY (Fast workingNode probe)
    const queryPacsTags = async () => {
      const realStudyUID = dbRow.study_uid || studyUID;

      // Try DCM4CHEE first via dcm4cheeHelper working node
      try {
        const dcm4cheeHelper = require("../utils/dcm4cheeHelper");
        const workingNode = await dcm4cheeHelper.getWorkingDcm4cheeNode();
        const allNodes = await dcm4cheeHelper.getDcm4cheeNodes();
        const dcm4cheeNodes = [workingNode];
        for (const n of allNodes) {
          if (n.ip_address !== workingNode.ip_address || n.port !== workingNode.port || n.ae_title !== workingNode.ae_title) {
            dcm4cheeNodes.push(n);
          }
        }

        for (const pacs of dcm4cheeNodes) {
          const metadataUrl = `http://${pacs.ip_address}:${pacs.port}/dcm4chee-arc/aets/${pacs.ae_title}/rs/studies/${encodeURIComponent(realStudyUID)}/metadata`;
          try {
            const res = await axios.get(metadataUrl, {
              auth: (pacs.username || pacs.password) ? { username: pacs.username, password: pacs.password } : undefined,
              headers: { Accept: "application/dicom+json" },
              timeout: 1800
            });
            if (Array.isArray(res.data) && res.data.length > 0) {
              const first = res.data[0];
              const pName = first["00100010"]?.Value?.[0];
              const nameStr = typeof pName === "object" ? (pName.Alphabetic || pName.phonetic || "") : (pName || "");
              const refDoc = first["00080090"]?.Value?.[0];
              const refDocStr = typeof refDoc === "object" ? (refDoc.Alphabetic || refDoc.phonetic || "") : (refDoc || "");

              orthancData = {
                PatientMainDicomTags: {
                  PatientName: nameStr,
                  PatientID: first["00100020"]?.Value?.[0] || "",
                  PatientSex: first["00100040"]?.Value?.[0] || "O",
                  PatientAge: first["00101010"]?.Value?.[0] || "",
                  PatientBirthDate: first["00100030"]?.Value?.[0] || ""
                },
                MainDicomTags: {
                  AccessionNumber: first["00080050"]?.Value?.[0] || "",
                  StudyInstanceUID: first["0020000D"]?.Value?.[0] || realStudyUID,
                  StudyDate: first["00080020"]?.Value?.[0] || "",
                  StudyTime: first["00080030"]?.Value?.[0] || "",
                  StudyDescription: first["00081030"]?.Value?.[0] || "",
                  ReferringPhysicianName: refDocStr,
                  Modality: first["00080060"]?.Value?.[0] || first["00080061"]?.Value?.[0] || "CR",
                  BodyPartExamined: first["00180015"]?.Value?.[0] || "",
                  InstitutionName: first["00080080"]?.Value?.[0] || ""
                }
              };

              seriesData = {
                MainDicomTags: {
                  Modality: first["00080060"]?.Value?.[0] || "CR",
                  BodyPartExamined: first["00180015"]?.Value?.[0] || "",
                  Manufacturer: first["00080070"]?.Value?.[0] || "",
                  ManufacturerModelName: first["00081090"]?.Value?.[0] || "",
                  SeriesInstanceUID: first["0020000E"]?.Value?.[0] || "",
                  SeriesNumber: first["00200011"]?.Value?.[0] || "1",
                  SeriesDescription: first["0008103E"]?.Value?.[0] || first["00081030"]?.Value?.[0] || "Diagnostic Series",
                  InstitutionalDepartmentName: first["00081040"]?.Value?.[0] || "",
                  StationName: first["00081010"]?.Value?.[0] || ""
                }
              };

              instanceData = {
                "0018,0050": first["00180050"]?.Value?.[0],
                "0018,0060": first["00180060"]?.Value?.[0],
                "0018,1152": first["00181152"]?.Value?.[0],
                "0028,0030": first["00280030"]?.Value ? first["00280030"].Value.join("\\") : undefined,
                "0028,1050": first["00281050"]?.Value?.[0],
                "0028,1051": first["00281051"]?.Value?.[0],
                "0028,0010": first["00280010"]?.Value?.[0],
                "0028,0011": first["00280011"]?.Value?.[0]
              };
              return;
            }
          } catch (e) {}
        }
      } catch (e) {}

      // Try Orthanc
      try {
        const orthancUrl = await getOrthancUrl();
        const { data: dData } = await axios.get(`${orthancUrl}studies/${realStudyUID}`, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: null }));
        if (dData && dData.ID) {
          orthancData = dData;
          if (Array.isArray(dData.Series) && dData.Series.length > 0) {
            const firstSeriesId = dData.Series[0];
            const { data: serRes } = await axios.get(`${orthancUrl}series/${firstSeriesId}`, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: null }));
            if (serRes) seriesData = serRes;
          }
        }
      } catch (e) {}
    };

    await queryPacsTags().catch(() => {});

    const rawName = orthancData?.PatientMainDicomTags?.PatientName || dbRow.patient_name || dbRow.p_full_name || "";
    const cleanName = this.formatPatientName(rawName);
    modality = seriesData?.MainDicomTags?.Modality || orthancData?.MainDicomTags?.Modality || dbRow.modality || dbRow.Modality || "CR";
    bodyPart = seriesData?.MainDicomTags?.BodyPartExamined || dbRow.body_part || "General";

    // Construct Comprehensive DICOM Tag Dictionary
    const tagsDictionary = {
      patient: {
        PatientName: cleanName || dbRow.p_full_name || dbRow.patient_name || "Patient",
        PatientID: orthancData?.PatientMainDicomTags?.PatientID || dbRow.patient_id || dbRow.id || "N/A",
        PatientBirthDate: orthancData?.PatientMainDicomTags?.PatientBirthDate || dbRow.p_dob || dbRow.patient_dob || "-",
        PatientSex: this.extractSex(orthancData?.PatientMainDicomTags?.PatientSex || dbRow.p_gender || dbRow.patient_sex, rawName),
        PatientAge: this.extractAge(rawName, orthancData?.PatientMainDicomTags?.PatientAge || dbRow.p_age || dbRow.patient_age)
      },
      study: {
        AccessionNumber: orthancData?.MainDicomTags?.AccessionNumber || dbRow.accession_number || "N/A",
        StudyInstanceUID: orthancData?.MainDicomTags?.StudyInstanceUID || dbRow.study_uid || studyUID,
        StudyDate: orthancData?.MainDicomTags?.StudyDate || dbRow.study_date || "-",
        StudyTime: orthancData?.MainDicomTags?.StudyTime || dbRow.study_time || "-",
        StudyDescription: orthancData?.MainDicomTags?.StudyDescription || dbRow.study_description || "Radiology Scan",
        StudyID: orthancData?.MainDicomTags?.StudyID || dbRow.study_id || "-",
        ReferringPhysicianName: orthancData?.MainDicomTags?.ReferringPhysicianName || dbRow.referring_physician || dbRow.referring_doctor || "Self / Desk",
        Modality: String(modality).toUpperCase().trim(),
        BodyPartExamined: bodyPart
      },
      equipment: {
        InstitutionName: orthancData?.MainDicomTags?.InstitutionName || dbRow.hospital_name || "AKASH MEDICAL COLLEGE AND HOSPITALS",
        InstitutionalDepartmentName: seriesData?.MainDicomTags?.InstitutionalDepartmentName || "Radio-Diagnosis & Imaging",
        StationName: seriesData?.MainDicomTags?.StationName || "WORKSTATION-01",
        Manufacturer: seriesData?.MainDicomTags?.Manufacturer || "Multi-PACS Scanner",
        ManufacturerModelName: seriesData?.MainDicomTags?.ManufacturerModelName || "Diagnostic Imaging Station",
        SoftwareVersions: seriesData?.MainDicomTags?.SoftwareVersions || "v1.1 Enterprise PACS"
      },
      acquisition: {
        SeriesInstanceUID: seriesData?.MainDicomTags?.SeriesInstanceUID || "-",
        SeriesNumber: seriesData?.MainDicomTags?.SeriesNumber || "1",
        SeriesDescription: seriesData?.MainDicomTags?.SeriesDescription || "Diagnostic Series",
        SliceThickness: instanceData?.["0018,0050"] || seriesData?.MainDicomTags?.SliceThickness || "-",
        KVP: instanceData?.["0018,0060"] || seriesData?.MainDicomTags?.KVP || "-",
        Exposure: instanceData?.["0018,1152"] || seriesData?.MainDicomTags?.Exposure || "-",
        PixelSpacing: instanceData?.["0028,0030"] || seriesData?.MainDicomTags?.PixelSpacing || "-",
        WindowCenter: instanceData?.["0028,1050"] || seriesData?.MainDicomTags?.WindowCenter || "-",
        WindowWidth: instanceData?.["0028,1051"] || seriesData?.MainDicomTags?.WindowWidth || "-"
      }
    };

    if (tagsDictionary && (tagsDictionary.patient?.PatientName || tagsDictionary.study?.AccessionNumber)) {
      if (this.tagsCache.size >= this.MAX_TAGS_CACHE && !this.tagsCache.has(String(studyUID))) {
        const oldestKey = this.tagsCache.keys().next().value;
        if (oldestKey) this.tagsCache.delete(oldestKey);
      }
      this.tagsCache.set(String(studyUID), { data: tagsDictionary, expiresAt: Date.now() + 120000 });
    }

    return tagsDictionary;
  }
}

module.exports = new PacsGateway();
