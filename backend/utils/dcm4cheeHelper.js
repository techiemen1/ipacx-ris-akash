const axios = require("axios");
const pool = require("../db");

let cachedWorkingDcm4cheeNode = null;
let lastCacheTime = 0;

/**
 * Discovers and returns all configured or default DCM4CHEE PACS nodes.
 */
async function getDcm4cheeNodes() {
  const nodes = [];

  // 1. Query PostgreSQL pacs table for active DCM4CHEE or DICOMWEB nodes
  try {
    const { rows } = await pool.query(
      "SELECT * FROM public.pacs WHERE is_active = true ORDER BY id ASC"
    ).catch(() => ({ rows: [] }));

    for (const r of rows) {
      const type = String(r.pacs_type || "").toUpperCase();
      if (type.includes("DCM4CHEE") || type.includes("DICOMWEB") || type.includes("PACS")) {
        nodes.push({
          id: r.id,
          pacs_name: r.pacs_name || "DCM4CHEE",
          pacs_type: r.pacs_type || "DCM4CHEE",
          ae_title: String(r.ae_title || "DCM4CHEE").trim(),
          ip_address: String(r.ip_address || "127.0.0.1").trim(),
          port: parseInt(r.port || 8080, 10),
          username: r.username || process.env.DCM4CHEE_USER || "pacs",
          password: r.password || process.env.DCM4CHEE_PASS || "pacs"
        });
      }
    }
  } catch (e) {
    // DB query error fallback to env
  }

  // 2. Check environment variables
  const envHost = (process.env.DCM4CHEE_HOST || process.env.DCM4CHEE_IP || process.env.PACS_HOST || "").trim();
  const envPort = parseInt(process.env.DCM4CHEE_PORT || 8080, 10);
  const envAet = String(process.env.DCM4CHEE_AET || process.env.DCM4CHEE_AE_TITLE || "DCM4CHEE").trim();
  const envUser = process.env.DCM4CHEE_USER || "pacs";
  const envPass = process.env.DCM4CHEE_PASS || "pacs";

  if (envHost) {
    nodes.push({
      id: "env_dcm4chee",
      pacs_name: "DCM4CHEE_ENV",
      pacs_type: "DCM4CHEE",
      ae_title: envAet,
      ip_address: envHost.replace(/^https?:\/\//, "").replace(/\/.*$/, "").split(":")[0],
      port: envPort,
      username: envUser,
      password: envPass
    });
  }

  // 3. Fallback candidate hosts and ports for Docker / remote deployments
  const fallbackHosts = [
    "dcm4chee-arc",
    "dcm4chee",
    "host.docker.internal",
    "127.0.0.1",
    "localhost",
    "172.17.0.1",
    "172.18.0.1",
    "172.19.0.1",
    "172.20.0.1"
  ];
  const fallbackPorts = [8080, 8085, 11112];

  for (const fHost of fallbackHosts) {
    for (const fPort of fallbackPorts) {
      nodes.push({
        id: `fallback_${fHost}_${fPort}`,
        pacs_name: `DCM4CHEE_${fHost}`,
        pacs_type: "DCM4CHEE",
        ae_title: envAet || "DCM4CHEE",
        ip_address: fHost,
        port: fPort,
        username: envUser,
        password: envPass
      });
    }
  }

  // Deduplicate by IP and Port
  const uniqueNodes = [];
  const seenKeys = new Set();
  for (const node of nodes) {
    const key = `${node.ip_address}:${node.port}:${node.ae_title}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueNodes.push(node);
    }
  }

  return uniqueNodes;
}

/**
 * Returns basic auth config for DCM4CHEE axios calls
 */
function getDcm4cheeAuthConfig(node) {
  const user = node?.username || process.env.DCM4CHEE_USER || "pacs";
  const pass = node?.password || process.env.DCM4CHEE_PASS || "pacs";
  if (!user && !pass) return {};
  return { auth: { username: String(user).trim(), password: String(pass) } };
}

/**
 * Resolves working DCM4CHEE node with fast parallel probing & 30s cache
 */
async function getWorkingDcm4cheeNode() {
  const now = Date.now();
  if (cachedWorkingDcm4cheeNode && (now - lastCacheTime < 30000)) {
    return cachedWorkingDcm4cheeNode;
  }

  const nodes = await getDcm4cheeNodes();
  if (!nodes || nodes.length === 0) {
    return {
      id: "default_fallback",
      pacs_name: "DCM4CHEE_FALLBACK",
      pacs_type: "DCM4CHEE",
      ae_title: process.env.DCM4CHEE_AET || "DCM4CHEE",
      ip_address: process.env.DCM4CHEE_HOST || "dcm4chee-arc",
      port: 8080,
      username: process.env.DCM4CHEE_USER || "pacs",
      password: process.env.DCM4CHEE_PASS || "pacs"
    };
  }

  // Fast parallel probe across all candidate nodes with 800ms timeout
  const probePromises = nodes.map(async (node) => {
    const checkUrl = `http://${node.ip_address}:${node.port}/dcm4chee-arc/aets/${node.ae_title}/rs/studies`;
    try {
      await axios.get(`${checkUrl}?limit=1`, {
        ...getDcm4cheeAuthConfig(node),
        headers: { Accept: "application/dicom+json" },
        timeout: 800
      });
      return node;
    } catch (e) {
      if (e.response && [200, 204, 401, 403].includes(e.response.status)) {
        return node;
      }
      throw e;
    }
  });

  try {
    const workingNode = await Promise.any(probePromises);
    if (workingNode) {
      cachedWorkingDcm4cheeNode = workingNode;
      lastCacheTime = now;
      console.log(`[DCM4CHEE Discovery] Fast probe selected working node: ${workingNode.ip_address}:${workingNode.port} (${workingNode.ae_title})`);
      return workingNode;
    }
  } catch (e) {
    // Parallel probe failed or all rejected
  }

  const fallback = nodes[0];
  cachedWorkingDcm4cheeNode = fallback;
  lastCacheTime = now;
  return fallback;
}

/**
 * Fetches high-resolution rendered JPEG/PNG DICOM slice directly from DCM4CHEE
 */
async function fetchDcm4cheeInstanceBuffer(studyUID, seriesUID, sopInstanceUid, frameNumber = null) {
  if (!sopInstanceUid) return null;
  const workingNode = await getWorkingDcm4cheeNode();
  const allNodes = await getDcm4cheeNodes();
  
  // Prioritize working node first, followed by unique remaining nodes
  const nodes = [workingNode];
  for (const n of allNodes) {
    if (n.ip_address !== workingNode.ip_address || n.port !== workingNode.port || n.ae_title !== workingNode.ae_title) {
      nodes.push(n);
    }
  }

  for (const node of nodes) {
    const authConfig = getDcm4cheeAuthConfig(node);
    const host = node.ip_address;
    const port = node.port;
    const aet = node.ae_title;

    // Build URL variants for DCM4CHEE-ARC 5.x WADO-RS / WADO-URI
    const urlCandidates = [];

    const frameSegment = (frameNumber !== null && frameNumber !== "" && !isNaN(parseInt(frameNumber, 10))) 
      ? `/frames/${parseInt(frameNumber, 10)}/rendered` 
      : "/rendered";

    if (studyUID && seriesUID) {
      urlCandidates.push({
        url: `http://${host}:${port}/dcm4chee-arc/aets/${aet}/rs/studies/${studyUID}/series/${seriesUID}/instances/${sopInstanceUid}${frameSegment}`,
        headers: { Accept: "image/jpeg" }
      });
      urlCandidates.push({
        url: `http://${host}:${port}/dcm4chee-arc/aets/${aet}/wado?requestType=WADO&studyUID=${studyUID}&seriesUID=${seriesUID}&objectUID=${sopInstanceUid}&contentType=image/jpeg`,
        headers: {}
      });
    }

    if (studyUID) {
      urlCandidates.push({
        url: `http://${host}:${port}/dcm4chee-arc/aets/${aet}/rs/studies/${studyUID}/instances/${sopInstanceUid}${frameSegment}`,
        headers: { Accept: "image/jpeg" }
      });
      urlCandidates.push({
        url: `http://${host}:${port}/dcm4chee-arc/aets/${aet}/wado?requestType=WADO&studyUID=${studyUID}&objectUID=${sopInstanceUid}&contentType=image/jpeg`,
        headers: {}
      });
    }

    urlCandidates.push({
      url: `http://${host}:${port}/dcm4chee-arc/aets/${aet}/wado?requestType=WADO&objectUID=${sopInstanceUid}&contentType=image/jpeg`,
      headers: {}
    });

    for (const cand of urlCandidates) {
      try {
        const res = await axios.get(cand.url, {
          responseType: "arraybuffer",
          headers: cand.headers,
          ...authConfig,
          timeout: 3500
        });

        if (res && res.data && res.data.byteLength > 500) {
          return Buffer.from(res.data);
        }
      } catch (err) {
        // Try next candidate
      }
    }
  }

  return null;
}

/**
 * Searches DCM4CHEE QIDO-RS for study series & instances
 */
async function searchDcm4cheeSeriesAndInstances(studyUID) {
  if (!studyUID) return [];
  const workingNode = await getWorkingDcm4cheeNode();
  const allNodes = await getDcm4cheeNodes();
  const nodes = [workingNode];
  for (const n of allNodes) {
    if (n.ip_address !== workingNode.ip_address || n.port !== workingNode.port || n.ae_title !== workingNode.ae_title) {
      nodes.push(n);
    }
  }

  for (const node of nodes) {
    const authConfig = getDcm4cheeAuthConfig(node);
    const host = node.ip_address;
    const port = node.port;
    const aet = node.ae_title;

    const seriesUrl = `http://${host}:${port}/dcm4chee-arc/aets/${aet}/rs/studies/${studyUID}/series`;
    try {
      const sRes = await axios.get(seriesUrl, {
        ...authConfig,
        headers: { Accept: "application/dicom+json" },
        timeout: 4500
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

          const instUrl = `http://${host}:${port}/dcm4chee-arc/aets/${aet}/rs/studies/${studyUID}/series/${seriesUid}/instances`;
          const iRes = await axios.get(instUrl, {
            ...authConfig,
            headers: { Accept: "application/dicom+json" },
            timeout: 4500
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
    } catch (e) {
      // Try next node
    }
  }

  return [];
}

/**
 * Searches DCM4CHEE for studyUID and seriesUID associated with a SOPInstanceUID
 */
async function lookupDcm4cheeSopInstance(sopInstanceUid) {
  if (!sopInstanceUid) return null;
  const nodes = await getDcm4cheeNodes();

  for (const node of nodes) {
    const authConfig = getDcm4cheeAuthConfig(node);
    const host = node.ip_address;
    const port = node.port;
    const aet = node.ae_title;

    const searchUrls = [
      `http://${host}:${port}/dcm4chee-arc/aets/${aet}/rs/instances?SOPInstanceUID=${sopInstanceUid}`,
      `http://${host}:${port}/dcm4chee-arc/aets/${aet}/rs/studies?SOPInstanceUID=${sopInstanceUid}`
    ];

    for (const url of searchUrls) {
      try {
        const res = await axios.get(url, {
          ...authConfig,
          headers: { Accept: "application/dicom+json" },
          timeout: 3000
        });

        if (Array.isArray(res.data) && res.data.length > 0) {
          const item = res.data[0];
          const studyUID = item["0020000D"]?.Value?.[0];
          const seriesUID = item["0020000E"]?.Value?.[0];
          if (studyUID || seriesUID) {
            return { studyUID, seriesUID, sopInstanceUid, pacsNode: node };
          }
        }
      } catch (e) {
        // Try next search URL
      }
    }
  }

  return null;
}

module.exports = {
  getDcm4cheeNodes,
  getWorkingDcm4cheeNode,
  fetchDcm4cheeInstanceBuffer,
  searchDcm4cheeSeriesAndInstances,
  lookupDcm4cheeSopInstance
};
