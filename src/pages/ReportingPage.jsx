import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import api from "../api/axios";
import "./ReportingPage.css";
import { openStudyViewer } from "../utils/viewerUtils";
import DiagnosticWorkstationModal from "../components/ReportStudio/DiagnosticWorkstationModal";
import ShareReportModal from "../components/ShareReportModal";
import {
  FileText,
  Search,
  Eye,
  Clock,
  CheckCircle,
  RefreshCw,
  FileCheck,
  Zap,
  Share2,
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

function parseModality(item) {
  const raw = item?.modality || item?.Modality || item?.ModalitiesInStudy || item?.modality_in_study || "";
  const str = String(raw).toUpperCase().replace(/UNDEFINED|NULL/g, "").trim();

  if (str && str !== "N/A" && str !== "UNDEFINED") {
    if (str === "MRI") return "MR";
    if (str === "USG") return "US";
    if (str === "ECHO") return "EC";
    if (["CR", "DX", "XR", "CT", "MR", "US", "MG", "EC"].includes(str)) return str;
  }

  const desc = String(item?.study_description || item?.StudyDescription || item?.study_type || "").toUpperCase();
  if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST PA") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) return "CR";
  if (desc.includes("MRI") || desc.includes("MR") || desc.includes("SPINE") || desc.includes("BRAIN") || desc.includes("KNEE")) return "MR";
  if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) return "US";
  if (desc.includes("CT") || desc.includes("TOMOGRAPHY") || desc.includes("HEAD") || desc.includes("SINUS") || desc.includes("ABDOMEN")) return "CT";

  return "CR";
}

export default function ReportingPage() {
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [filterModality, setFilterModality] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [dateQuickFilter, setDateQuickFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortOrder, setSortOrder] = useState("DESC"); // "DESC" = Newest first, "ASC" = Start Date / Oldest first

  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeWorkstationItem, setActiveWorkstationItem] = useState(null);
  const rowsPerPage = 10;

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterModality) count++;
    if (filterStatus) count++;
    if (dateQuickFilter !== "ALL") count++;
    if (fromDate || toDate) count++;
    return count;
  }, [filterModality, filterStatus, dateQuickFilter, fromDate, toDate]);

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

  const fetchData = async (fDate = fromDate, tDate = toDate, qFilter = dateQuickFilter, qText = searchText, mod = filterModality) => {
    setLoading(true);
    try {
      fetchActiveLocks();
      const { data: reportsData } = await api.get("/api/reports").catch(() => ({ data: [] }));
      const reportsList = Array.isArray(reportsData) ? reportsData : [];
      setReports(reportsList);

      const savedPacs = sessionStorage.getItem("activePacs");
      const pacsObj = savedPacs ? JSON.parse(savedPacs) : null;
      const pacsId = pacsObj?.id || "all";

      const params = { pacs_id: pacsId, refresh: "true" };
      const now = new Date();
      const formatYMD = (d) => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
      };

      if (qFilter === "ALL") {
        // All Time: Omit date range parameters to fetch all historical studies
      } else if (qFilter === "CUSTOM") {
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
      } else if (fDate || tDate) {
        if (fDate) params.startDate = fDate.replace(/-/g, "");
        if (tDate) params.endDate = tDate.replace(/-/g, "");
      }

      if (qText) params.patientName = qText;
      if (mod) params.modality = mod;

      const { data: studiesData } = await api.get("/api/pacs/studies", { params }).catch(() => ({ data: [] }));
      let studiesList = Array.isArray(studiesData) ? studiesData : (Array.isArray(studiesData?.data) ? studiesData.data : []);

      if (studiesList.length === 0) {
        const fallbackRes = await api.get("/api/pacs/studies", { params: { ...params, pacs_id: "all" } }).catch(() => ({ data: [] }));
        studiesList = Array.isArray(fallbackRes.data) ? fallbackRes.data : (Array.isArray(fallbackRes.data?.data) ? fallbackRes.data.data : []);
      }

      setStudies(studiesList);
    } catch (err) {
      console.error("Failed to load worklist data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const lockInterval = setInterval(fetchActiveLocks, 8000);
    return () => clearInterval(lockInterval);
  }, []);

  const mergedWorklist = useMemo(() => {
    const reportMap = {};
    reports.forEach(r => {
      if (r.study_uid) reportMap[r.study_uid] = r;
    });

    const worklist = [];

    studies.forEach(s => {
      const uid = s.StudyInstanceUID || s.study_uid;
      const existingReport = reportMap[uid];

      const rawPName = String(s.PatientName || s.patient_name || existingReport?.patient_name || "").replace(/undefined|null/gi, "").trim();
      const pName = rawPName || "Patient";
      const rawTs = parseDicomDateTime(s.StudyDate || s.study_date || existingReport?.created_at, s.StudyTime || s.study_time);

      const studyDesc = s.StudyDescription || "General Examination";
      const isSTAT = /STAT|EMERGENCY|TRAUMA|ACUTE|STROKE|HEMORRHAGE|BLEED|RED/i.test(`${studyDesc} ${pName} ${existingReport?.report_title || ''}`);

      worklist.push({
        study_uid: uid,
        patient_name: pName,
        patient_id: String(s.PatientID || s.patient_id || existingReport?.patient_id || "-").replace(/undefined|null/gi, "-"),
        accession_number: String(s.AccessionNumber || s.accession_number || existingReport?.accession_number || "-").replace(/undefined|null/gi, "-"),
        modality: parseModality(s) || parseModality(existingReport) || "CR",
        study_description: studyDesc,
        study_date: s.StudyDate || s.study_date || existingReport?.created_at?.split("T")[0] || "-",
        study_time: s.StudyTime || s.study_time || "",
        raw_timestamp: rawTs,
        status: existingReport?.status || "Unreported",
        isSTAT: isSTAT,
        report_content: existingReport?.report_content,
        report_id: existingReport?.id
      });
    });

    reports.forEach(r => {
      if (r.study_uid && !studies.some(s => (s.StudyInstanceUID || s.study_uid) === r.study_uid)) {
        const rawPName = String(r.patient_name || "").replace(/undefined|null/gi, "").trim();
        const pName = rawPName || "Patient";
        const rawTs = parseDicomDateTime(r.created_at || r.updated_at);

        worklist.push({
          study_uid: r.study_uid,
          patient_name: pName,
          patient_id: String(r.patient_id || "-").replace(/undefined|null/gi, "-"),
          accession_number: String(r.accession_number || "-").replace(/undefined|null/gi, "-"),
          modality: parseModality(r) || "CR",
          study_description: "Radiology Study",
          study_date: r.created_at?.split("T")[0] || "-",
          study_time: "",
          raw_timestamp: rawTs,
          status: r.status || "Draft",
          report_content: r.report_content,
          report_id: r.id
        });
      }
    });

    return worklist.sort((a, b) => (b.raw_timestamp || 0) - (a.raw_timestamp || 0));
  }, [studies, reports]);

  const filteredWorklist = useMemo(() => {
    return mergedWorklist.filter(item => {
      const q = searchText.toLowerCase().trim();
      const matchSearch =
        !q ||
        item.patient_name.toLowerCase().includes(q) ||
        item.patient_id.toLowerCase().includes(q) ||
        item.accession_number.toLowerCase().includes(q) ||
        (item.study_description || "").toLowerCase().includes(q);

      const matchModality = !filterModality ||
        (filterModality === "CR" ? (item.modality === "CR" || item.modality === "DX" || item.modality === "XR") : item.modality === filterModality);
      const matchStatus = !filterStatus ? true : filterStatus === "STAT" ? item.isSTAT : item.status === filterStatus;

      let matchDate = true;
      const recordTs = item.raw_timestamp || parseDicomDateTime(item.study_date, item.study_time);

      if (recordTs) {
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
        } else if (dateQuickFilter === "CUSTOM") {
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

      return matchSearch && matchModality && matchStatus && matchDate;
    });

    return list.sort((a, b) => {
      const tsA = a.raw_timestamp || 0;
      const tsB = b.raw_timestamp || 0;
      return sortOrder === "ASC" ? tsA - tsB : tsB - tsA;
    });
  }, [mergedWorklist, searchText, filterModality, filterStatus, dateQuickFilter, fromDate, toDate, sortOrder]);

  const pagedWorklist = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredWorklist.slice(start, start + rowsPerPage);
  }, [filteredWorklist, currentPage]);

  const stats = useMemo(() => {
    const total = mergedWorklist.length;
    const unreported = mergedWorklist.filter(w => w.status === "Unreported").length;
    const draft = mergedWorklist.filter(w => w.status === "Draft").length;
    const final = mergedWorklist.filter(w => w.status === "Final").length;
    const statCount = mergedWorklist.filter(w => w.isSTAT).length;
    return { total, unreported, draft, final, statCount };
  }, [mergedWorklist]);

  return (
    <MainLayout>
      <div className="rp-container">
        {/* EXECUTIVE WORKLIST HEADER & COMPACT KPI STRIP */}
        <header className="rp-header-compact">
          <div className="rp-title-group">
            <div className="rp-title-row">
              <h1 className="rp-title">Reporting Hub & Worklist</h1>
              <span className="rp-tag">RIS Engine v1.1</span>
            </div>
            <p className="rp-subtitle">Real-time PACS DICOM worklist, diagnostic reporting & distribution</p>
          </div>

          {/* HIGH-DENSITY INLINE KPI CARDS */}
          <div className="rp-kpi-strip">
            <div className="rp-kpi-pill total">
              <FileText size={14} />
              <span className="kpi-label">Total</span>
              <span className="kpi-val">{stats.total}</span>
            </div>

            <div className="rp-kpi-pill warning">
              <Clock size={14} />
              <span className="kpi-label">Unreported</span>
              <span className="kpi-val">{stats.unreported}</span>
            </div>

            <div className="rp-kpi-pill info">
              <FileCheck size={14} />
              <span className="kpi-label">Draft</span>
              <span className="kpi-val">{stats.draft}</span>
            </div>

            <div className="rp-kpi-pill success">
              <CheckCircle size={14} />
              <span className="kpi-label">Final</span>
              <span className="kpi-val">{stats.final}</span>
            </div>

            {stats.statCount > 0 && (
              <div className="rp-kpi-pill stat">
                <Zap size={14} />
                <span className="kpi-label">STAT Emergency</span>
                <span className="kpi-val">{stats.statCount}</span>
              </div>
            )}

            <button onClick={fetchData} className="rp-btn-sync" disabled={loading} title="Sync latest DICOM worklist">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Sync Worklist
            </button>
          </div>
        </header>

        {/* UNIFIED SINGLE-LINE SEARCH & HIGH-DENSITY FILTER CONTROL BAR */}
        <div className="rp-filter-bar">
          <div className="rp-filter-row-primary">
            {/* SEARCH BOX (SEARCHES PATIENT NAME, MRN, ACCESSION NO, PATIENT/EXAM DESCRIPTION) */}
            <div className="rp-search-box">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search Patient Name, MRN, Accession No, Exam/Patient Description..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>

            {/* MODALITY FILTER */}
            <select
              value={filterModality}
              onChange={(e) => {
                setFilterModality(e.target.value);
                setCurrentPage(1);
              }}
              className="rp-select"
            >
              <option value="">All Modalities</option>
              <option value="CR">CR / DX (X-Ray)</option>
              <option value="CT">CT Scan</option>
              <option value="MR">MR (MRI)</option>
              <option value="US">US (Ultrasound)</option>
              <option value="MG">MG (Mammography)</option>
              <option value="EC">EC (ECHO)</option>
            </select>

            {/* STATUS FILTER */}
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="rp-select"
            >
              <option value="">All Statuses</option>
              <option value="STAT">🚨 STAT Emergency ({stats.statCount})</option>
              <option value="Unreported">Unreported ({stats.unreported})</option>
              <option value="Draft">Draft ({stats.draft})</option>
              <option value="Final">Final ({stats.final})</option>
            </select>

            {/* QUICK DATE DROPDOWN MENU */}
            <select
              value={dateQuickFilter}
              onChange={(e) => {
                const val = e.target.value;
                setDateQuickFilter(val);
                setCurrentPage(1);
                let f = fromDate;
                let t = toDate;
                if (val !== "CUSTOM") {
                  f = "";
                  t = "";
                  setFromDate("");
                  setToDate("");
                } else {
                  setSortOrder("ASC");
                }
                fetchData(f, t, val, searchText, filterModality);
              }}
              className="rp-select"
            >
              <option value="ALL">📅 All Time</option>
              <option value="TODAY">Today</option>
              <option value="YESTERDAY">Yesterday</option>
              <option value="7DAYS">Last 7 Days</option>
              <option value="30DAYS">Last 30 Days</option>
            </select>

            {/* INLINE DATE RANGE (FROM - TO) */}
            <div className="rp-date-range">
              <input
                type="date"
                value={fromDate}
                title="From Date"
                onChange={(e) => {
                  const val = e.target.value;
                  setFromDate(val);
                  setDateQuickFilter("CUSTOM");
                  setSortOrder("ASC");
                  setCurrentPage(1);
                  fetchData(val, toDate, "CUSTOM", searchText, filterModality);
                }}
              />
              <span className="rp-date-sep">to</span>
              <input
                type="date"
                value={toDate}
                title="To Date"
                onChange={(e) => {
                  const val = e.target.value;
                  setToDate(val);
                  setDateQuickFilter("CUSTOM");
                  setSortOrder("ASC");
                  setCurrentPage(1);
                  fetchData(fromDate, val, "CUSTOM", searchText, filterModality);
                }}
              />
              <button
                type="button"
                onClick={() => setSortOrder(prev => prev === "ASC" ? "DESC" : "ASC")}
                className="rp-select"
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 700,
                  background: sortOrder === "ASC" ? "#e0f2fe" : "#ffffff",
                  color: sortOrder === "ASC" ? "#0369a1" : "#334155",
                  borderColor: sortOrder === "ASC" ? "#0284c7" : "#cbd5e1"
                }}
                title="Toggle Date Search Order (Start Date First vs Newest First)"
              >
                {sortOrder === "ASC" ? "⬆️ Date: Start -> End" : "⬇️ Date: Newest First"}
              </button>
              {(fromDate || toDate || dateQuickFilter !== "ALL" || searchText || filterModality || filterStatus) && (
                <button
                  onClick={() => {
                    setDateQuickFilter("ALL");
                    setFromDate("");
                    setToDate("");
                    setSearchText("");
                    setFilterModality("");
                    setFilterStatus("");
                    setSortOrder("DESC");
                    setCurrentPage(1);
                    fetchData("", "", "ALL", "", "");
                  }}
                  className="rp-date-reset"
                  title="Reset filters"
                >
                  Reset
                </button>
              )}
            </div>

            {/* MOBILE FILTER ACCORDION TOGGLE BUTTON */}
            <button
              className="rp-mobile-filter-toggle"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              title="Toggle Advanced Filters"
            >
              <SlidersHorizontal size={14} />
              <span>Filters</span>
              {activeFilterCount > 0 && <span className="rp-filter-badge-count">{activeFilterCount}</span>}
            </button>
          </div>
        </div>

        {/* WORKLIST HIGH-DENSITY DATA TABLE */}
        <div className="rp-table-card">
          {loading ? (
            <div className="rp-loading">
              <RefreshCw size={26} className="animate-spin" />
              <span>Fetching latest PACS DICOM worklist records...</span>
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>Patient Name & ID</th>
                      <th>Modality</th>
                      <th>Study Description</th>
                      <th>Study Date & Time</th>
                      <th>Accession No</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWorklist.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="rp-empty">
                          No DICOM studies matched your search filters.
                        </td>
                      </tr>
                    ) : (
                      pagedWorklist.map((item, idx) => (
                        <tr key={item.study_uid || idx} className={`rp-table-row ${item.isSTAT ? 'row-stat' : ''}`}>
                          <td>
                            <div className="rp-patient-block">
                              <div className="rp-patient-main">
                                <span className="rp-patient-name">{formatPatientName(item.patient_name)}</span>
                                {item.isSTAT && (
                                  <span className="rp-stat-tag" title="Emergency STAT Scan">
                                    🚨 STAT
                                  </span>
                                )}
                              </div>
                              <span className="rp-patient-id">ID: {item.patient_id}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`rp-modality-badge mod-${item.modality.toLowerCase()}`}>
                              {item.modality}
                            </span>
                          </td>
                          <td>
                            <span className="rp-study-desc" title={item.study_description}>
                              {item.study_description}
                            </span>
                          </td>
                          <td>
                            <span className="rp-time-text">
                              {formatDisplayDateTime(item.study_date, item.study_time)}
                            </span>
                          </td>
                          <td>
                            <span className="rp-code-acc">{item.accession_number}</span>
                          </td>
                          <td>
                            {(() => {
                              const lock = activeLocks[item.study_uid];
                              if (lock) {
                                return (
                                  <span className="rp-status-badge status-reporting" style={{ background: '#f59e0b', color: '#ffffff', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: 11, boxShadow: '0 2px 6px rgba(245, 158, 11, 0.4)' }} title={`Currently being reported by ${lock.doctorName}`}>
                                    🔒 Reporting ({lock.doctorName || 'Dr.'})
                                  </span>
                                );
                              }
                              const st = String(item.status || "Unreported").toLowerCase();
                              let bg = '#64748b';
                              let label = item.status || "Unreported";
                              if (st === 'final') { bg = '#10b981'; label = '✓ Final'; }
                              else if (st === 'draft') { bg = '#0284c7'; label = '📝 Draft'; }
                              else if (st === 'unreported') { bg = '#64748b'; label = '⚪ Unreported'; }

                              return (
                                <span className={`rp-status-badge status-${st}`} style={{ background: bg, color: '#ffffff', fontWeight: 700, padding: '4px 8px', borderRadius: 6, fontSize: 11 }}>
                                  {label}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div className="rp-action-bar">
                              <button
                                onClick={() => setActiveWorkstationItem({ studyUID: item.study_uid, modality: item.modality })}
                                className="rp-btn-action workstation"
                                title="Launch Workstation"
                              >
                                <Zap size={13} /> Workstation
                              </button>

                              <button
                                onClick={() => openStudyViewer(item.study_uid)}
                                className="rp-btn-action ghost"
                                title="Open Full OHIF DICOM Viewer"
                              >
                                <Eye size={13} /> Viewer
                              </button>

                              <button
                                onClick={() => navigate(`/mobile-viewer?study=${encodeURIComponent(item.study_uid)}`)}
                                className="rp-btn-action ghost"
                                style={{ color: "#38bdf8", borderColor: "#0284c7" }}
                                title="Open Mobile DICOM Viewer"
                              >
                                <Smartphone size={13} /> Mobile
                              </button>

                              <button
                                onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(item.study_uid)}`)}
                                className="rp-btn-action primary"
                                title="Open Report Editor"
                              >
                                <FileText size={13} /> Report
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* DEDICATED MOBILE PATIENT CARDS VIEW */}
              <div className="rp-mobile-card-list">
                {pagedWorklist.length === 0 ? (
                  <div className="rp-empty">
                    No DICOM studies matched your search filters.
                  </div>
                ) : (
                  pagedWorklist.map((item, idx) => (
                    <div key={`rp-card-${item.study_uid || ''}-${idx}`} className={`rp-mobile-card ${item.isSTAT ? 'row-stat' : ''}`}>
                      <div className="rpmc-header">
                        <div>
                          <div className="rpmc-name-row">
                            <span className="rpmc-name">{formatPatientName(item.patient_name)}</span>
                            {item.isSTAT && <span className="rp-stat-tag">🚨 STAT</span>}
                          </div>
                          <span className="rpmc-sub">ID: {item.patient_id}</span>
                        </div>
                        <div className="rpmc-badges">
                          <span className={`rp-modality-badge mod-${item.modality.toLowerCase()}`}>
                            {item.modality}
                          </span>
                          <span className={`rp-status-badge status-${item.status.toLowerCase()}`}>
                            {item.status}
                          </span>
                        </div>
                      </div>

                      <div className="rpmc-grid">
                        <div className="rpmc-field">
                          <span className="rpmc-lbl">Exam</span>
                          <span className="rpmc-val">{item.study_description || "General Examination"}</span>
                        </div>
                        <div className="rpmc-field">
                          <span className="rpmc-lbl">Acc No</span>
                          <span className="rpmc-val code">{item.accession_number || "-"}</span>
                        </div>
                        <div className="rpmc-field" style={{ gridColumn: "span 2" }}>
                          <span className="rpmc-lbl">Date & Time</span>
                          <span className="rpmc-val">{formatDisplayDateTime(item.study_date, item.study_time)}</span>
                        </div>
                      </div>

                      <div className="rpmc-actions">
                        <button
                          onClick={() => navigate(`/mobile-viewer?study=${encodeURIComponent(item.study_uid)}`)}
                          className="rpmc-btn primary"
                          title="Open Portable Mobile DICOM Viewer"
                        >
                          <Smartphone size={14} /> Mobile Viewer
                        </button>

                        <button
                          onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(item.study_uid)}`)}
                          className="rpmc-btn secondary"
                          title="Open Radiology Report Studio"
                        >
                          <FileText size={14} /> Report
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* PAGINATION FOOTER */}
              {filteredWorklist.length > 0 && (
                <div className="rp-pagination">
                  <span className="rp-pag-info">
                    Showing <strong>{(currentPage - 1) * rowsPerPage + 1}</strong> -{" "}
                    <strong>{Math.min(currentPage * rowsPerPage, filteredWorklist.length)}</strong> of{" "}
                    <strong>{filteredWorklist.length}</strong> studies
                  </span>

                  <div className="rp-pag-controls">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="rp-pag-btn"
                    >
                      Prev
                    </button>
                    <span className="rp-pag-page">Page {currentPage} of {Math.ceil(filteredWorklist.length / rowsPerPage) || 1}</span>
                    <button
                      disabled={currentPage >= Math.ceil(filteredWorklist.length / rowsPerPage)}
                      onClick={() => setCurrentPage((p) => p + 1)}
                      className="rp-pag-btn"
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
