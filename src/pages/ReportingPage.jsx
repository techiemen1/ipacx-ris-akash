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

function parseModality(item) {
  const raw = item?.modality || item?.Modality || item?.ModalitiesInStudy || item?.modality_in_study || "";
  const str = String(raw).toUpperCase().replace(/UNDEFINED|NULL/g, "").trim();

  if (str && str !== "N/A") {
    if (["CR", "DX", "XR", "CT", "MR", "MRI", "US", "USG", "MG", "EC", "ECHO"].includes(str)) {
      if (str === "MRI") return "MR";
      if (str === "USG") return "US";
      if (str === "ECHO") return "EC";
      return str;
    }
  }

  const desc = String(item?.study_description || item?.StudyDescription || "").toUpperCase();
  if (desc.includes("X-RAY") || desc.includes("XRAY") || desc.includes("CHEST PA") || desc.includes("RADIOGRAPH") || desc.includes("XR") || desc.includes("CR") || desc.includes("DX")) return "CR";
  if (desc.includes("MRI") || desc.includes("MR")) return "MR";
  if (desc.includes("USG") || desc.includes("ULTRASOUND") || desc.includes("US")) return "US";
  if (desc.includes("CT") || desc.includes("TOMOGRAPHY")) return "CT";

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

  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeWorkstationItem, setActiveWorkstationItem] = useState(null);
  const [shareItem, setShareItem] = useState(null);
  const rowsPerPage = 30;

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterModality) count++;
    if (filterStatus) count++;
    if (dateQuickFilter !== "ALL") count++;
    if (fromDate || toDate) count++;
    return count;
  }, [filterModality, filterStatus, dateQuickFilter, fromDate, toDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: reportsData } = await api.get("/api/reports").catch(() => ({ data: [] }));
      const reportsList = Array.isArray(reportsData) ? reportsData : [];
      setReports(reportsList);

      const savedPacs = sessionStorage.getItem("activePacs");
      const pacsObj = savedPacs ? JSON.parse(savedPacs) : null;
      const pacsId = pacsObj?.id || 1;

      const { data: studiesData } = await api.get("/api/pacs/studies", { params: { pacs_id: pacsId } }).catch(() => ({ data: [] }));
      const studiesList = Array.isArray(studiesData) ? studiesData : [];
      setStudies(studiesList);
    } catch (err) {
      console.error("Failed to load worklist data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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
      const matchSearch =
        !searchText ||
        item.patient_name.toLowerCase().includes(searchText.toLowerCase()) ||
        item.patient_id.toLowerCase().includes(searchText.toLowerCase()) ||
        item.accession_number.toLowerCase().includes(searchText.toLowerCase());

      const matchModality = !filterModality || item.modality === filterModality;
      const matchStatus = !filterStatus ? true : filterStatus === "STAT" ? item.isSTAT : item.status === filterStatus;

      let matchDate = true;
      const recordTs = item.raw_timestamp || parseDicomDateTime(item.study_date, item.study_time);

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

      return matchSearch && matchModality && matchStatus && matchDate;
    });
  }, [mergedWorklist, searchText, filterModality, filterStatus, dateQuickFilter, fromDate, toDate]);

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

        {/* UNIFIED SEARCH & HIGH-DENSITY FILTER CONTROL BAR */}
        <div className="rp-filter-bar">
          <div className="rp-filter-row-primary">
            {/* SEARCH BOX */}
            <div className="rp-search-box">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search by Patient Name, ID/MRN, Accession No..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setCurrentPage(1);
                }}
              />
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

          <div className={`rp-filter-controls-group ${showMobileFilters ? "show-mobile" : ""}`}>
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

            {/* QUICK DATE PILLS */}
            <div className="rp-date-pills">
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
                  className={`rp-date-pill ${dateQuickFilter === quickKey ? "active" : ""}`}
                >
                  {quickKey === "ALL" ? "All Time" : quickKey === "TODAY" ? "Today" : quickKey === "YESTERDAY" ? "Yesterday" : quickKey === "7DAYS" ? "7 Days" : "30 Days"}
                </button>
              ))}
            </div>

            {/* FROM - TO DATE INPUTS */}
            <div className="rp-date-range">
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
              <span className="rp-date-sep">to</span>
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
                  className="rp-date-reset"
                  title="Reset date filter"
                >
                  Reset
                </button>
              )}
            </div>
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
                            <span className={`rp-status-badge status-${item.status.toLowerCase()}`}>
                              {item.status}
                            </span>
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
                                onClick={() => navigate(`/native-viewer?study=${encodeURIComponent(item.study_uid)}`)}
                                className="rp-btn-action ghost"
                                style={{ color: "#a855f7", borderColor: "#9333ea" }}
                                title="Open Ultra-Fast Native Canvas DICOM Viewer (<20ms)"
                              >
                                <Compass size={13} /> Canvas
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
                    <div key={item.study_uid || idx} className={`rp-mobile-card ${item.isSTAT ? 'row-stat' : ''}`}>
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
                        >
                          <Smartphone size={15} /> Mobile Viewer
                        </button>

                        <button
                          onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(item.study_uid)}`)}
                          className="rpmc-btn secondary"
                        >
                          <FileText size={15} /> Report
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
