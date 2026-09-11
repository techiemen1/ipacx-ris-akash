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
  const s = String(dateStr).trim();

  if (/^\d{8}$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    let t = "00:00:00";
    if (timeStr && String(timeStr).trim().length >= 6) {
      const ts = String(timeStr).trim();
      t = `${ts.slice(0, 2)}:${ts.slice(2, 4)}:${ts.slice(4, 6)}`;
    }
    const iso = `${yyyy}-${mm}-${dd}T${t}`;
    const timestamp = new Date(iso).getTime();
    return isNaN(timestamp) ? 0 : timestamp;
  }

  const d = new Date(s);
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

  async function loadStudies(pacs) {
    const targetPacs = pacs || { id: "orthanc", ae_title: "ORTHANC", pacs_type: "ORTHANC", is_default: true };
    setActivePacs(targetPacs);
    sessionStorage.setItem("activePacs", JSON.stringify(targetPacs));
    setLoading(true);
    setCurrentPage(1);

    try {
      const res = await api.get("/api/pacs/studies", { params: { pacs_id: targetPacs.id || "orthanc" } }).catch(() => ({ data: [] }));
      let studiesList = Array.isArray(res.data) 
        ? res.data 
        : (Array.isArray(res.data?.data) ? res.data.data : (Array.isArray(res.data?.studies) ? res.data.studies : []));

      if (studiesList.length === 0 && targetPacs.pacs_type !== "ORTHANC") {
        const orthancRes = await api.get("/api/pacs/studies", { params: { pacs_id: "orthanc" } }).catch(() => ({ data: [] }));
        const fallbackList = Array.isArray(orthancRes.data)
          ? orthancRes.data
          : (Array.isArray(orthancRes.data?.data) ? orthancRes.data.data : []);
        if (fallbackList.length > 0) {
          studiesList = fallbackList;
        }
      }

      if (studiesList.length === 0) {
        const allRes = await api.get("/api/pacs/studies").catch(() => ({ data: [] }));
        const allList = Array.isArray(allRes.data)
          ? allRes.data
          : (Array.isArray(allRes.data?.data) ? allRes.data.data : []);
        if (allList.length > 0) {
          studiesList = allList;
        }
      }

      const processed = studiesList.map(s => ({
        ...s,
        raw_timestamp: parseDicomDateTime(s.StudyDate || s.study_date, s.StudyTime || s.study_time)
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
        const res = await api.get("/api/mwl-targets").catch(() => ({ data: [] }));
        const list = Array.isArray(res.data) 
          ? res.data 
          : (Array.isArray(res.data?.data) ? res.data.data : []);
        setPacsServers(list);

        const saved = sessionStorage.getItem("activePacs");
        let initialPacs = null;
        if (saved) {
          try {
            initialPacs = JSON.parse(saved);
          } catch (e) {
            initialPacs = null;
          }
        }

        if (!initialPacs && list.length > 0) {
          initialPacs = list.find((s) => s.is_default) || list[0];
        }

        if (!initialPacs) {
          initialPacs = { id: "orthanc", ae_title: "ORTHANC", pacs_type: "ORTHANC", is_default: true };
        }

        loadStudies(initialPacs);
      } catch (err) {
        console.error("Failed to init PACS servers:", err);
        const fallback = { id: "orthanc", ae_title: "ORTHANC", pacs_type: "ORTHANC", is_default: true };
        loadStudies(fallback);
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let totalPayloadSize = 0;
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("dicomFiles", files[i]);
      totalPayloadSize += files[i].size || 0;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setUploadType(type);
    setUploading(true);
    setUploadProgress({
      percentage: 0,
      loadedBytes: 0,
      totalBytes: totalPayloadSize,
      fileCount: files.length
    });

    try {
      const { data } = await api.post("/api/pacs/upload", formData, {
        signal: controller.signal,
        headers: { "Content-Type": undefined },
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || totalPayloadSize || progressEvent.loaded || 1;
          const percentCompleted = Math.min(100, Math.round((progressEvent.loaded * 100) / total));
          
          setUploadProgress({
            percentage: percentCompleted,
            loadedBytes: progressEvent.loaded,
            totalBytes: total,
            fileCount: files.length
          });

          // INSTANT AUTO-CLOSE ON 100% COMPLETION
          if (percentCompleted >= 100) {
            setTimeout(() => {
              setUploading(false);
            }, 250);
          }
        }
      });

      if (data?.success) {
        loadStudies(activePacs);
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
      setUploading(false);
      setUploadType(null);
      setUploadProgress({ percentage: 0, loadedBytes: 0, totalBytes: 0, fileCount: 0 });
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const filteredStudies = useMemo(() => {
    const result = studies.filter((s) => {
      const pName = String(s.PatientName || s.patient_name || "").replace(/undefined|null/gi, "").trim();
      const pId = String(s.PatientID || s.patient_id || "").replace(/undefined|null/gi, "").trim();
      const acc = String(s.AccessionNumber || s.accession_number || "").replace(/undefined|null/gi, "").trim();
      const mod = parseModality(s);

      const matchId = !filters.patientId || safeLower(pId).includes(safeLower(filters.patientId));
      const matchName = !filters.patientName || safeLower(pName).includes(safeLower(filters.patientName));
      const matchAcc = !filters.accession || safeLower(acc).includes(safeLower(filters.accession));
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

      return matchId && matchName && matchAcc && matchMod && matchDate;
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
              onClick={() => activePacs && loadStudies(activePacs)}
              disabled={loading}
              className="pacs-btn-top secondary"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Sync Node
            </button>
          </div>
        </header>

        {/* UNIFIED SEARCH & HIGH-DENSITY FILTER CONTROL BAR */}
        <div className="pacs-filter-bar">
          <div className="pacs-filter-row">
            {/* SEARCH BOX */}
            <div className="pacs-search-box">
              <input
                type="text"
                placeholder="Search Patient Name, MRN, Accession No..."
                value={filters.patientName}
                onChange={(e) => {
                  setFilters({ ...filters, patientName: e.target.value });
                  setCurrentPage(1);
                }}
              />
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

          <div className={`pacs-filter-controls-group ${showMobileFilters ? "show-mobile" : ""}`}>
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

            {/* QUICK DATE PILLS */}
            <div className="pacs-date-pills">
              {["ALL", "TODAY", "YESTERDAY", "7DAYS", "30DAYS"].map((quickKey) => (
                <button
                  key={quickKey}
                  onClick={() => {
                    setDateQuickFilter(quickKey);
                    setCurrentPage(1);
                    if (quickKey !== "CUSTOM") {
                      setFromDate("");
                      setToDate("");
                    }
                  }}
                  className={`pacs-date-pill ${dateQuickFilter === quickKey ? "active" : ""}`}
                >
                  {quickKey === "ALL" ? "All Time" : quickKey === "TODAY" ? "Today" : quickKey === "YESTERDAY" ? "Yesterday" : quickKey === "7DAYS" ? "7 Days" : "30 Days"}
                </button>
              ))}
            </div>

            {/* FROM - TO DATE INPUTS */}
            <div className="pacs-date-range">
              <input
                type="date"
                value={fromDate}
                title="From Date"
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setDateQuickFilter("CUSTOM");
                  setCurrentPage(1);
                }}
              />
              <span className="pacs-date-sep">to</span>
              <input
                type="date"
                value={toDate}
                title="To Date"
                onChange={(e) => {
                  setToDate(e.target.value);
                  setDateQuickFilter("CUSTOM");
                  setCurrentPage(1);
                }}
              />
              {(fromDate || toDate || dateQuickFilter !== "ALL") && (
                <button
                  onClick={() => {
                    setDateQuickFilter("ALL");
                    setFromDate("");
                    setToDate("");
                    setCurrentPage(1);
                  }}
                  className="pacs-date-reset"
                  title="Reset date filter"
                >
                  Reset
                </button>
              )}
            </div>
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
              {/* TOP PAGINATION BAR (Desktop & Mobile) */}
              {filteredStudies.length > 0 && (
                <div className="pacs-pagination pacs-pagination-top">
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
                    <span className="pacs-pag-page">
                      Page <strong>{currentPage}</strong> of <strong>{Math.ceil(filteredStudies.length / rowsPerPage) || 1}</strong>
                    </span>
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

              <div className="table-responsive">
                <table className="pacs-table">
                  <thead>
                    <tr>
                      <th>Patient Name & ID</th>
                      <th>Modality</th>
                      <th>Study Description</th>
                      <th>Study Date & Time</th>
                      <th>Accession No</th>
                      <th style={{ textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStudies.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="pacs-empty">
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
                                  onClick={() => navigate(`/native-viewer?study=${encodeURIComponent(uid)}`)}
                                  className="pacs-btn-action ghost"
                                  style={{ color: "#a855f7", borderColor: "#9333ea" }}
                                  title="Open Ultra-Fast Native Canvas DICOM Viewer (<20ms)"
                                >
                                  <Compass size={13} /> Canvas
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
                      <div key={uid || idx} className="pacs-mobile-card">
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
                          >
                            <Smartphone size={15} /> Mobile Viewer
                          </button>

                          <button
                            onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(uid)}`)}
                            className="pmc-btn secondary"
                          >
                            <FileText size={15} /> Report
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