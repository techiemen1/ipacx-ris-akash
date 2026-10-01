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
  /**
   * Sorts series list by DICOM SeriesNumber ascending (matching OHIF sidebar order: Series 1, Series 2, etc.)
   */
  sortSeriesList(seriesList) {
    if (!Array.isArray(seriesList)) return [];
    const getSeriesNum = (s) => parseInt(s?.series_number || s?.seriesNumber || 9999, 10);
    const sorted = [...seriesList];
    sorted.sort((a, b) => getSeriesNum(a) - getSeriesNum(b));
    return sorted;
  }

  /**
   * Fetches study series & instances from ALL connected PACS/VNA sources in parallel/hybrid fallback order.
   * Priority 1: Orthanc
   * Priority 2: DCM4CHEE / DCM4CHEE-ARC
   * Priority 3: Generic DICOMweb / VNA nodes
   */
  async fetchHybridSeriesAndInstances(studyUID) {
    if (!studyUID) return [];

    console.log("🔍 [TRACE 1: PACS QUERY] hybridPacsGateway searching for studyUID:", studyUID);

    // 1. Try Orthanc PACS
    try {
      const orthancUrl = await getOrthancUrl();
      console.log("🔍 [TRACE 1: PACS QUERY] Querying Orthanc PACS at:", orthancUrl);
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
          if (orthSeries && orthSeries.length > 0) {
            console.log(`🔍 [TRACE 1: PACS QUERY] Orthanc SUCCESS. Returned ${orthSeries.length} series:`, orthSeries.map(s => ({ id: s.series_id, desc: s.series_description, slices: s.total_slices })));
            return this.sortSeriesList(orthSeries);
          }
        }
      }
      console.log("🔍 [TRACE 1: PACS QUERY] Orthanc found 0 series for studyUID:", studyUID);
    } catch (e) {
      console.warn("🔍 [TRACE 1: PACS QUERY] Orthanc series lookup notice:", e.message);
    }

    // 2. Try DCM4CHEE / DCM4CHEE-ARC via QIDO-RS
    try {
      console.log("🔍 [TRACE 1: PACS QUERY] Querying DCM4CHEE PACS for studyUID:", studyUID);
      const dcmSeries = await dcm4cheeHelper.searchDcm4cheeSeriesAndInstances(studyUID);
      if (Array.isArray(dcmSeries) && dcmSeries.length > 0) {
        console.log(`🔍 [TRACE 1: PACS QUERY] DCM4CHEE SUCCESS. Returned ${dcmSeries.length} series:`, dcmSeries.map(s => ({ id: s.series_id, desc: s.series_description, slices: s.total_slices })));
        return this.sortSeriesList(dcmSeries);
      }
      console.log("🔍 [TRACE 1: PACS QUERY] DCM4CHEE found 0 series for studyUID:", studyUID);
    } catch (e) {
      console.warn("🔍 [TRACE 1: PACS QUERY] DCM4CHEE series search notice:", e.message);
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
              const parseDcmStr = (val, fallback = "") => {
                if (!val) return fallback;
                if (typeof val === "string") return val.trim();
                if (typeof val === "number") return String(val);
                if (Array.isArray(val)) return val.length > 0 ? parseDcmStr(val[0], fallback) : fallback;
                if (typeof val === "object") {
                  if (val.Alphabetic) return String(val.Alphabetic).trim();
                  if (val.phonetic) return String(val.phonetic).trim();
                  if (Array.isArray(val.Value)) return parseDcmStr(val.Value[0], fallback);
                  if (val.Value !== undefined) return parseDcmStr(val.Value, fallback);
                }
                return String(val).trim() || fallback;
              };

              const seriesList = [];
              for (let sIdx = 0; sIdx < sRes.data.length; sIdx++) {
                const serObj = sRes.data[sIdx];
                const seriesUid = parseDcmStr(serObj["0020000E"]) || parseDcmStr(serObj.SeriesInstanceUID) || parseDcmStr(serObj.seriesInstanceUid);
                const rawSeriesDesc = parseDcmStr(serObj["0008103E"]) || parseDcmStr(serObj["00081030"]) || parseDcmStr(serObj.SeriesDescription) || parseDcmStr(serObj.seriesDescription);
                const sModality = parseDcmStr(serObj["00080060"]) || parseDcmStr(serObj.Modality) || "CT";
                const seriesDesc = (rawSeriesDesc && typeof rawSeriesDesc === "string" && rawSeriesDesc.trim() !== "") ? rawSeriesDesc.trim() : `${sModality || 'Series'} ${sIdx + 1}`;
                const seriesNum = parseInt(parseDcmStr(serObj["00200011"]) || parseDcmStr(serObj.SeriesNumber) || (sIdx + 1), 10);

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
                    const numA = parseInt(parseDcmStr(a["00200013"]) || parseDcmStr(a.InstanceNumber) || 0, 10);
                    const numB = parseInt(parseDcmStr(b["00200013"]) || parseDcmStr(b.InstanceNumber) || 0, 10);
                    return numA - numB;
                  });

                  instances = iRes.data.map((inst, iIdx) => {
                    const sopUid = parseDcmStr(inst["00080018"]) || parseDcmStr(inst.SOPInstanceUID) || parseDcmStr(inst.sopInstanceUid);
                    const sliceNum = parseInt(parseDcmStr(inst["00200013"]) || parseDcmStr(inst.InstanceNumber) || (iIdx + 1), 10);
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
      axios.get(`${orthancUrl}series/${seriesId}`, { ...config, timeout: 2500 })
        .then(async (r) => {
          if (!r.data) return null;
          const sData = r.data;
          let sDesc = sData.MainDicomTags?.SeriesDescription || sData.MainDicomTags?.ProtocolName || sData.MainDicomTags?.AcquisitionDeviceProcessingDescription || sData.MainDicomTags?.BodyPartExamined || "";
          
          if ((!sDesc || sDesc.trim() === "" || sDesc === "Diagnostic Series") && Array.isArray(sData.Instances) && sData.Instances.length > 0) {
            try {
              const firstInstId = extractCleanInstanceId(sData.Instances[0]);
              const tagRes = await axios.get(`${orthancUrl}instances/${firstInstId}/simplified-tags`, { ...config, timeout: 1500 }).catch(() => null);
              if (tagRes && tagRes.data) {
                const st = tagRes.data;
                const alt = st.SeriesDescription ||
                            st.ProtocolName || 
                            st.SequenceName || 
                            st.ScanningSequence ||
                            st.FilmAnnotationCharacterString1 || 
                            (Array.isArray(st.PerformedProtocolCodeSequence) && st.PerformedProtocolCodeSequence[0]?.CodeMeaning) || 
                            st.AcquisitionDeviceProcessingDescription || 
                            st.BodyPartExamined;
                if (alt && String(alt).trim()) sDesc = String(alt).trim();
              }
            } catch (e) {}
          }
          if (!sDesc || !sDesc.trim()) sDesc = `Series ${sIdx + 1}`;

          const sNum = parseInt(sData.MainDicomTags?.SeriesNumber || (sIdx + 1), 10);
          const sModality = sData.MainDicomTags?.Modality || "";

                    let orderedInstances = [];

          // Strategy 1: Expand instances to sort strictly by InstanceNumber & spatial position
          try {
            const { data: expInstances } = await axios.get(`${orthancUrl}series/${seriesId}/instances?expand`, { ...config, timeout: 12000 });
            if (Array.isArray(expInstances) && expInstances.length > 0) {
              expInstances.sort((a, b) => {
                const numA = parseInt(a.MainDicomTags?.InstanceNumber || a.IndexInSeries || 0, 10);
                const numB = parseInt(b.MainDicomTags?.InstanceNumber || b.IndexInSeries || 0, 10);
                if (numA !== numB) return numA - numB;
                const posA = a.MainDicomTags?.ImagePositionPatient ? parseFloat(a.MainDicomTags.ImagePositionPatient.split("\\")[2] || 0) : 0;
                const posB = b.MainDicomTags?.ImagePositionPatient ? parseFloat(b.MainDicomTags.ImagePositionPatient.split("\\")[2] || 0) : 0;
                return posA - posB;
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

          // Strategy 2: Try Orthanc /ordered-slices if expand failed or timed out
          if (orderedInstances.length === 0) {
            try {
              const { data: oSlicesData } = await axios.get(`${orthancUrl}series/${seriesId}/ordered-slices`, { ...config, timeout: 6000 });
              if (oSlicesData && Array.isArray(oSlicesData.Slices) && oSlicesData.Slices.length > 0) {
                const tot = oSlicesData.Slices.length;
                orderedInstances = oSlicesData.Slices.map((item, iIdx) => {
                  const rawPath = Array.isArray(item) ? item[0] : (typeof item === "string" ? item : (item?.Path || ""));
                  const instId = extractCleanInstanceId(rawPath);
                  return {
                    id: instId,
                    instance_id: instId,
                    sop_instance_uid: instId,
                    slice_number: iIdx + 1,
                    instanceNumber: iIdx + 1,
                    instance_number: iIdx + 1,
                    slice_index: iIdx + 1,
                    previewUrl: `/api/pacs/instance-preview/${instId}`,
                    preview_url: `/api/pacs/instance-preview/${instId}`,
                    caption: `${sDesc} | Slice ${iIdx + 1}/${tot}`
                  };
                });
              }
            } catch (e) {}
          }

          // Strategy 3: Fast fallback if both expand & ordered-slices fail
          if (orderedInstances.length === 0 && Array.isArray(sData.Instances) && sData.Instances.length > 0) {
            const tot = sData.Instances.length;
            orderedInstances = sData.Instances.map((instItem, iIdx) => {
              const instId = extractCleanInstanceId(instItem);
              const sliceNum = iIdx + 1;
              return {
                id: instId,
                instance_id: instId,
                sop_instance_uid: instId,
                slice_number: sliceNum,
                instanceNumber: sliceNum,
                instance_number: sliceNum,
                slice_index: sliceNum,
                previewUrl: `/api/pacs/instance-preview/${instId}`,
                preview_url: `/api/pacs/instance-preview/${instId}`,
                caption: `${sDesc} | Slice ${sliceNum}/${tot}`
              };
            });
          }

          // Multi-frame DICOM slice expansion check
          if (orderedInstances.length === 1) {
            const singleInstId = orderedInstances[0].id;
            try {
              const { data: frames } = await axios.get(`${orthancUrl}instances/${singleInstId}/frames`, { ...config, timeout: 5000 });
              if (Array.isArray(frames) && frames.length > 1) {
                orderedInstances = frames.map((fIdx) => ({
                  id: `${singleInstId}?frame=${fIdx}`,
                  instance_id: singleInstId,
                  sop_instance_uid: singleInstId,
                  frame_index: fIdx,
                  slice_number: fIdx + 1,
                  instanceNumber: fIdx + 1,
                  instance_number: fIdx + 1,
                  slice_index: fIdx + 1,
                  previewUrl: `/api/pacs/instance-preview/${singleInstId}?frame=${fIdx}`,
                  preview_url: `/api/pacs/instance-preview/${singleInstId}?frame=${fIdx}`,
                  caption: `${sDesc} | Frame ${fIdx + 1}/${frames.length}`
                }));
              }
            } catch (e) {}
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
      let orthancInstId = sopInstanceUid;

      // If sopInstanceUid is a DICOM SOPInstanceUID (contains dots), resolve internal Orthanc UUID
      if (String(sopInstanceUid).includes('.')) {
        try {
          const findRes = await axios.post(`${orthancUrl}tools/find`, {
            Level: "Instance",
            Query: { SOPInstanceUID: sopInstanceUid }
          }, { ...orthancAuthConfig(), timeout: 1500 }).catch(() => ({ data: [] }));
          if (Array.isArray(findRes.data) && findRes.data.length > 0) {
            orthancInstId = findRes.data[0];
          }
        } catch (e) {}
      }

      // Priority 1A: Direct /rendered on target single-frame instance (most common for CT/MR series slices)
      const directRes = await axios.get(`${orthancUrl}instances/${orthancInstId}/rendered`, {
        responseType: "arraybuffer",
        ...orthancAuthConfig(),
        timeout: 2500
      }).catch(() => null);

      if (directRes && directRes.data && directRes.data.byteLength > 500) {
        return Buffer.from(directRes.data);
      }

      // Priority 1B: Multi-frame DICOM instance frame rendering (0-indexed for Orthanc)
      if (frameNumber !== null && frameNumber !== undefined && frameNumber !== "") {
        const frameIdx = parseInt(frameNumber, 10);
        const orthancFrame = (!isNaN(frameIdx) && frameIdx >= 0) ? (frameIdx > 0 ? frameIdx - 1 : frameIdx) : 0;
        const frameRes = await axios.get(`${orthancUrl}instances/${orthancInstId}/frames/${orthancFrame}/rendered`, {
          responseType: "arraybuffer",
          ...orthancAuthConfig(),
          timeout: 2500
        }).catch(() => null);
        if (frameRes && frameRes.data && frameRes.data.byteLength > 500) {
          return Buffer.from(frameRes.data);
        }
      }

      // Priority 1C: /preview fallback
      const fbRes = await axios.get(`${orthancUrl}instances/${orthancInstId}/preview`, {
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

    // 3. Try Generic PACS / DICOMweb / VNA nodes with fast 500ms timeout
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
              timeout: 500
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
