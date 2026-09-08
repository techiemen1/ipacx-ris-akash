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
  Search,
  Eye,
  FileText,
  RefreshCw,
  Zap,
  UploadCloud,
  FolderPlus,
  Calendar,
  X,
  Download,
  FileDown,
  Image,
  Archive,
  ChevronDown,
  FileType
} from "lucide-react";

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

function getInitials(name) {
  if (!name || typeof name !== "string") return "PT";
  const clean = name.replace(/undefined|null|none/gi, "").trim();
  if (!clean) return "PT";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function parseModality(study) {
  const raw = study?.Modality || study?.modality || study?.ModalitiesInStudy || study?.modality_in_study || "";
  const str = String(raw).toUpperCase().replace(/UNDEFINED|NULL/g, "").trim();

  if (str && str !== "N/A" && str !== "UNDEFINED") {
    if (str === "MRI") return "MR";
    if (str === "USG") return "US";
    if (str === "ECHO") return "EC";
    return str;
  }

  const desc = String(study?.StudyDescription || study?.study_description || "").toUpperCase();
  if (desc.includes("MRI") || desc.includes("MR") || desc.includes("SPINE") || desc.includes("BRAIN")) return "MR";
  if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) return "US";
  if (desc.includes("CT") || desc.includes("ABDOMEN") || desc.includes("HEAD")) return "CT";
  if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) return "CR";

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

  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 15;

  const [exportMenuOpenUid, setExportMenuOpenUid] = useState(null);
  const [exportingUid, setExportingUid] = useState(null);
  const [exportType, setExportType] = useState(null);

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
    if (!pacs) return;

    setActivePacs(pacs);
    sessionStorage.setItem("activePacs", JSON.stringify(pacs));
    setLoading(true);
    setCurrentPage(1);

    try {
      const res = await api.get("/api/pacs/studies", { params: { pacs_id: pacs.id } }).catch(() => ({ data: [] }));
      let studiesList = Array.isArray(res.data) ? res.data : [];

      if (studiesList.length === 0 && pacs.pacs_type !== "ORTHANC") {
        const orthancRes = await api.get("/api/pacs/studies", { params: { pacs_id: "orthanc" } }).catch(() => ({ data: [] }));
        if (Array.isArray(orthancRes.data) && orthancRes.data.length > 0) {
          studiesList = orthancRes.data;
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
        const list = Array.isArray(res.data) ? res.data : [];
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
      const matchMod = !filters.modality || mod === filters.modality;

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

        {/* HEADER BAR */}
        <header className="pacs-header">
          <div className="pacs-title-section">
            <span className="pacs-tag">PACS & DICOM Imaging Node | High Performance Diagnostic Explorer</span>
            <h1 className="pacs-title">Enterprise PACS Viewer & Studies</h1>
          </div>

          <div className="pacs-header-actions">
            {/* BUTTON 1: UPLOAD FILE / ZIP (WITH INTEGRATED MICRO PROGRESS BAR) */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                disabled={uploading}
                className="pacs-btn pacs-btn-primary"
                style={{ position: 'relative', overflow: 'hidden', minWidth: 170 }}
              >
                <UploadCloud size={15} className={uploading && uploadType === 'zip' ? "animate-bounce" : ""} />
                {uploading && uploadType === 'zip' ? `Uploading ZIP ${uploadProgress.percentage}%` : "Upload File / ZIP"}

                {/* MICRO PROGRESS TRACKER ON BUTTON */}
                {uploading && uploadType === 'zip' && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: 4,
                    background: '#22c55e',
                    width: `${uploadProgress.percentage}%`,
                    transition: 'width 0.15s ease-out'
                  }} />
                )}
              </button>
              {uploading && uploadType === 'zip' && (
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  style={{
                    position: 'absolute',
                    right: -28,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid #fca5a5',
                    borderRadius: '50%',
                    width: 22,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                  title="Cancel Upload"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/* BUTTON 2: UPLOAD FOLDER (WITH INTEGRATED MICRO PROGRESS BAR) */}
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button
                onClick={() => folderInputRef.current && folderInputRef.current.click()}
                disabled={uploading}
                className="pacs-btn pacs-btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  position: 'relative',
                  overflow: 'hidden',
                  minWidth: 170
                }}
              >
                <FolderPlus size={15} className={uploading && uploadType === 'folder' ? "animate-bounce" : ""} />
                {uploading && uploadType === 'folder' ? `Uploading Folder ${uploadProgress.percentage}%` : "Upload Folder"}

                {/* MICRO PROGRESS TRACKER ON BUTTON */}
                {uploading && uploadType === 'folder' && (
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: 4,
                    background: '#38bdf8',
                    width: `${uploadProgress.percentage}%`,
                    transition: 'width 0.15s ease-out'
                  }} />
                )}
              </button>
              {uploading && uploadType === 'folder' && (
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  style={{
                    position: 'absolute',
                    right: -28,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#fef2f2',
                    color: '#dc2626',
                    border: '1px solid #fca5a5',
                    borderRadius: '50%',
                    width: 22,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                  title="Cancel Upload"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <button
              onClick={() => activePacs && loadStudies(activePacs)}
              disabled={loading}
              className="pacs-btn pacs-btn-secondary"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Sync Node
            </button>
          </div>
        </header>

        {/* PACS NODE SELECTOR STRIP */}
        <div className="pacs-server-strip">
          <span className="pacs-server-label">Connected DICOM Nodes:</span>
          <div className="pacs-server-pills">
            {pacsServers.map((pacs) => {
              const isActive = activePacs?.id === pacs.id;
              return (
                <button
                  key={pacs.id}
                  onClick={() => loadStudies(pacs)}
                  className={`pacs-server-pill ${isActive ? "active" : ""}`}
                >
                  <Server size={14} />
                  <span>{pacs.ae_title}</span>
                  <span className="pill-dot" />
                </button>
              );
            })}
          </div>
        </div>

        {/* SEARCH & ADVANCED DATE RANGE FILTER CARD */}
        <div className="pacs-card">
          <div className="pacs-filter-grid">
            <div className="filter-input-group">
              <label>Patient ID / MRN</label>
              <input
                type="text"
                placeholder="Filter ID..."
                value={filters.patientId}
                onChange={(e) => setFilters({ ...filters, patientId: e.target.value })}
              />
            </div>

            <div className="filter-input-group">
              <label>Patient Name</label>
              <input
                type="text"
                placeholder="Filter Name..."
                value={filters.patientName}
                onChange={(e) => setFilters({ ...filters, patientName: e.target.value })}
              />
            </div>

            <div className="filter-input-group">
              <label>Accession No.</label>
              <input
                type="text"
                placeholder="Filter Accession..."
                value={filters.accession}
                onChange={(e) => setFilters({ ...filters, accession: e.target.value })}
              />
            </div>

            <div className="filter-input-group">
              <label>Modality</label>
              <select
                value={filters.modality}
                onChange={(e) => setFilters({ ...filters, modality: e.target.value })}
              >
                <option value="">All Modalities</option>
                <option value="CR">CR / DX (X-Ray)</option>
                <option value="CT">CT Scan</option>
                <option value="MR">MR (MRI)</option>
                <option value="US">US (Ultrasound)</option>
                <option value="MG">MG (Mammography)</option>
              </select>
            </div>
          </div>

          {/* DAY / DATE & FROM-TO DATE RANGE FILTER STRIP */}
          <div className="pacs-date-filter-strip">
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="date-quick-label"><Calendar size={13} /> Quick Date:</span>
              {["ALL", "TODAY", "YESTERDAY", "7DAYS", "30DAYS"].map((quickKey) => (
                <button
                  key={quickKey}
                  onClick={() => {
                    setDateQuickFilter(quickKey);
                    if (quickKey !== "CUSTOM") {
                      setFromDate("");
                      setToDate("");
                    }
                  }}
                  className={`date-chip-btn ${dateQuickFilter === quickKey ? "active" : ""}`}
                >
                  {quickKey === "ALL" ? "All Time" : quickKey === "TODAY" ? "Today" : quickKey === "YESTERDAY" ? "Yesterday" : quickKey === "7DAYS" ? "Last 7 Days" : "Last 30 Days"}
                </button>
              ))}
            </div>

            {/* FROM DATE - TO DATE */}
            <div className="date-picker-group">
              <div className="date-input-wrap">
                <label>From Date:</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setDateQuickFilter("CUSTOM");
                  }}
                />
              </div>

              <div className="date-input-wrap">
                <label>To Date:</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setDateQuickFilter("CUSTOM");
                  }}
                />
              </div>

              {(fromDate || toDate || dateQuickFilter !== "ALL") && (
                <button
                  onClick={() => {
                    setDateQuickFilter("ALL");
                    setFromDate("");
                    setToDate("");
                  }}
                  className="reset-date-btn"
                >
                  Reset Dates
                </button>
              )}
            </div>
          </div>
        </div>

        {/* STUDIES TABLE CARD */}
        <div className="pacs-card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div className="pacs-loading">
              <RefreshCw size={28} className="animate-spin" />
              <span>Fetching DICOM instances & recent cases from {activePacs?.ae_title || "Node"}...</span>
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="pacs-table">
                  <thead>
                    <tr>
                      <th>Patient Name</th>
                      <th>Patient ID / MRN</th>
                      <th>Modality</th>
                      <th>Study Description</th>
                      <th>Study Date & Time</th>
                      <th>Accession</th>
                      <th style={{ textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStudies.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="pacs-empty">
                          No matching DICOM studies found for the selected date range and criteria.
                        </td>
                      </tr>
                    ) : (
                      pagedStudies.map((s, idx) => {
                        const uid = s.StudyInstanceUID || s.study_uid || s.ID || s.id;
                        const mod = parseModality(s);
                        const pName = String(s.PatientName || s.patient_name || "").replace(/undefined|null/gi, "").trim() || "Patient";
                        const pId = String(s.PatientID || s.patient_id || "").replace(/undefined|null/gi, "-");
                        const acc = String(s.AccessionNumber || s.accession_number || "").replace(/undefined|null/gi, "-");

                        return (
                          <tr key={uid || idx} className={`pacs-row-modality mod-row-${mod.toLowerCase()}`}>
                            <td>
                              <div className="patient-cell">
                                <div className="patient-details">
                                  <span className="patient-name">{pName}</span>
                                  <span className="patient-sub">{s.PatientSex || "O"} • {s.PatientAge || "N/A"}</span>
                                </div>
                              </div>
                            </td>

                            <td>
                              <span className="pacs-code">{pId}</span>
                            </td>

                            <td>
                              <span className={`pacs-badge-modality mod-${mod.toLowerCase()}`}>
                                {mod}
                              </span>
                            </td>

                            <td>
                              <span className="study-desc">
                                {s.StudyDescription || "General Examination"}
                              </span>
                            </td>

                            <td style={{ fontWeight: 600, color: "#0f172a" }}>
                              {formatDisplayDateTime(s.StudyDate || s.study_date, s.StudyTime || s.study_time)}
                            </td>

                            <td>
                              <span className="pacs-code-sub">{acc}</span>
                            </td>

                            <td style={{ textAlign: "center" }}>
                              <div className="pacs-action-buttons">
                                <button
                                  onClick={() => setActiveWorkstationItem({ studyUID: uid, modality: mod })}
                                  className="pacs-icon-btn workstation"
                                  title="Launch Full-Screen Flash Split Workstation"
                                >
                                  <Zap size={13} /> Split
                                </button>

                                <button
                                  onClick={() => openStudyViewer(uid)}
                                  className="pacs-icon-btn view"
                                  title="Open in OHIF DICOM Viewer"
                                >
                                  <Eye size={13} /> OHIF
                                </button>

                                <button
                                  onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(uid)}`)}
                                  className="pacs-icon-btn report"
                                  title="Report Editor"
                                >
                                  <FileText size={13} /> Report
                                </button>

                                {/* EXPORT ACTION DROPDOWN */}
                                <div className="pacs-export-dropdown-container" style={{ position: "relative", display: "inline-block" }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExportMenuOpenUid(exportMenuOpenUid === uid ? null : uid);
                                    }}
                                    disabled={exportingUid === uid}
                                    className={`pacs-icon-btn export ${exportingUid === uid ? "exporting" : ""}`}
                                    title="Export DICOM, JPEG, PNG, or Single Frame Image"
                                  >
                                    {exportingUid === uid ? (
                                      <>
                                        <RefreshCw size={13} className="animate-spin" /> Exporting...
                                      </>
                                    ) : (
                                      <>
                                        <Download size={13} /> Export <ChevronDown size={11} />
                                      </>
                                    )}
                                  </button>

                                  {/* DROPDOWN MENU */}
                                  {exportMenuOpenUid === uid && (
                                    <div className="pacs-export-dropdown" onClick={(e) => e.stopPropagation()}>
                                      <div className="export-dropdown-header">
                                        <span>Universal Export Options</span>
                                      </div>

                                      <button
                                        onClick={() => handleExportStudy(uid, "dicom", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon dicom">
                                          <Archive size={14} />
                                        </div>
                                        <div className="export-item-text">
                                          <span className="item-title">DICOM Archive (.zip)</span>
                                          <span className="item-desc">Raw ISO standard .dcm dataset</span>
                                        </div>
                                      </button>

                                      <button
                                        onClick={() => handleExportStudy(uid, "jpeg", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon jpeg">
                                          <Image size={14} />
                                        </div>
                                        <div className="export-item-text">
                                          <span className="item-title">JPEG Bundle (.zip)</span>
                                          <span className="item-desc">Universal medical image photos</span>
                                        </div>
                                      </button>

                                      <button
                                        onClick={() => handleExportStudy(uid, "png", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon png">
                                          <FileType size={14} />
                                        </div>
                                        <div className="export-item-text">
                                          <span className="item-title">PNG Bundle (.zip)</span>
                                          <span className="item-desc">Lossless high-res images</span>
                                        </div>
                                      </button>

                                      <button
                                        onClick={() => handleExportStudy(uid, "single", pName)}
                                        className="export-menu-item"
                                      >
                                        <div className="export-icon single">
                                          <FileDown size={14} />
                                        </div>
                                        <div className="export-item-text">
                                          <span className="item-title">Key Image (.jpg)</span>
                                          <span className="item-desc">Single frame preview photo</span>
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

              {/* PAGINATION */}
              {filteredStudies.length > rowsPerPage && (
                <div className="pacs-pagination">
                  <span>
                    Showing {(currentPage - 1) * rowsPerPage + 1} -{" "}
                    {Math.min(currentPage * rowsPerPage, filteredStudies.length)} of {filteredStudies.length} studies
                  </span>

                  <div className="pagination-buttons">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>

                    <span>Page {currentPage} of {Math.ceil(filteredStudies.length / rowsPerPage)}</span>

                    <button
                      disabled={currentPage >= Math.ceil(filteredStudies.length / rowsPerPage)}
                      onClick={() => setCurrentPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* FULL-SCREEN FLASH DIAGNOSTIC WORKSTATION MODAL */}
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