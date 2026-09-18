// src/pages/PACSpage.jsx
import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import api from "../api/axios";
import axios from "axios";
import "./PACSpage.css";
import { openStudyViewer } from "../utils/viewerUtils";
import DiagnosticWorkstationModal from "../components/ReportStudio/DiagnosticWorkstationModal";
import {
  Server,
  Eye,
  FileText,
  RefreshCw,
  Zap,
  UploadCloud,
  FolderPlus,
  X,
  Download,
  FileDown,
  Image,
  Archive,
  ChevronDown,
  FileType,
  Smartphone,
  Compass,
  SlidersHorizontal
} from "lucide-react";

function formatPatientName(name) {
  if (!name) return "Patient";
  const cleaned = String(name)
    .replace(/\^+/g, " ")
    .replace(/undefined|null/gi, "")
    .trim();
  return cleaned || "Patient";
}

const safeLower = (v) => String(v ?? "").toLowerCase();

function parseDicomDateTime(dateStr, timeStr) {
  if (!dateStr) return 0;
  const s = String(dateStr).trim().replace(/\./g, "").replace(/-/g, "");

  if (/^\d{8}$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    let t = "00:00:00";
    if (timeStr && String(timeStr).trim().length >= 4) {
      const ts = String(timeStr).trim().replace(/:/g, "");
      const hh = ts.slice(0, 2) || "00";
      const min = ts.slice(2, 4) || "00";
      const sec = ts.slice(4, 6) || "00";
      t = `${hh}:${min}:${sec}`;
    }
    const iso = `${yyyy}-${mm}-${dd}T${t}`;
    const timestamp = new Date(iso).getTime();
    return isNaN(timestamp) ? 0 : timestamp;
  }

  const d = new Date(dateStr);
  const timestamp = d.getTime();
  return isNaN(timestamp) ? 0 : timestamp;
}

function formatDisplayDateTime(dateStr, timeStr) {
  const ts = parseDicomDateTime(dateStr, timeStr);
  if (!ts) return dateStr || "-";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function parseModality(study) {
  const raw = study?.Modality || study?.modality || study?.ModalitiesInStudy || study?.modality_in_study || "";
  const str = String(raw).toUpperCase().replace(/UNDEFINED|NULL/g, "").trim();

  if (str && str !== "N/A" && str !== "UNDEFINED") {
    if (str === "MRI") return "MR";
    if (str === "USG") return "US";
    if (str === "ECHO") return "EC";
    if (["CR", "DX", "XR", "CT", "MR", "US", "MG", "EC"].includes(str)) return str;
  }

  const desc = String(study?.StudyDescription || study?.study_description || "").toUpperCase();
  if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) return "CR";
  if (desc.includes("MRI") || desc.includes("MR") || desc.includes("SPINE") || desc.includes("BRAIN") || desc.includes("KNEE")) return "MR";
  if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) return "US";
  if (desc.includes("CT") || desc.includes("TOMOGRAPHY") || desc.includes("HEAD") || desc.includes("SINUS") || desc.includes("ABDOMEN")) return "CT";

  return "CR";
}

export default function PACSpage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [pacsServers, setPacsServers] = useState([]);
  const [activePacs, setActivePacs] = useState(null);
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeWorkstationItem, setActiveWorkstationItem] = useState(null);

  const [filters, setFilters] = useState({
    patientId: "",
    patientName: "",
    accession: "",
    modality: "",
  });

  const [dateQuickFilter, setDateQuickFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.modality) count++;
    if (dateQuickFilter !== "ALL") count++;
    if (fromDate || toDate) count++;
    return count;
  }, [filters.modality, dateQuickFilter, fromDate, toDate]);

  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  const [exportMenuOpenUid, setExportMenuOpenUid] = useState(null);
  const [exportingUid, setExportingUid] = useState(null);
  const [_exportType, setExportType] = useState(null);

  const [activeLocks, setActiveLocks] = useState({});

  const fetchActiveLocks = async () => {
    try {
      const res = await api.get("/api/reports/session/active-locks");
      if (res.data?.success && res.data.locks) {
        setActiveLocks(res.data.locks);
      }
    } catch (e) {
      /* ignore lock fetch failure */
    }
  };

  useEffect(() => {
    fetchActiveLocks();
    const lockInterval = setInterval(fetchActiveLocks, 8000);
    return () => clearInterval(lockInterval);
  }, []);

  const openStudyViewer = (studyUID) => {
    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) {
      navigate(`/mobile-viewer?study=${encodeURIComponent(studyUID)}`);
    } else {
      const currentOrigin = window.location.origin;
      const path = `/viewer?url=/dicom-web/studies/${encodeURIComponent(studyUID)}/metadata`;
      window.open(currentOrigin + path, "_blank", "noopener,noreferrer");
    }
  };

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".pacs-export-dropdown-container")) {
        setExportMenuOpenUid(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleExportStudy = async (studyUID, format, patientName = "Patient") => {
    setExportingUid(studyUID);
    setExportType(format);
    setExportMenuOpenUid(null);

    try {
      let endpoint = "";
      if (format === "dicom") {
        endpoint = `/api/pacs/export/dicom/${encodeURIComponent(studyUID)}`;
      } else if (format === "jpeg" || format === "png") {
        endpoint = `/api/pacs/export/images/${format}/${encodeURIComponent(studyUID)}`;
      } else if (format === "single") {
        endpoint = `/api/pacs/export/single/${encodeURIComponent(studyUID)}`;
      }

      const response = await api.get(endpoint, { responseType: "blob" });
      const blob = new Blob([response.data]);
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;

      const ext = format === "single" ? "jpg" : "zip";
      const cleanName = (patientName || "Patient").replace(/[^a-zA-Z0-9_-]/g, "_");
      link.download = `${cleanName}_${format.toUpperCase()}_${studyUID.slice(-6)}.${ext}`;

      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Export failed:", err);
      alert(`❌ Failed to export study as ${format.toUpperCase()}. Please check PACS connection.`);
    } finally {
      setExportingUid(null);
      setExportType(null);
    }
  };

  async function loadStudies(pacs, forceRefresh = false, fDate = fromDate, tDate = toDate, qFilter = dateQuickFilter, currentFilters = filters) {
    const targetPacs = pacs || activePacs || { id: "all", ae_title: "ALL NODES", pacs_name: "All PACS Nodes", pacs_type: "ALL" };
    setActivePacs(targetPacs);
    sessionStorage.setItem("activePacs", JSON.stringify(targetPacs));
    setLoading(true);
    setCurrentPage(1);

    try {
      const params = { pacs_id: targetPacs.id || "all" };
      if (forceRefresh) params.refresh = "true";

      const now = new Date();
      const formatYMD = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
      };

      if (fDate || tDate) {
        if (fDate) params.startDate = fDate.replace(/-/g, "");
        if (tDate) params.endDate = tDate.replace(/-/g, "");
      } else if (qFilter === "TODAY") {
        params.startDate = formatYMD(now);
        params.endDate = formatYMD(now);
      } else if (qFilter === "YESTERDAY") {
        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        params.startDate = formatYMD(yest);
        params.endDate = formatYMD(yest);
      } else if (qFilter === "7DAYS") {
        const d7 = new Date(now);
        d7.setDate(d7.getDate() - 7);
        params.startDate = formatYMD(d7);
        params.endDate = formatYMD(now);
      } else if (qFilter === "30DAYS") {
        const d30 = new Date(now);
        d30.setDate(d30.getDate() - 30);
        params.startDate = formatYMD(d30);
        params.endDate = formatYMD(now);
      }

      if (currentFilters?.patientName) params.patientName = currentFilters.patientName;
      if (currentFilters?.patientId) params.patientId = currentFilters.patientId;
      if (currentFilters?.accession) params.accessionNumber = currentFilters.accession;
      if (currentFilters?.modality) params.modality = currentFilters.modality;

      const res = await api.get("/api/pacs/studies", { params }).catch(() => ({ data: [] }));
      let studiesList = Array.isArray(res.data) 
        ? res.data 
        : (Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data?.studies) ? res.data.studies : []));

      if (studiesList.length === 0 && targetPacs.id !== "all" && String(targetPacs.pacs_type).toUpperCase() !== "ORTHANC") {
        const orthancRes = await api.get("/api/pacs/studies", { params: { ...params, pacs_id: "orthanc" } }).catch(() => ({ data: [] }));
        const fallbackList = Array.isArray(orthancRes.data)
          ? orthancRes.data
          : (Array.isArray(orthancRes.data?.data) ? orthancRes.data.data : []);
        if (fallbackList.length > 0) {
          studiesList = fallbackList;
        }
      }

      if (studiesList.length === 0) {
        const allRes = await api.get("/api/pacs/studies", { params: { ...params, pacs_id: "all" } }).catch(() => ({ data: [] }));
        const allList = Array.isArray(allRes.data)
          ? allRes.data
          : (Array.isArray(allRes.data?.data) ? allRes.data.data : []);
        if (allList.length > 0) {
          studiesList = allList;
        }
      }

      const processed = studiesList.map(s => ({
        ...s,
        raw_timestamp: parseDicomDateTime(
          s.StudyDate || s.study_date || s.created_at || s.timestamp,
          s.StudyTime || s.study_time
        )
      }));

      processed.sort((a, b) => (b.raw_timestamp || 0) - (a.raw_timestamp || 0));
      setStudies(processed);
    } catch (err) {
      console.error("Failed to load PACS studies:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    async function initPacsServers() {
      try {
        const res = await api.get("/api/pacs").catch(() => ({ data: [] }));
        const list = Array.isArray(res.data) 
          ? res.data 
          : (Array.isArray(res.data?.data) ? res.data.data : []);

        const filteredList = list.filter(p => {
          const pType = String(p.pacs_type || "").toUpperCase();
          const ae = String(p.ae_title || p.pacs_name || "").toUpperCase();
          return pType !== "MWL" && !ae.includes("MWL") && !pType.includes("MWL");
        });

        const allNodePill = { id: "all", ae_title: "ALL NODES", pacs_name: "All PACS Nodes", pacs_type: "ALL" };
        let nodePills = [];

        if (filteredList.length > 0) {
          nodePills = [allNodePill, ...filteredList];
        } else {
          nodePills = [
            allNodePill,
            { id: "orthanc", ae_title: "ORTHANC", pacs_name: "Default Orthanc", pacs_type: "ORTHANC", is_default: true }
          ];
        }

        setPacsServers(nodePills);

        const saved = sessionStorage.getItem("activePacs");
        let initialPacs = null;
        if (saved) {
          try {
            initialPacs = JSON.parse(saved);
          } catch (e) {
            initialPacs = null;
          }
        }

        if (!initialPacs) {
          initialPacs = allNodePill;
        }

        loadStudies(initialPacs, true);
      } catch (err) {
        console.error("Failed to init PACS servers:", err);
        const fallback = { id: "all", ae_title: "ALL NODES", pacs_name: "All PACS Nodes", pacs_type: "ALL" };
        loadStudies(fallback, true);
      }
    }

    initPacsServers();
  }, []);

  const abortControllerRef = useRef(null);
  const [uploadType, setUploadType] = useState(null); // "zip" | "folder"
  const [uploadProgress, setUploadProgress] = useState({
    percentage: 0,
    loadedBytes: 0,
    totalBytes: 0,
    fileCount: 0
  });

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (uploading) {
        e.preventDefault();
        e.returnValue = "DICOM files are currently uploading. Leaving this page will cancel the transfer.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [uploading]);

  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setUploading(false);
    setUploadType(null);
    setUploadProgress({ percentage: 0, loadedBytes: 0, totalBytes: 0, fileCount: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const handleDicomUpload = async (e, type) => {
    const rawFiles = Array.from(e.target.files || []);
    if (!rawFiles || rawFiles.length === 0) return;

    const totalPayloadSize = rawFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setUploadType(type);
    setUploading(true);
    setUploadProgress({
      percentage: 0,
      loadedBytes: 0,
      totalBytes: totalPayloadSize,
      fileCount: rawFiles.length
    });

    // Chunk files into batches (max 25MB or 30 files per HTTP payload batch)
    const batches = [];
    let currentBatch = [];
    let currentBatchSize = 0;
    const MAX_BATCH_SIZE = 25 * 1024 * 1024;
    const MAX_BATCH_FILES = 30;

    for (const file of rawFiles) {
      const isZip = file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip");
      if (isZip || file.size > MAX_BATCH_SIZE) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }
        batches.push([file]);
      } else {
        if (currentBatch.length >= MAX_BATCH_FILES || (currentBatchSize + file.size > MAX_BATCH_SIZE)) {
          batches.push(currentBatch);
          currentBatch = [file];
          currentBatchSize = file.size;
        } else {
          currentBatch.push(file);
          currentBatchSize += file.size;
        }
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    let accumulatedLoadedBytes = 0;
    let anySuccess = false;
    let lastErrorMsg = "";

    try {
      for (let bIndex = 0; bIndex < batches.length; bIndex++) {
        if (controller.signal.aborted) break;

        const batchFiles = batches[bIndex];
        const batchPayloadSize = batchFiles.reduce((acc, f) => acc + (f.size || 0), 0);
        const formData = new FormData();
        for (const file of batchFiles) {
          formData.append("dicomFiles", file);
        }

        const { data } = await api.post("/api/pacs/upload", formData, {
          signal: controller.signal,
          headers: { "Content-Type": undefined },
          onUploadProgress: (progressEvent) => {
            const batchLoaded = progressEvent.loaded || 0;
            const currentTotalLoaded = Math.min(totalPayloadSize, accumulatedLoadedBytes + batchLoaded);
            const percentCompleted = Math.min(99, Math.round((currentTotalLoaded * 100) / (totalPayloadSize || 1)));

            setUploadProgress({
              percentage: percentCompleted,
              loadedBytes: currentTotalLoaded,
              totalBytes: totalPayloadSize,
              fileCount: rawFiles.length
            });
          }
        });

        accumulatedLoadedBytes += batchPayloadSize;
        if (data?.success) {
          anySuccess = true;
        } else if (data?.message || data?.error) {
          lastErrorMsg = data.message || data.error;
        }
      }

      setUploadProgress({
        percentage: 100,
        loadedBytes: totalPayloadSize,
        totalBytes: totalPayloadSize,
        fileCount: rawFiles.length
      });

      if (anySuccess) {
        setTimeout(() => {
          loadStudies(activePacs);
        }, 300);
      } else if (lastErrorMsg) {
        alert(`❌ DICOM Upload Failed: ${lastErrorMsg}`);
      }
    } catch (err) {
      if (axios.isCancel(err) || err.name === "CanceledError" || err.name === "AbortError") {
        console.log("Upload request aborted by user.");
        return;
      }
      console.error("DICOM upload error:", err);
      const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
      alert(`❌ DICOM Upload Failed: ${errMsg}`);
    } finally {
      abortControllerRef.current = null;
      setTimeout(() => {
        setUploading(false);
        setUploadType(null);
        setUploadProgress({ percentage: 0, loadedBytes: 0, totalBytes: 0, fileCount: 0 });
        if (fileInputRef.current) fileInputRef.current.value = "";
        if (folderInputRef.current) folderInputRef.current.value = "";
      }, 400);
    }
  };

  const filteredStudies = useMemo(() => {
    const result = studies.filter((s) => {
      const pName = String(s.PatientName || s.patient_name || "").replace(/undefined|null/gi, "").trim();
      const pId = String(s.PatientID || s.patient_id || "").replace(/undefined|null/gi, "").trim();
      const acc = String(s.AccessionNumber || s.accession_number || "").replace(/undefined|null/gi, "").trim();
      const desc = String(s.StudyDescription || s.study_description || s.indication_for_scan || "").replace(/undefined|null/gi, "").trim();
      const mod = parseModality(s);

      const q = safeLower(filters.patientName);
      const matchSearch = !q ||
        safeLower(pId).includes(q) ||
        safeLower(pName).includes(q) ||
        safeLower(acc).includes(q) ||
        safeLower(desc).includes(q);

      const matchMod = !filters.modality ||
        (filters.modality === "CR" ? (mod === "CR" || mod === "DX" || mod === "XR") : mod === filters.modality);

      let matchDate = true;
      const recordTs = s.raw_timestamp || parseDicomDateTime(s.StudyDate || s.study_date, s.StudyTime || s.study_time);

      if (recordTs && (fromDate || toDate || dateQuickFilter !== "ALL")) {
        const recordDate = new Date(recordTs);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (dateQuickFilter === "TODAY") {
          matchDate = recordDate >= today;
        } else if (dateQuickFilter === "YESTERDAY") {
          const yest = new Date(today);
          yest.setDate(yest.getDate() - 1);
          const yestEnd = new Date(today);
          matchDate = recordDate >= yest && recordDate < yestEnd;
        } else if (dateQuickFilter === "7DAYS") {
          const d7 = new Date(today);
          d7.setDate(d7.getDate() - 7);
          matchDate = recordDate >= d7;
        } else if (dateQuickFilter === "30DAYS") {
          const d30 = new Date(today);
          d30.setDate(d30.getDate() - 30);
          matchDate = recordDate >= d30;
        }

        if (matchDate && (fromDate || toDate)) {
          if (fromDate) {
            const fDate = new Date(fromDate);
            fDate.setHours(0, 0, 0, 0);
            if (recordDate < fDate) matchDate = false;
          }
          if (toDate) {
            const tDate = new Date(toDate);
            tDate.setHours(23, 59, 59, 999);
            if (recordDate > tDate) matchDate = false;
          }
        }
      }

      return matchSearch && matchMod && matchDate;
    });

    return result.sort((a, b) => (b.raw_timestamp || 0) - (a.raw_timestamp || 0));
  }, [studies, filters, dateQuickFilter, fromDate, toDate]);

  const pagedStudies = filteredStudies.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  return (
    <MainLayout>
      <div className="pacs-container">
        {/* HIDDEN DICOM FILE INPUT (FILES & ZIP) */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".dcm,.DCM,.zip,.ZIP,application/dicom,application/zip"
          style={{ display: "none" }}
          onChange={(e) => handleDicomUpload(e, "zip")}
        />

        {/* HIDDEN DICOM FOLDER INPUT (ENTIRE FOLDER) */}
        <input
          type="file"
          ref={folderInputRef}
          multiple
          webkitdirectory="true"
          directory="true"
          style={{ display: "none" }}
          onChange={(e) => handleDicomUpload(e, "folder")}
        />

        {/* EXECUTIVE PACS HEADER & CONNECTED NODES STRIP */}
        <header className="pacs-header-compact">
          <div className="pacs-title-group">
            <div className="pacs-title-row">
              <h1 className="pacs-title">Enterprise PACS Viewer & Studies</h1>
              <span className="pacs-tag">DICOM Engine</span>
            </div>
            <div className="pacs-node-pills">
              <span className="pacs-node-label">Nodes:</span>
              {pacsServers.map((pacs) => {
                const isActive = activePacs?.id === pacs.id;
                return (
                  <button
                    key={pacs.id}
                    onClick={() => loadStudies(pacs)}
                    className={`pacs-node-pill ${isActive ? "active" : ""}`}
                  >
                    <Server size={12} />
                    <span>{pacs.ae_title}</span>
                    <span className="node-dot" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pacs-header-actions">
            {/* UPLOAD FILE / ZIP */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                disabled={uploading}
                className="pacs-btn-top primary"
              >
                <UploadCloud size={13} className={uploading && uploadType === 'zip' ? "animate-bounce" : ""} />
                {uploading && uploadType === 'zip' ? `ZIP ${uploadProgress.percentage}%` : "Upload File/ZIP"}
                {uploading && uploadType === 'zip' && (
                  <div className="pacs-progress-bar" style={{ width: `${uploadProgress.percentage}%` }} />
                )}
              </button>
              {uploading && uploadType === 'zip' && (
                <button type="button" onClick={handleCancelUpload} className="pacs-cancel-btn" title="Cancel Upload">
                  <X size={11} />
                </button>
              )}
            </div>

            {/* UPLOAD FOLDER */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                onClick={() => folderInputRef.current && folderInputRef.current.click()}
                disabled={uploading}
                className="pacs-btn-top sky"
              >
                <FolderPlus size={13} className={uploading && uploadType === 'folder' ? "animate-bounce" : ""} />
                {uploading && uploadType === 'folder' ? `Folder ${uploadProgress.percentage}%` : "Upload Folder"}
                {uploading && uploadType === 'folder' && (
                  <div className="pacs-progress-bar" style={{ width: `${uploadProgress.percentage}%`, background: '#38bdf8' }} />
                )}
              </button>
              {uploading && uploadType === 'folder' && (
                <button type="button" onClick={handleCancelUpload} className="pacs-cancel-btn" title="Cancel Upload">
                  <X size={11} />
                </button>
              )}
            </div>

            <button
              onClick={() => activePacs && loadStudies(activePacs, true)}
              disabled={loading}
              className="pacs-btn-top secondary"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Sync Node
            </button>
          </div>
        </header>

        {/* UNIFIED SINGLE-LINE SEARCH & HIGH-DENSITY FILTER CONTROL BAR */}
        <div className="pacs-filter-bar">
          <div className="pacs-filter-row">
            {/* SEARCH BOX (SEARCHES PATIENT NAME, MRN, ACCESSION NO, AND EXAM DESCRIPTION) */}
            <div className="pacs-search-box">
              <input
                type="text"
                placeholder="Search Patient Name, MRN, Accession No, Exam Description..."
                value={filters.patientName}
                onChange={(e) => {
                  setFilters({ ...filters, patientName: e.target.value });
                  setCurrentPage(1);
                }}
              />
            </div>

            {/* MODALITY SELECTOR */}
            <select
              value={filters.modality}
              onChange={(e) => {
                setFilters({ ...filters, modality: e.target.value });
                setCurrentPage(1);
              }}
              className="pacs-select"
            >
              <option value="">All Modalities</option>
              <option value="CR">CR / DX (X-Ray)</option>
              <option value="CT">CT Scan</option>
              <option value="MR">MR (MRI)</option>
              <option value="US">US (Ultrasound)</option>
              <option value="MG">MG (Mammography)</option>
              <option value="EC">EC (ECHO)</option>
            </select>

            {/* QUICK DATE DROPDOWN MENU */}
            <select
              value={dateQuickFilter}
              onChange={(e) => {
                const val = e.target.value;
                setDateQuickFilter(val);
                setCurrentPage(1);
                let newFrom = fromDate;
                let newTo = toDate;
                if (val !== "CUSTOM") {
                  newFrom = "";
                  newTo = "";
                  setFromDate("");
                  setToDate("");
                }
                loadStudies(activePacs, true, newFrom, newTo, val, filters);
              }}
              className="pacs-select"
            >
              <option value="ALL">📅 All Time</option>
              <option value="TODAY">Today</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="7DAYS">Last 7 Days</option>
              <option value="30DAYS">Last 30 Days</option>
            </select>

            {/* INLINE DATE RANGE (FROM - TO) */}
            <div className="pacs-date-range">
              <input
                type="date"
                value={fromDate}
                title="From Date"
                onChange={(e) => {
                  const val = e.target.value;
                  setFromDate(val);
                  setDateQuickFilter("CUSTOM");
                  setCurrentPage(1);
                  loadStudies(activePacs, true, val, toDate, "CUSTOM", filters);
                }}
              />
              <span className="pacs-date-sep">to</span>
              <input
                type="date"
                value={toDate}
                title="To Date"
                onChange={(e) => {
                  const val = e.target.value;
                  setToDate(val);
                  setDateQuickFilter("CUSTOM");
                  setCurrentPage(1);
                  loadStudies(activePacs, true, fromDate, val, "CUSTOM", filters);
                }}
              />
              {(fromDate || toDate || dateQuickFilter !== "ALL") && (
                <button
                  onClick={() => {
                    setDateQuickFilter("ALL");
                    setFromDate("");
                    setToDate("");
                    setCurrentPage(1);
                    loadStudies(activePacs, true, "", "", "ALL", filters);
                  }}
                  className="pacs-date-reset"
                  title="Reset date filter"
                >
                  Reset
                </button>
              )}
            </div>

            <button
              className="pacs-mobile-filter-toggle"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              title="Toggle Advanced Filters"
            >
              <SlidersHorizontal size={14} />
              <span>Filters</span>
              {activeFilterCount > 0 && <span className="pacs-filter-badge-count">{activeFilterCount}</span>}
            </button>
          </div>
        </div>

        {/* STUDIES HIGH-DENSITY DATA TABLE */}
        <div className="pacs-table-card">
          {loading ? (
            <div className="pacs-loading">
              <RefreshCw size={26} className="animate-spin" />
              <span>Fetching DICOM instances from {activePacs?.ae_title || "PACS Node"}...</span>
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="pacs-table">
                  <thead>
                    <tr>
                      <th>Patient Name & ID</th>
                      <th>Modality</th>
                      <th>Study Description</th>
                      <th>Study Date & Time</th>
                      <th>Accession No</th>
                      <th>Status</th>
                      <th style={{ textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStudies.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="pacs-empty">
                          No DICOM studies matched your search filters.
                        </td>
                      </tr>
                    ) : (
                      pagedStudies.map((s, idx) => {
                        const uid = s.StudyInstanceUID || s.study_uid || s.ID || s.id;
                        const mod = parseModality(s);
                        const rawPName = String(s.PatientName || s.patient_name || "").replace(/undefined|null/gi, "").trim() || "Patient";
                        const pName = formatPatientName(rawPName);
                        const pId = String(s.PatientID || s.patient_id || "").replace(/undefined|null/gi, "-");
                        const acc = String(s.AccessionNumber || s.accession_number || "").replace(/undefined|null/gi, "-");
                        const rStatus = s.report_status || s.ReportStatus || s.status || "Unreported";

                        return (
                          <tr key={uid || idx} className="pacs-table-row">
                            <td>
                              <div className="pacs-patient-block">
                                <span className="pacs-patient-name">{pName}</span>
                                <span className="pacs-patient-id">ID: {pId} • {s.PatientSex || "O"} ({s.PatientAge || "N/A"})</span>
                              </div>
                            </td>

                            <td>
                              <span className={`pacs-modality-badge mod-${mod.toLowerCase()}`}>
                                {mod}
                              </span>
                            </td>

                            <td>
                              <span className="pacs-study-desc" title={s.StudyDescription || "General Examination"}>
                                {s.StudyDescription || "General Examination"}
                              </span>
                            </td>

                            <td>
                              <span className="pacs-time-text">
                                {formatDisplayDateTime(s.StudyDate || s.study_date, s.StudyTime || s.study_time)}
                              </span>
                            </td>

                            <td>
                              <span className="pacs-code-acc">{acc}</span>
                            </td>

                            <td>
                              {(() => {
                                const lock = activeLocks[uid];
                                if (lock) {
                                  return (
                                    <span style={{ background: '#f59e0b', color: '#ffffff', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: 11, boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)' }} title={`Currently being reported by ${lock.doctorName}`}>
                                      🔒 Reporting ({lock.doctorName || 'Dr.'})
                                    </span>
                                  );
                                }
                                const st = String(rStatus).toLowerCase();
                                let bg = '#64748b';
                                let label = rStatus;
                                if (st === 'final') { bg = '#10b981'; label = '✓ Final'; }
                                else if (st === 'draft') { bg = '#0284c7'; label = '📝 Draft'; }
                                else { bg = '#64748b'; label = '⚪ Unreported'; }

                                return (
                                  <span style={{ background: bg, color: '#ffffff', fontWeight: 700, padding: '4px 8px', borderRadius: 6, fontSize: 11 }}>
                                    {label}
                                  </span>
                                );
                              })()}
                            </td>

                            <td style={{ textAlign: "center" }}>
                              <div className="pacs-action-bar">
                                <button
                                  onClick={() => setActiveWorkstationItem({ studyUID: uid, modality: mod })}
                                  className="pacs-btn-action workstation"
                                  title="Launch Workstation"
                                >
                                  <Zap size={13} /> Workstation
                                </button>

                                <button
                                  onClick={() => openStudyViewer(uid)}
                                  className="pacs-btn-action ghost"
                                  title="Open Full OHIF DICOM Viewer"
                                >
                                  <Eye size={13} /> Viewer
                                </button>

                                <button
                                  onClick={() => navigate(`/mobile-viewer?study=${encodeURIComponent(uid)}`)}
                                  className="pacs-btn-action ghost"
                                  style={{ color: "#38bdf8", borderColor: "#0284c7" }}
                                  title="Open Mobile DICOM Viewer"
                                >
                                  <Smartphone size={13} /> Mobile
                                </button>

                                <button
                                  onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(uid)}`)}
                                  className="pacs-btn-action primary"
                                  title="Report Editor"
                                >
                                  <FileText size={13} /> Report
                                </button>

                                {/* EXPORT DROPDOWN */}
                                <div className="pacs-export-dropdown-container" style={{ position: "relative", display: "inline-block" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExportMenuOpenUid(exportMenuOpenUid === uid ? null : uid);
                                    }}
                                    disabled={exportingUid === uid}
                                    className={`pacs-btn-action export ${exportingUid === uid ? "exporting" : ""}`}
                                    title="Export DICOM, JPEG, PNG, or Single Frame"
                                  >
                                    {exportingUid === uid ? (
                                      <>
                                        <RefreshCw size={12} className="animate-spin" /> Exporting...
                                      </>
                                    ) : (
                                      <>
                                        <Download size={12} /> Export <ChevronDown size={10} />
                                      </>
                                    )}
                                  </button>

                                  {/* DROPDOWN MENU */}
                                  {exportMenuOpenUid === uid && (
                                    <div className="pacs-export-dropdown" onClick={(e) => e.stopPropagation()}>
                                      <div className="export-dropdown-header">Export Format</div>
                                      <button
                                        onClick={() => handleExportStudy(uid, "dicom", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon dicom"><FileType size={14} /></div>
                                        <div className="export-item-text">
                                          <span className="item-title">DICOM Dataset (.ZIP)</span>
                                          <span className="item-desc">Full 16-bit diagnostic DCM files</span>
                                        </div>
                                      </button>

                                      <button
                                        onClick={() => handleExportStudy(uid, "jpeg", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon jpeg"><Image size={14} /></div>
                                        <div className="export-item-text">
                                          <span className="item-title">JPEG Series (.ZIP)</span>
                                          <span className="item-desc">8-bit lossy image series</span>
                                        </div>
                                      </button>

                                      <button
                                        onClick={() => handleExportStudy(uid, "png", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon png"><Archive size={14} /></div>
                                        <div className="export-item-text">
                                          <span className="item-title">PNG Series (.ZIP)</span>
                                          <span className="item-desc">Lossless high-res PNG images</span>
                                        </div>
                                      </button>

                                      <button
                                        onClick={() => handleExportStudy(uid, "single", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon single"><FileDown size={14} /></div>
                                        <div className="export-item-text">
                                          <span className="item-title">Key Frame Snapshot (.JPG)</span>
                                          <span className="item-desc">Single representative image</span>
                                        </div>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* DEDICATED MOBILE PATIENT CARDS VIEW */}
              <div className="pacs-mobile-card-list">
                {pagedStudies.length === 0 ? (
                  <div className="pacs-empty">
                    No DICOM studies matched your search filters.
                  </div>
                ) : (
                  pagedStudies.map((s, idx) => {
                    const uid = s.StudyInstanceUID || s.study_uid || s.ID || s.id;
                    const mod = parseModality(s);
                    const rawPName = String(s.PatientName || s.patient_name || "").replace(/undefined|null/gi, "").trim() || "Patient";
                    const pName = formatPatientName(rawPName);
                    const pId = String(s.PatientID || s.patient_id || "").replace(/undefined|null/gi, "-");
                    const acc = String(s.AccessionNumber || s.accession_number || "").replace(/undefined|null/gi, "-");

                    return (
                      <div key={`pacs-card-${uid || ''}-${idx}`} className="pacs-mobile-card">
                        <div className="pmc-header">
                          <div>
                            <span className="pmc-name">{pName}</span>
                            <span className="pmc-sub">ID: {pId} • {s.PatientSex || "O"} ({s.PatientAge || "N/A"})</span>
                          </div>
                          <span className={`pacs-modality-badge mod-${mod.toLowerCase()}`}>
                            {mod}
                          </span>
                        </div>

                        <div className="pmc-grid">
                          <div className="pmc-field">
                            <span className="pmc-lbl">Exam</span>
                            <span className="pmc-val">{s.StudyDescription || "General Examination"}</span>
                          </div>
                          <div className="pmc-field">
                            <span className="pmc-lbl">Acc No</span>
                            <span className="pmc-val code">{acc}</span>
                          </div>
                          <div className="pmc-field" style={{ gridColumn: "span 2" }}>
                            <span className="pmc-lbl">Date & Time</span>
                            <span className="pmc-val">{formatDisplayDateTime(s.StudyDate || s.study_date, s.StudyTime || s.study_time)}</span>
                          </div>
                        </div>

                        <div className="pmc-actions">
                          <button
                            onClick={() => navigate(`/mobile-viewer?study=${encodeURIComponent(uid)}`)}
                            className="pmc-btn primary"
                            title="Open Mobile DICOM Viewer"
                          >
                            <Smartphone size={14} /> Mobile
                          </button>


                          <button
                            onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(uid)}`)}
                            className="pmc-btn secondary"
                            title="Open Radiology Report Editor"
                          >
                            <FileText size={14} /> Report
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* PAGINATION FOOTER */}
              {filteredStudies.length > 0 && (
                <div className="pacs-pagination">
                  <span className="pacs-pag-info">
                    Showing <strong>{(currentPage - 1) * rowsPerPage + 1}</strong> -{" "}
                    <strong>{Math.min(currentPage * rowsPerPage, filteredStudies.length)}</strong> of{" "}
                    <strong>{filteredStudies.length}</strong> studies
                  </span>

                  <div className="pacs-pag-controls">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="pacs-pag-btn"
                    >
                      Prev
                    </button>
                    <span className="pacs-pag-page">Page {currentPage} of {Math.ceil(filteredStudies.length / rowsPerPage) || 1}</span>
                    <button
                      disabled={currentPage >= Math.ceil(filteredStudies.length / rowsPerPage)}
                      onClick={() => setCurrentPage((p) => p + 1)}
                      className="pacs-pag-btn"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* FULL-SCREEN DIAGNOSTIC WORKSTATION MODAL */}
        {activeWorkstationItem && (
          <DiagnosticWorkstationModal
            studyUID={activeWorkstationItem.studyUID}
            initialModality={activeWorkstationItem.modality}
            onClose={() => setActiveWorkstationItem(null)}
          />
        )}
      </div>
    </MainLayout>
  );
}