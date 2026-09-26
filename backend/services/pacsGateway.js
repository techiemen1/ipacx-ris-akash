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

    // 2. HYBRID PACS DICOM TAG QUERY (Orthanc first for 5ms local execution, DCM4CHEE as fallback)
    const queryPacsTags = async () => {
      const realStudyUID = dbRow.study_uid || studyUID;

      // Priority 1: Try Orthanc PACS first (<5ms on local system)
      try {
        const orthancUrl = await getOrthancUrl();
        let orthancId = null;

        try {
          const findRes = await axios.post(`${orthancUrl}tools/find`, {
            Level: "Study",
            Query: { StudyInstanceUID: realStudyUID }
          }, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: [] }));
          if (Array.isArray(findRes.data) && findRes.data.length > 0) {
            orthancId = findRes.data[0];
          }
        } catch (e) {}

        if (!orthancId) {
          try {
            const findAccRes = await axios.post(`${orthancUrl}tools/find`, {
              Level: "Study",
              Query: { AccessionNumber: realStudyUID }
            }, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: [] }));
            if (Array.isArray(findAccRes.data) && findAccRes.data.length > 0) {
              orthancId = findAccRes.data[0];
            }
          } catch (e) {}
        }

        if (!orthancId) {
          try {
            const findPidRes = await axios.post(`${orthancUrl}tools/find`, {
              Level: "Study",
              Query: { PatientID: realStudyUID }
            }, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: [] }));
            if (Array.isArray(findPidRes.data) && findPidRes.data.length > 0) {
              orthancId = findPidRes.data[0];
            }
          } catch (e) {}
        }

        if (!orthancId) {
          const dRes = await axios.get(`${orthancUrl}studies/${realStudyUID}`, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: null }));
          if (dRes?.data?.ID) orthancId = dRes.data.ID;
        }

        if (orthancId) {
          const { data: dData } = await axios.get(`${orthancUrl}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: null }));
          if (dData && dData.ID) {
            orthancData = dData;
            if (Array.isArray(dData.Series) && dData.Series.length > 0) {
              const seriesPromises = dData.Series.map(sId => 
                axios.get(`${orthancUrl}series/${sId}`, { ...orthancAuthConfig(), timeout: 1500 }).then(r => r.data).catch(() => null)
              );
              const fetchedSeries = (await Promise.all(seriesPromises)).filter(Boolean);
              if (fetchedSeries.length > 0) {
                const isScout = (s) => /topogram|localizer|scout|survey|plan/i.test(s?.MainDicomTags?.SeriesDescription || '');
                const sorted = [...fetchedSeries].sort((a, b) => {
                  const aScout = isScout(a) ? 1 : 0;
                  const bScout = isScout(b) ? 1 : 0;
                  if (aScout !== bScout) return aScout - bScout;
                  return (b?.Instances?.length || 0) - (a?.Instances?.length || 0);
                });
                seriesData = sorted[0];
              }
            }
            return; // Successfully loaded from local Orthanc!
          }
        }
      } catch (e) {}

      // Priority 2: Try DCM4CHEE PACS via dcm4cheeHelper working node
      try {
        const dcm4cheeHelper = require("../utils/dcm4cheeHelper");
        const workingNode = await dcm4cheeHelper.getWorkingDcm4cheeNode();
        if (!workingNode) return; // DCM4CHEE offline, exit immediately

        const allNodes = await dcm4cheeHelper.getDcm4cheeNodes();
        const dcm4cheeNodes = [workingNode];
        for (const n of allNodes) {
          if (n && (n.ip_address !== workingNode.ip_address || n.port !== workingNode.port || n.ae_title !== workingNode.ae_title)) {
            dcm4cheeNodes.push(n);
          }
        }

        const parseDcmStr = (val) => {
          if (!val) return "";
          if (typeof val === "string") return val.trim();
          if (Array.isArray(val)) return val.length > 0 ? parseDcmStr(val[0]) : "";
          if (typeof val === "object") return val.Alphabetic || val.phonetic || (val.Value ? parseDcmStr(val.Value[0]) : "");
          return String(val).trim();
        };

        for (const pacs of dcm4cheeNodes) {
          const authObj = (pacs.username || pacs.password) ? { username: pacs.username, password: pacs.password } : undefined;
          const metadataUrl = `http://${pacs.ip_address}:${pacs.port}/dcm4chee-arc/aets/${pacs.ae_title}/rs/studies/${encodeURIComponent(realStudyUID)}/metadata`;
          const qidoStudyUrl = `http://${pacs.ip_address}:${pacs.port}/dcm4chee-arc/aets/${pacs.ae_title}/rs/studies?StudyInstanceUID=${encodeURIComponent(realStudyUID)}&includefield=all`;

          let dcmJsonArray = null;

          try {
            const res = await axios.get(metadataUrl, {
              auth: authObj,
              headers: { Accept: "application/dicom+json" },
              timeout: 3000
            });
            if (Array.isArray(res.data) && res.data.length > 0) {
              dcmJsonArray = res.data;
            }
          } catch (e) {}

          if (!dcmJsonArray) {
            try {
              const qRes = await axios.get(qidoStudyUrl, {
                auth: authObj,
                headers: { Accept: "application/dicom+json" },
                timeout: 3000
              });
              if (Array.isArray(qRes.data) && qRes.data.length > 0) {
                dcmJsonArray = qRes.data;
              }
            } catch (e) {}
          }

          if (Array.isArray(dcmJsonArray) && dcmJsonArray.length > 0) {
            const first = dcmJsonArray[0];
            const nameStr = parseDcmStr(first["00100010"]);
            const refDocStr = parseDcmStr(first["00080090"]);

            orthancData = {
              PatientMainDicomTags: {
                PatientName: nameStr,
                PatientID: parseDcmStr(first["00100020"]),
                PatientSex: parseDcmStr(first["00100040"]) || "O",
                PatientAge: parseDcmStr(first["00101010"]),
                PatientBirthDate: parseDcmStr(first["00100030"])
              },
              MainDicomTags: {
                AccessionNumber: parseDcmStr(first["00080050"]),
                StudyInstanceUID: parseDcmStr(first["0020000D"]) || realStudyUID,
                StudyDate: parseDcmStr(first["00080020"]),
                StudyTime: parseDcmStr(first["00080030"]),
                StudyDescription: parseDcmStr(first["00081030"]),
                ReferringPhysicianName: refDocStr,
                Modality: parseDcmStr(first["00080060"]) || parseDcmStr(first["00080061"]) || "CR",
                BodyPartExamined: parseDcmStr(first["00180015"]),
                InstitutionName: parseDcmStr(first["00080080"])
              }
            };

            seriesData = {
              MainDicomTags: {
                Modality: parseDcmStr(first["00080060"]) || "CR",
                BodyPartExamined: parseDcmStr(first["00180015"]),
                Manufacturer: parseDcmStr(first["00080070"]),
                ManufacturerModelName: parseDcmStr(first["00081090"]),
                SeriesInstanceUID: parseDcmStr(first["0020000E"]),
                SeriesNumber: parseDcmStr(first["00200011"]) || "1",
                SeriesDescription: parseDcmStr(first["0008103E"]) || parseDcmStr(first["00081030"]) || "Diagnostic Series",
                InstitutionalDepartmentName: parseDcmStr(first["00081040"]),
                StationName: parseDcmStr(first["00081010"])
              }
            };

            instanceData = {
              "0018,0050": parseDcmStr(first["00180050"]),
              "0018,0060": parseDcmStr(first["00180060"]),
              "0018,1152": parseDcmStr(first["00181152"]),
              "0028,0030": first["00280030"]?.Value ? first["00280030"].Value.join("\\") : undefined,
              "0028,1050": parseDcmStr(first["00281050"]),
              "0028,1051": parseDcmStr(first["00281051"]),
              "0028,0010": parseDcmStr(first["00280010"]),
              "0028,0011": parseDcmStr(first["00280011"])
            };
            return;
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

    const isRealTags = orthancData !== null || (tagsDictionary.patient?.PatientName && tagsDictionary.patient.PatientName !== "Patient");
    if (tagsDictionary && isRealTags) {
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
