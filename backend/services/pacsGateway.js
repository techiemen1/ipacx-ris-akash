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
  formatPatientName(name) {
    if (!name) return "";
    return String(name).replace(/\^/g, " ").replace(/\s+/g, " ").trim();
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

      // 1.5 Query DCM4CHEE / Multi-PACS active nodes if Orthanc didn't return data
      if (!orthancData) {
        try {
          const PacsRepository = require("../repositories/PacsRepository");
          const pacsRepo = new PacsRepository(pool);
          const activePacs = await pacsRepo.findActive().catch(() => []);
          const dcm4cheeNodes = activePacs.filter(p => String(p.pacs_type).toUpperCase() === "DCM4CHEE");

          for (const pacs of dcm4cheeNodes) {
            const ports = [parseInt(pacs.port, 10), 8080, 8085].filter(Boolean);
            const uniquePorts = [...new Set(ports)];

            for (const port of uniquePorts) {
              const metadataUrl = `http://${pacs.ip_address}:${port}/dcm4chee-arc/aets/${pacs.ae_title}/rs/studies/${studyUID}/metadata`;
              try {
                const res = await axios.get(metadataUrl, {
                  ...orthancAuthConfig(pacs.username || process.env.DCM4CHEE_USER, pacs.password || process.env.DCM4CHEE_PASS),
                  headers: { Accept: "application/dicom+json" },
                  timeout: 5000
                });
                if (Array.isArray(res.data) && res.data.length > 0) {
                  const first = res.data[0];
                  const pName = first["00100010"]?.Value?.[0];
                  const nameStr = typeof pName === "object" ? (pName.Alphabetic || pName.phonetic || "") : (pName || "");

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
                      StudyInstanceUID: first["0020000D"]?.Value?.[0] || studyUID,
                      StudyDate: first["00080020"]?.Value?.[0] || "",
                      StudyTime: first["00080030"]?.Value?.[0] || "",
                      StudyDescription: first["00081030"]?.Value?.[0] || "",
                      ReferringPhysicianName: first["00080090"]?.Value?.[0] || "",
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
                  break;
                }
              } catch (e) {}
            }
            if (orthancData) break;
          }
        } catch (e) {
          console.warn("[PacsGateway] DCM4CHEE fallback failed:", e.message);
        }
      }

      // 2. Fetch Series and Instance DICOM Tags for Orthanc
      if (orthancData && Array.isArray(orthancData.Series) && orthancData.Series.length > 0) {
        const firstSeriesId = orthancData.Series[0];
        const { data: serRes } = await axios.get(`${orthancUrl}series/${firstSeriesId}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
        if (serRes) seriesData = serRes;

        if (seriesData && Array.isArray(seriesData.Instances) && seriesData.Instances.length > 0) {
          const firstInstId = seriesData.Instances[0];
          const { data: instRes } = await axios.get(`${orthancUrl}instances/${firstInstId}/tags?simplified`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
          if (instRes) instanceData = instRes;
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
        PatientName: cleanName || dbRow.patient_name || "Patient",
        PatientID: orthancData?.PatientMainDicomTags?.PatientID || dbRow.patient_id || dbRow.id || "N/A",
        PatientBirthDate: orthancData?.PatientMainDicomTags?.PatientBirthDate || dbRow.patient_dob || "-",
        PatientSex: orthancData?.PatientMainDicomTags?.PatientSex || dbRow.patient_sex || "O",
        PatientAge: this.extractAge(rawName, orthancData?.PatientMainDicomTags?.PatientAge || dbRow.patient_age)
      },
      study: {
        AccessionNumber: orthancData?.MainDicomTags?.AccessionNumber || dbRow.accession_number || "N/A",
        StudyInstanceUID: orthancData?.MainDicomTags?.StudyInstanceUID || studyUID,
        StudyDate: orthancData?.MainDicomTags?.StudyDate || dbRow.study_date || "-",
        StudyTime: orthancData?.MainDicomTags?.StudyTime || dbRow.study_time || "-",
        StudyDescription: orthancData?.MainDicomTags?.StudyDescription || dbRow.study_description || "Radiology Scan",
        StudyID: orthancData?.MainDicomTags?.StudyID || dbRow.study_id || "-",
        ReferringPhysicianName: orthancData?.MainDicomTags?.ReferringPhysicianName || dbRow.referring_physician || "-",
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
      this.tagsCache.set(String(studyUID), { data: tagsDictionary, expiresAt: Date.now() + 120000 });
    }

    return tagsDictionary;
  }
}

module.exports = new PacsGateway();
