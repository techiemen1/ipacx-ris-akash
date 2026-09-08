import React, { useState, useEffect, useMemo } from "react";
import MainLayout from "../layout/MainLayout";
import api from "../api/axios";
import toast from "react-hot-toast";
import { openStudyViewer } from "../utils/viewerUtils";
import {
  Stethoscope,
  Download,
  Search,
  FileText,
  Eye,
  RefreshCw,
  UserCheck,
  Calendar,
  Filter,
  CheckCircle,
  Activity
} from "lucide-react";
import "./DoctorPortal.css";

const getInitials = (name) => {
  if (!name) return "P";
  const parts = String(name).replace(/\^/g, " ").trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

export default function DoctorPortal() {
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModality, setSelectedModality] = useState("ALL");
  const [referringDoctorFilter, setReferringDoctorFilter] = useState("ALL");
  const [referringDoctorsList, setReferringDoctorsList] = useState([]);

  const loadReferredStudies = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/referring-doctors/studies");
      const list = res.data?.studies || [];
      setStudies(list);

      // Extract unique referring doctors for filtering
      const docSet = new Set();
      list.forEach(item => {
        if (item.referring_doctor && item.referring_doctor.trim()) {
          docSet.add(item.referring_doctor.trim());
        }
      });
      setReferringDoctorsList(Array.from(docSet));
    } catch (err) {
      console.error("Failed to load referred studies:", err);
      toast.error("Failed to load referred studies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReferredStudies();
  }, []);

  const handleDownloadPDF = (reportId) => {
    if (!reportId) return;
    window.open(`/api/reports/${reportId}/pdf`, "_blank");
  };

  const filteredStudies = useMemo(() => {
    return studies.filter((s) => {
      const pName = String(s.patient_name || "").replace(/undefined|null/gi, "").trim().toLowerCase();
      const pId = String(s.patient_id || "").replace(/undefined|null/gi, "").trim().toLowerCase();
      const acc = String(s.accession_number || "").replace(/undefined|null/gi, "").trim().toLowerCase();
      const mod = (s.modality || "CR").toUpperCase().trim();
      const refDoc = String(s.referring_doctor || "").trim();

      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || pName.includes(q) || pId.includes(q) || acc.includes(q) || mod.toLowerCase().includes(q);
      const matchMod = selectedModality === "ALL" || mod === selectedModality || (selectedModality === "CR" && (mod === "XRAY" || mod === "DX" || mod === "XR"));
      const matchDoc = referringDoctorFilter === "ALL" || refDoc === referringDoctorFilter;

      return matchSearch && matchMod && matchDoc;
    });
  }, [studies, searchQuery, selectedModality, referringDoctorFilter]);

  const stats = useMemo(() => {
    const total = studies.length;
    const todayStr = new Date().toISOString().split("T")[0];
    const todayCount = studies.filter(s => (s.created_at || s.updated_at || "").startsWith(todayStr)).length;
    const ctCount = studies.filter(s => (s.modality || "").toUpperCase().includes("CT")).length;
    const mriCount = studies.filter(s => (s.modality || "").toUpperCase().includes("MR")).length;
    return { total, todayCount, ctCount, mriCount };
  }, [studies]);

  return (
    <MainLayout>
      <div className="dp-container">
        {/* HEADER HERO */}
        <header className="dp-header">
          <div className="dp-title-box">
            <div className="dp-icon-wrapper">
              <Stethoscope size={24} />
            </div>
            <div>
              <span className="dp-badge">Enterprise Physician Portal</span>
              <h1 className="dp-title">Referring Doctor Clinical Dashboard</h1>
              <p className="dp-subtitle">
                Access finalized diagnostic imaging reports, digital PDF sheets, and PACS DICOM series in real time.
              </p>
            </div>
          </div>

          <div className="dp-header-actions">
            <button onClick={loadReferredStudies} disabled={loading} className="dp-btn dp-btn-secondary">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Refresh Portal
            </button>
          </div>
        </header>

        {/* KPI STAT CARDS STRIP */}
        <div className="dp-stats-grid">
          <div className="dp-stat-card">
            <div className="dp-stat-icon indigo">
              <FileText size={20} />
            </div>
            <div>
              <div className="dp-stat-value">{stats.total}</div>
              <div className="dp-stat-label">Finalized Reports</div>
            </div>
          </div>

          <div className="dp-stat-card">
            <div className="dp-stat-icon emerald">
              <CheckCircle size={20} />
            </div>
            <div>
              <div className="dp-stat-value">{stats.todayCount}</div>
              <div className="dp-stat-label">Reported Today</div>
            </div>
          </div>

          <div className="dp-stat-card">
            <div className="dp-stat-icon sky">
              <Activity size={20} />
            </div>
            <div>
              <div className="dp-stat-value">{stats.ctCount}</div>
              <div className="dp-stat-label">CT Scans</div>
            </div>
          </div>

          <div className="dp-stat-card">
            <div className="dp-stat-icon purple">
              <UserCheck size={20} />
            </div>
            <div>
              <div className="dp-stat-value">{stats.mriCount}</div>
              <div className="dp-stat-label">MRI Studies</div>
            </div>
          </div>
        </div>

        {/* FILTER & SEARCH CARD */}
        <div className="dp-filter-card">
          <div className="dp-filter-row">
            {/* SEARCH INPUT */}
            <div className="dp-search-box">
              <Search size={16} className="dp-search-icon" />
              <input
                type="text"
                placeholder="Search by Patient Name, ID, Accession, or Modality..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="dp-search-input"
              />
            </div>

            {/* DOCTOR SELECTOR DROPDOWN */}
            {referringDoctorsList.length > 0 && (
              <div className="dp-dropdown-wrap">
                <Filter size={15} style={{ color: '#64748b' }} />
                <select
                  value={referringDoctorFilter}
                  onChange={(e) => setReferringDoctorFilter(e.target.value)}
                  className="dp-select-doctor"
                >
                  <option value="ALL">All Referring Doctors ({referringDoctorsList.length})</option>
                  {referringDoctorsList.map((doc, idx) => (
                    <option key={idx} value={doc}>{doc}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* MODALITY CHIPS STRIP */}
          <div className="dp-modality-chips">
            <span className="dp-chips-label">Modality Filter:</span>
            {["ALL", "CT", "MRI", "USG", "CR", "ECHO", "PT", "MG"].map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setSelectedModality(m)}
                className={`dp-chip ${selectedModality === m ? "active" : ""}`}
              >
                {m === "ALL" ? "🌐 All Modalities" : m === "CR" ? "🩻 X-Ray" : m === "USG" ? "🌊 USG" : m}
              </button>
            ))}
          </div>
        </div>

        {/* REFERRED STUDIES TABLE CARD */}
        <div className="dp-table-card">
          <div className="dp-table-header">
            <div className="dp-table-title">
              <FileText size={18} className="text-indigo-600" />
              <h2>Referred Diagnostic Studies</h2>
            </div>
            <span className="dp-counter-tag">{filteredStudies.length} Available Studies</span>
          </div>

          {loading ? (
            <div className="dp-loading-box">
              <RefreshCw size={28} className="animate-spin text-indigo-600" />
              <span>Fetching referred study records...</span>
            </div>
          ) : filteredStudies.length === 0 ? (
            <div className="dp-empty-box">
              <Stethoscope size={40} style={{ color: '#94a3b8', marginBottom: 12 }} />
              <h3>No Finalized Reports Found</h3>
              <p>No finalized diagnostic imaging reports were found matching the selected filter criteria.</p>
            </div>
          ) : (
            <div className="dp-table-responsive">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th>Patient Name</th>
                    <th>Patient ID / Acc</th>
                    <th>Modality</th>
                    <th>Study Description</th>
                    <th>Referring Doctor & Clinic</th>
                    <th>Report Date</th>
                    <th style={{ textAlign: 'center' }}>Diagnostic Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudies.map((s) => {
                    const mod = (s.modality || "CR").toUpperCase();
                    return (
                      <tr key={s.report_id || s.study_uid}>
                        <td>
                          <div className="dp-patient-cell">
                            <span className="dp-patient-name">{s.patient_name || "Patient"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="dp-code-group">
                            <span className="dp-code-main">{s.patient_id || "-"}</span>
                            <span className="dp-code-sub">Acc: {s.accession_number || "-"}</span>
                          </div>
                        </td>
                        <td>
                          <span className={`dp-mod-badge mod-${mod.toLowerCase()}`}>
                            {mod}
                          </span>
                        </td>
                        <td>
                          <div className="dp-desc-cell">
                            <strong>{s.study_description || s.body_part || "Radiology Examination"}</strong>
                            <span>{s.body_part || "Diagnostic Exam"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="dp-doctor-cell">
                            <strong className="dp-doctor-name">
                              👨‍⚕️ {s.referring_doctor || "Self / Desk"}
                            </strong>
                            <div className="dp-clinic-sub">
                              <span className="dp-clinic-badge">
                                🏥 {s.clinic_name || "Main Diagnostic Center"}
                              </span>
                              {s.hospital_name && s.hospital_name !== s.clinic_name && (
                                <span className="dp-hospital-badge">
                                  🏛️ {s.hospital_name}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="dp-date-cell">
                            {s.updated_at ? new Date(s.updated_at).toLocaleDateString("en-IN") : s.created_at ? new Date(s.created_at).toLocaleDateString("en-IN") : "-"}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="dp-action-group">
                            <button
                              onClick={() => handleDownloadPDF(s.report_id)}
                              className="dp-action-btn pdf"
                              title="View Official Signed PDF Report"
                            >
                              <Download size={13} /> PDF Report
                            </button>

                            <button
                              onClick={() => openStudyViewer(s.study_uid)}
                              className="dp-action-btn dicom"
                              title="Open DICOM Series in OHIF Viewer"
                            >
                              <Eye size={13} /> OHIF Viewer
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
