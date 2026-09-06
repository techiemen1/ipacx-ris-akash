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
  Calendar,
  Share2
} from "lucide-react";

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
  const clean = name.replace(/undefined|null/gi, "").trim();
  if (!clean) return "PT";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
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

  const [currentPage, setCurrentPage] = useState(1);
  const [activeWorkstationItem, setActiveWorkstationItem] = useState(null);
  const [shareItem, setShareItem] = useState(null);
  const rowsPerPage = 12;

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

      worklist.push({
        study_uid: uid,
        patient_name: pName,
        patient_id: String(s.PatientID || s.patient_id || existingReport?.patient_id || "-").replace(/undefined|null/gi, "-"),
        accession_number: String(s.AccessionNumber || s.accession_number || existingReport?.accession_number || "-").replace(/undefined|null/gi, "-"),
        modality: parseModality(s) || parseModality(existingReport) || "CR",
        study_description: s.StudyDescription || "General Examination",
        study_date: s.StudyDate || s.study_date || existingReport?.created_at?.split("T")[0] || "-",
        study_time: s.StudyTime || s.study_time || "",
        raw_timestamp: rawTs,
        status: existingReport?.status || "Unreported",
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
      const matchStatus = !filterStatus || item.status === filterStatus;

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
    return { total, unreported, draft, final };
  }, [mergedWorklist]);

  return (
    <MainLayout>
      <div className="rp-container">
        {/* HEADER BAR */}
        <header className="rp-header">
          <div className="rp-title-section">
            <span className="rp-tag">Radiology Information System | Worklist Engine</span>
            <h1 className="rp-title">Reporting Hub & Worklist</h1>
          </div>

          <div className="rp-header-actions">
            <button onClick={fetchData} className="rp-btn secondary" disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Sync Worklist
            </button>
          </div>
        </header>

        {/* 4-COLUMN KPI CARDS GRID */}
        <div className="rp-stats-grid">
          <div className="rp-stat-card">
            <div className="stat-icon total"><FileText size={20} /></div>
            <div className="stat-info">
              <span className="stat-label">Total Studies</span>
              <span className="stat-value">{stats.total}</span>
            </div>
          </div>

          <div className="rp-stat-card">
            <div className="stat-icon warning"><Clock size={20} /></div>
            <div className="stat-info">
              <span className="stat-label">Unreported</span>
              <span className="stat-value">{stats.unreported}</span>
            </div>
          </div>

          <div className="rp-stat-card">
            <div className="stat-icon info"><FileCheck size={20} /></div>
            <div className="stat-info">
              <span className="stat-label">Draft Reports</span>
              <span className="stat-value">{stats.draft}</span>
            </div>
          </div>

          <div className="rp-stat-card">
            <div className="stat-icon success"><CheckCircle size={20} /></div>
            <div className="stat-info">
              <span className="stat-label">Final Reports</span>
              <span className="stat-value">{stats.final}</span>
            </div>
          </div>
        </div>

        {/* SEARCH & ADVANCED DATE RANGE FILTER CARD */}
        <div className="rp-card">
          <div className="rp-filter-grid">
            <div className="rp-search-box">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search patient, MRN, accession..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>

            <select
              value={filterModality}
              onChange={(e) => setFilterModality(e.target.value)}
              className="rp-select"
            >
              <option value="">All Modalities</option>
              <option value="CR">CR / DX (X-Ray)</option>
              <option value="CT">CT Scan</option>
              <option value="MR">MR (MRI)</option>
              <option value="US">US (Ultrasound)</option>
              <option value="MG">MG (Mammography)</option>
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rp-select"
            >
              <option value="">All Statuses</option>
              <option value="Unreported">Unreported</option>
              <option value="Draft">Draft</option>
              <option value="Final">Final</option>
            </select>
          </div>

          {/* DAY / DATE & FROM-TO DATE RANGE FILTER STRIP */}
          <div className="rp-date-filter-strip">
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

        {/* WORKLIST TABLE CARD */}
        <div className="rp-card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div className="rp-loading">
              <RefreshCw size={28} className="animate-spin" />
              <span>Fetching worklist records & latest studies...</span>
            </div>
          ) : (
            <>
              <div className="table-responsive">
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>Patient Name</th>
                      <th>Patient ID / MRN</th>
                      <th>Modality</th>
                      <th>Study Description</th>
                      <th>Study Date & Time</th>
                      <th>Accession</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedWorklist.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="rp-empty">
                          No matching worklist studies found for the selected date range and criteria.
                        </td>
                      </tr>
                    ) : (
                      pagedWorklist.map((item, idx) => (
                        <tr key={item.study_uid || idx} className={`rp-row-modality mod-row-${item.modality.toLowerCase()}`}>
                          <td>
                            <div className="rp-patient-cell">
                              <div className={`rp-avatar mod-avatar-${item.modality.toLowerCase()}`}>{getInitials(item.patient_name)}</div>
                              <span className="rp-patient-name">{item.patient_name}</span>
                            </div>
                          </td>
                          <td><span className="rp-code">{item.patient_id}</span></td>
                          <td>
                            <span className={`rp-badge-modality mod-${item.modality.toLowerCase()}`}>
                              {item.modality}
                            </span>
                          </td>
                          <td>{item.study_description}</td>
                          <td style={{ fontWeight: 600, color: "#0f172a" }}>
                            {formatDisplayDateTime(item.study_date, item.study_time)}
                          </td>
                          <td><span className="rp-code">{item.accession_number}</span></td>
                          <td>
                            <span className={`rp-status-badge status-${item.status.toLowerCase()}`}>
                              {item.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <div className="rp-action-btn-group">
                              <button
                                onClick={() => setActiveWorkstationItem({ studyUID: item.study_uid, modality: item.modality })}
                                className="rp-action-btn indigo"
                                title="Launch Full-Screen Flash Split Workstation"
                              >
                                <Zap size={13} /> Split
                              </button>

                              <button
                                onClick={() => openStudyViewer(item.study_uid)}
                                className="rp-action-btn secondary"
                                title="Open in OHIF DICOM Viewer"
                              >
                                <Eye size={13} /> OHIF
                              </button>

                              <button
                                onClick={() => navigate(`/report-editor?study_uid=${encodeURIComponent(item.study_uid)}`)}
                                className="rp-action-btn primary"
                                title="Report Editor"
                              >
                                <FileText size={13} /> Report
                              </button>

                              <button
                                onClick={() => setShareItem(item)}
                                className="rp-action-btn"
                                style={{ background: "#4f46e5", color: "#ffffff" }}
                                title="Share 7-Day DICOM Viewer & PDF Report"
                              >
                                <Share2 size={13} /> Share
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION */}
              {filteredWorklist.length > rowsPerPage && (
                <div className="rp-pagination">
                  <span>
                    Showing {(currentPage - 1) * rowsPerPage + 1} -{" "}
                    {Math.min(currentPage * rowsPerPage, filteredWorklist.length)} of {filteredWorklist.length} records
                  </span>

                  <div className="pagination-buttons">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>
                    <span>Page {currentPage} of {Math.ceil(filteredWorklist.length / rowsPerPage)}</span>
                    <button
                      disabled={currentPage >= Math.ceil(filteredWorklist.length / rowsPerPage)}
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

        {/* VENDOR-GRADE PATIENT & PHYSICIAN SHARE MODAL */}
        <ShareReportModal
          isOpen={Boolean(shareItem)}
          onClose={() => setShareItem(null)}
          studyUID={shareItem?.study_uid}
          patientID={shareItem?.patient_id}
          patientName={shareItem?.patient_name}
          accessionNumber={shareItem?.accession_number}
          reportID={shareItem?.id}
        />
      </div>
    </MainLayout>
  );
}
