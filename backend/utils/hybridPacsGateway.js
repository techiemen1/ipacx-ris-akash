const axios = require("axios");
const pool = require("../db");
const { getOrthancUrl, orthancAuthConfig, extractCleanInstanceId } = require("./orthancHelper");
const dcm4cheeHelper = require("./dcm4cheeHelper");

/**
 * Hybrid Universal PACS & VNA Gateway Architecture
 * Seamlessly interfaces Orthanc, DCM4CHEE-ARC, Generic DICOMweb, Enterprise VNAs,
 * and Multi-PACS Nodes into a single unified adapter.
 */
class HybridPacsGateway {
  /**
   * Discovers all registered and active PACS / VNA nodes across Database & Environment
   */
  async getAllActivePacsNodes() {
    const nodes = [];

    // 1. DCM4CHEE & DCM4CHEE-ARC nodes from helper (includes DB + ENV + Default Container Fallbacks)
    try {
      const dcmNodes = await dcm4cheeHelper.getDcm4cheeNodes();
      nodes.push(...dcmNodes);
    } catch (e) {}

    // 2. Query DB table pacs for all active nodes (Orthanc, DICOMweb, VNA, Generic)
    try {
      const { rows } = await pool.query(
        "SELECT * FROM public.pacs WHERE is_active = true ORDER BY id ASC"
      ).catch(() => ({ rows: [] }));

      for (const r of rows) {
        const type = String(r.pacs_type || "PACS").toUpperCase();
        nodes.push({
          id: r.id,
          pacs_name: r.pacs_name || "Generic_PACS",
          pacs_type: type,
          ae_title: String(r.ae_title || "PACS").trim(),
          ip_address: String(r.ip_address || "127.0.0.1").trim(),
          port: parseInt(r.port || 8080, 10),
          username: r.username || null,
          password: r.password || null
        });
      }
    } catch (e) {}

    // Deduplicate nodes by IP, Port and AE Title
    const uniqueNodes = [];
    const seen = new Set();
    for (const n of nodes) {
      const key = `${n.ip_address}:${n.port}:${n.ae_title}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueNodes.push(n);
      }
    }

    return uniqueNodes;
  }

  /**
   * Fetches study series & instances from ALL connected PACS/VNA sources in parallel/hybrid fallback order.
   * Priority 1: Orthanc
   * Priority 2: DCM4CHEE / DCM4CHEE-ARC
   * Priority 3: Generic DICOMweb / VNA nodes
   */
  async fetchHybridSeriesAndInstances(studyUID) {
    if (!studyUID) return [];

    // 1. Try Orthanc PACS
    try {
      const orthancUrl = await getOrthancUrl();
      let orthancId = null;

      try {
        const fRes = await axios.post(`${orthancUrl}tools/find`, {
          Level: "Study",
          Query: { StudyInstanceUID: studyUID }
        }, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: [] }));
        if (fRes.data && fRes.data.length > 0) orthancId = fRes.data[0];
      } catch (e) {}

      if (!orthancId) {
        const dRes = await axios.get(`${orthancUrl}studies/${studyUID}`, { ...orthancAuthConfig(), timeout: 3000 }).catch(() => ({ data: null }));
        if (dRes?.data?.ID) orthancId = dRes.data.ID;
      }

      if (orthancId) {
        const { data: studyData } = await axios.get(`${orthancUrl}studies/${orthancId}`, { ...orthancAuthConfig(), timeout: 4000 }).catch(() => ({ data: null }));
        if (studyData && Array.isArray(studyData.Series) && studyData.Series.length > 0) {
          const orthSeries = await this.fetchOrthancSeries(orthancUrl, studyData);
          if (orthSeries && orthSeries.length > 0) return orthSeries;
        }
      }
    } catch (e) {
      console.warn("[Hybrid PACS] Orthanc series lookup notice:", e.message);
    }

    // 2. Try DCM4CHEE / DCM4CHEE-ARC via QIDO-RS
    try {
      const dcmSeries = await dcm4cheeHelper.searchDcm4cheeSeriesAndInstances(studyUID);
      if (Array.isArray(dcmSeries) && dcmSeries.length > 0) {
        return dcmSeries;
      }
    } catch (e) {
      console.warn("[Hybrid PACS] DCM4CHEE series search notice:", e.message);
    }

    // 3. Try Generic DICOMweb / VNA active nodes
    try {
      const nodes = await this.getAllActivePacsNodes();
      for (const node of nodes) {
        if (String(node.pacs_type).toUpperCase().includes("DCM4CHEE")) continue; // already tried

        const host = node.ip_address;
        const port = node.port;
        const aet = node.ae_title;
        const auth = (node.username || node.password) ? { auth: { username: node.username, password: node.password } } : {};

        const qidoUrls = [
          `http://${host}:${port}/dicom-web/studies/${studyUID}/series`,
          `http://${host}:${port}/rs/studies/${studyUID}/series`,
          `http://${host}:${port}/aets/${aet}/rs/studies/${studyUID}/series`
        ];

        for (const qUrl of qidoUrls) {
          try {
            const sRes = await axios.get(qUrl, {
              ...auth,
              headers: { Accept: "application/dicom+json" },
              timeout: 4000
            });

            if (Array.isArray(sRes.data) && sRes.data.length > 0) {
              const seriesList = [];
              for (let sIdx = 0; sIdx < sRes.data.length; sIdx++) {
                const serObj = sRes.data[sIdx];
                const seriesUid = serObj["0020000E"]?.Value?.[0];
                const seriesDesc = serObj["0008103E"]?.Value?.[0] || serObj["00081030"]?.Value?.[0] || `Series ${sIdx + 1}`;
                const seriesNum = parseInt(serObj["00200011"]?.Value?.[0] || (sIdx + 1), 10);
                const sModality = serObj["00080060"]?.Value?.[0] || "";

                if (!seriesUid) continue;

                const instUrl = `${qUrl}/${seriesUid}/instances`;
                const iRes = await axios.get(instUrl, {
                  ...auth,
                  headers: { Accept: "application/dicom+json" },
                  timeout: 4000
                }).catch(() => ({ data: [] }));

                let instances = [];
                if (Array.isArray(iRes.data) && iRes.data.length > 0) {
                  iRes.data.sort((a, b) => {
                    const numA = parseInt(a["00200013"]?.Value?.[0] || 0, 10);
                    const numB = parseInt(b["00200013"]?.Value?.[0] || 0, 10);
                    return numA - numB;
                  });

                  instances = iRes.data.map((inst, iIdx) => {
                    const sopUid = inst["00080018"]?.Value?.[0];
                    const sliceNum = parseInt(inst["00200013"]?.Value?.[0] || (iIdx + 1), 10);
                    const pUrl = `/api/pacs/instance-preview/${sopUid}?studyUID=${encodeURIComponent(studyUID)}&seriesUID=${encodeURIComponent(seriesUid)}&pacsId=${node.id}`;
                    return {
                      id: sopUid,
                      instance_id: sopUid,
                      sop_instance_uid: sopUid,
                      slice_number: sliceNum,
                      instanceNumber: sliceNum,
                      instance_number: sliceNum,
                      slice_index: iIdx + 1,
                      previewUrl: pUrl,
                      preview_url: pUrl,
                      caption: `${seriesDesc} | Slice ${sliceNum}/${iRes.data.length}`
                    };
                  });
                }

                seriesList.push({
                  seriesId: seriesUid,
                  series_id: seriesUid,
                  series_instance_uid: seriesUid,
                  seriesDescription: seriesDesc,
                  series_description: seriesDesc,
                  seriesNumber: seriesNum,
                  series_number: seriesNum,
                  modality: sModality,
                  totalSlices: instances.length,
                  total_slices: instances.length,
                  instances
                });
              }

              if (seriesList.length > 0) return seriesList;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return [];
  }

  /**
   * Helper to fetch Orthanc series structure
   */
  async fetchOrthancSeries(orthancUrl, studyData) {
    const config = orthancAuthConfig();
    const seriesPromises = studyData.Series.map((seriesId, sIdx) =>
      axios.get(`${orthancUrl}series/${seriesId}`, { ...config, timeout: 5000 })
        .then(async (r) => {
          if (!r.data) return null;
          const sData = r.data;
          const sDesc = sData.MainDicomTags?.SeriesDescription || `Series ${sIdx + 1}`;
          const sNum = parseInt(sData.MainDicomTags?.SeriesNumber || (sIdx + 1), 10);
          const sModality = sData.MainDicomTags?.Modality || "";

          let orderedInstances = [];
          try {
            const { data: expInstances } = await axios.get(`${orthancUrl}series/${seriesId}/instances?expand`, { ...config, timeout: 5000 });
            if (Array.isArray(expInstances) && expInstances.length > 0) {
              expInstances.sort((a, b) => {
                const numA = parseInt(a.MainDicomTags?.InstanceNumber || a.IndexInSeries || 0, 10);
                const numB = parseInt(b.MainDicomTags?.InstanceNumber || b.IndexInSeries || 0, 10);
                return numA - numB;
              });
              const tot = expInstances.length;
              orderedInstances = expInstances.map((inst, iIdx) => {
                const instId = extractCleanInstanceId(inst.ID || inst);
                const instNum = parseInt(inst.MainDicomTags?.InstanceNumber || (iIdx + 1), 10);
                const sopUid = inst.MainDicomTags?.SOPInstanceUID || instId;
                return {
                  id: instId,
                  instance_id: instId,
                  sop_instance_uid: sopUid,
                  slice_number: instNum,
                  instanceNumber: instNum,
                  instance_number: instNum,
                  slice_index: iIdx + 1,
                  previewUrl: `/api/pacs/instance-preview/${instId}`,
                  preview_url: `/api/pacs/instance-preview/${instId}`,
                  caption: `${sDesc} | Slice ${instNum}/${tot}`
                };
              });
            }
          } catch (e) {}

          if (orderedInstances.length === 0 && Array.isArray(sData.Instances)) {
            orderedInstances = sData.Instances.map((instItem, iIdx) => {
              const instId = extractCleanInstanceId(instItem);
              return {
                id: instId,
                instance_id: instId,
                slice_number: iIdx + 1,
                instanceNumber: iIdx + 1,
                slice_index: iIdx + 1,
                previewUrl: `/api/pacs/instance-preview/${instId}`,
                preview_url: `/api/pacs/instance-preview/${instId}`,
                caption: `${sDesc} | Slice ${iIdx + 1}/${sData.Instances.length}`
              };
            });
          }

          const dicomSeriesUid = sData.MainDicomTags?.SeriesInstanceUID || sData.ID || seriesId;
          return {
            seriesId: dicomSeriesUid,
            series_id: dicomSeriesUid,
            orthanc_series_id: sData.ID || seriesId,
            series_instance_uid: dicomSeriesUid,
            seriesDescription: sDesc,
            series_description: sDesc,
            seriesNumber: sNum,
            series_number: sNum,
            modality: sModality,
            totalSlices: orderedInstances.length,
            total_slices: orderedInstances.length,
            instances: orderedInstances
          };
        })
        .catch(() => null)
    );

    const results = await Promise.all(seriesPromises);
    const valid = results.filter(Boolean);
    valid.sort((a, b) => (a.seriesNumber || 0) - (b.seriesNumber || 0));
    return valid;
  }

  /**
   * Universally fetches rendered JPEG/PNG DICOM slice across Orthanc, DCM4CHEE-ARC, and Generic PACS / VNA.
   */
  async fetchHybridInstanceBuffer(studyUID, seriesUID, sopInstanceUid, frameNumber = null) {
    if (!sopInstanceUid) return null;

    // 1. Try Orthanc PACS first
    try {
      const orthancUrl = await getOrthancUrl();
      const renderPath = (frameNumber !== null && frameNumber !== "") 
        ? `instances/${sopInstanceUid}/frames/${frameNumber}/rendered` 
        : `instances/${sopInstanceUid}/rendered`;
      const res = await axios.get(`${orthancUrl}${renderPath}`, {
        responseType: "arraybuffer",
        ...orthancAuthConfig(),
        timeout: 2500
      }).catch(() => null);

      if (res && res.data && res.data.byteLength > 500) {
        return Buffer.from(res.data);
      }

      const fbRes = await axios.get(`${orthancUrl}instances/${sopInstanceUid}/preview`, {
        responseType: "arraybuffer",
        ...orthancAuthConfig(),
        timeout: 2500
      }).catch(() => null);

      if (fbRes && fbRes.data && fbRes.data.byteLength > 500) {
        return Buffer.from(fbRes.data);
      }
    } catch (e) {}

    // 2. Try DCM4CHEE / DCM4CHEE-ARC via dcm4cheeHelper
    try {
      const buffer = await dcm4cheeHelper.fetchDcm4cheeInstanceBuffer(studyUID, seriesUID, sopInstanceUid, frameNumber);
      if (buffer && buffer.length > 500) {
        return buffer;
      }
    } catch (e) {}

    // 3. Try Generic PACS / DICOMweb / VNA nodes
    try {
      const nodes = await this.getAllActivePacsNodes();
      for (const node of nodes) {
        if (String(node.pacs_type).toUpperCase().includes("DCM4CHEE")) continue;

        const host = node.ip_address;
        const port = node.port;
        const aet = node.ae_title;
        const auth = (node.username || node.password) ? { auth: { username: node.username, password: node.password } } : {};

        const frameSeg = (frameNumber !== null && frameNumber !== "") ? `/frames/${frameNumber}/rendered` : "/rendered";

        const urls = [
          `http://${host}:${port}/wado?requestType=WADO&studyUID=${studyUID || ''}&seriesUID=${seriesUID || ''}&objectUID=${sopInstanceUid}&contentType=image/jpeg`,
          `http://${host}:${port}/dicom-web/studies/${studyUID}/series/${seriesUID}/instances/${sopInstanceUid}${frameSeg}`,
          `http://${host}:${port}/aets/${aet}/rs/studies/${studyUID}/series/${seriesUID}/instances/${sopInstanceUid}${frameSeg}`
        ];

        for (const u of urls) {
          try {
            const res = await axios.get(u, {
              responseType: "arraybuffer",
              ...auth,
              timeout: 3500
            });
            if (res && res.data && res.data.byteLength > 500) {
              return Buffer.from(res.data);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    return null;
  }

  /**
   * Given a SOPInstanceUID or instanceId, looks up studyUID and seriesUID across all PACS/VNA sources.
   */
  async lookupHybridSopInstance(sopInstanceUid) {
    if (!sopInstanceUid) return null;

    // 1. DCM4CHEE lookup
    try {
      const dcmMatch = await dcm4cheeHelper.lookupDcm4cheeSopInstance(sopInstanceUid);
      if (dcmMatch) return dcmMatch;
    } catch (e) {}

    // 2. Orthanc lookup
    try {
      const orthancUrl = await getOrthancUrl();
      const { data: tags } = await axios.get(`${orthancUrl}instances/${sopInstanceUid}/tags?simplified`, { ...orthancAuthConfig(), timeout: 2500 }).catch(() => ({ data: null }));
      if (tags) {
        return {
          studyUID: tags.StudyInstanceUID,
          seriesUID: tags.SeriesInstanceUID,
          sopInstanceUid: tags.SOPInstanceUID || sopInstanceUid
        };
      }
    } catch (e) {}

    // 3. Database query lookup
    try {
      const { rows } = await pool.query(
        `SELECT study_uid, series_uid, sop_instance_uid FROM study_key_images 
         WHERE instance_id = $1 OR sop_instance_uid = $1 LIMIT 1`,
        [sopInstanceUid]
      ).catch(() => ({ rows: [] }));

      if (rows.length > 0) {
        return {
          studyUID: rows[0].study_uid,
          seriesUID: rows[0].series_uid,
          sopInstanceUid: rows[0].sop_instance_uid || sopInstanceUid
        };
      }
    } catch (e) {}

    return null;
  }
}

const hybridPacsGateway = new HybridPacsGateway();
module.exports = hybridPacsGateway;
