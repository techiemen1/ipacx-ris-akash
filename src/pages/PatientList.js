import React, { useState, useEffect, useMemo } from "react";
import { CalendarDays, SquarePen, Printer, Receipt, Trash2, RefreshCw, Plus, Search, Users, Activity, Clock, ShieldCheck, Share2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../layout/MainLayout";

import PatientRegistration from "./PatientRegistration";
import ShareReportModal from "../components/ShareReportModal";
import api from "../api/axios";
import { toast } from "react-hot-toast";
import "./PatientList.css";

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

  const timestamp = new Date(s).getTime();
  return isNaN(timestamp) ? 0 : timestamp;
}

function getPatientTimestamp(p) {
  if (p?.study_date) {
    return parseDicomDateTime(p.study_date, p.study_time);
  }
  if (p?.created_at) {
    const t = new Date(p.created_at).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

function formatDisplayDateTime(dateStr, timeStr) {
  if (!dateStr) return "-";
  const s = String(dateStr).trim();

  if (/^\d{8}$/.test(s)) {
    const yyyy = s.slice(0, 4);
    const mm = s.slice(4, 6);
    const dd = s.slice(6, 8);
    let timeFormatted = "";
    if (timeStr && String(timeStr).trim().length >= 4) {
      const ts = String(timeStr).trim();
      let hh = parseInt(ts.slice(0, 2), 10);
      const mi = ts.slice(2, 4);
      const ampm = hh >= 12 ? "PM" : "AM";
      hh = hh % 12 || 12;
      timeFormatted = ` ${hh}:${mi} ${ampm}`;
    }
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthName = months[parseInt(mm, 10) - 1] || mm;
    return `${monthName} ${parseInt(dd, 10)}, ${yyyy}${timeFormatted}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  return s;
}

const getInitials = (name) => {
  if (!name) return "P";
  const parts = String(name).replace(/\^/g, " ").trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

function PatientList() {
  const [showForm, setShowForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState(null);
  const [shareModalPatient, setShareModalPatient] = useState(null);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scheduledPatientIds, setScheduledPatientIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedModality, setSelectedModality] = useState("ALL");

  const [dateQuickFilter, setDateQuickFilter] = useState("ALL");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const navigate = useNavigate();

  useEffect(() => {
    loadPatients();
    loadScheduledPatientIds();
  }, []);

  useEffect(() => {
    const onFocus = () => loadScheduledPatientIds();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const getPatientScheduleKey = (patient) =>
    String(patient?.uhid || patient?.patient_id || patient?.mrn || "");

  const loadScheduledPatientIds = () => {
    api
      .get("/api/appointments/scheduled-ids")
      .then((res) => {
        const ids = Array.isArray(res?.data?.ids) ? res.data.ids : [];
        setScheduledPatientIds(ids.map(String));
      })
      .catch(() => setScheduledPatientIds([]));
  };

  const loadPatients = async () => {
    setLoading(true);
    try {
      try {
        const appRes = await api.get("/api/appointments/scheduled-ids");
        if (appRes.data?.success && Array.isArray(appRes.data.scheduled_patient_ids)) {
          setScheduledPatientIds(appRes.data.scheduled_patient_ids.map(String));
        }
      } catch (e) {
        console.warn("Could not fetch scheduled IDs:", e.message);
      }

      const res = await api.get("/api/patients");
      const dbPatients = Array.isArray(res.data)
        ? res.data
        : (res.data && Array.isArray(res.data.patients) ? res.data.patients : []);

      let pacsStudies = [];
      try {
        const pRes = await api.get("/api/pacs/studies");
        if (Array.isArray(pRes.data)) pacsStudies = pRes.data;
      } catch (pErr) {
        console.warn("Could not fetch PACS studies for PatientList:", pErr.message);
      }

      const combinedMap = new Map();

      dbPatients.forEach((p) => {
        const key = String(p.uhid || p.patient_id || p.mrn || p.id).toUpperCase().trim();
        if (key) combinedMap.set(key, { ...p, _source: "DB" });
      });

      pacsStudies.forEach((ps) => {
        const key = String(ps.patient_id || ps.patientId || "").toUpperCase().trim();
        if (key) {
          if (combinedMap.has(key)) {
            const existing = combinedMap.get(key);
            combinedMap.set(key, {
              ...existing,
              modality: existing.modality || ps.modality || ps.modalitiesInStudy,
              study_date: existing.study_date || ps.study_date || ps.studyDate,
              study_time: existing.study_time || ps.study_time || ps.studyTime,
              study_type: existing.study_type || ps.study_description || ps.studyDescription,
              referring_doctor: existing.referring_doctor || ps.referring_physician_name || "PACS Direct",
              _hasPACS: true,
            });
          } else {
            combinedMap.set(key, {
              id: key,
              uhid: key,
              patient_id: key,
              first_name: ps.patient_name || ps.patientName || "PACS Patient",
              gender: ps.patient_sex || ps.patientSex || "O",
              modality: ps.modality || ps.modalitiesInStudy || "CR",
              study_date: ps.study_date || ps.studyDate,
              study_time: ps.study_time || ps.studyTime,
              study_type: ps.study_description || ps.studyDescription || "Imaging Study",
              referring_doctor: ps.referring_physician_name || "PACS Direct",
              visit_type: "DICOM Study",
              _source: "PACS",
              _hasPACS: true,
            });
          }
        }
      });

      const merged = Array.from(combinedMap.values());
      merged.sort((a, b) => getPatientTimestamp(b) - getPatientTimestamp(a));
      setPatients(merged);
    } catch (err) {
      console.error("Failed to load patients:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredPatients = useMemo(() => {
    let result = patients;

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter((p) => {
        const name = `${p.first_name || ""} ${p.last_name || ""} ${p.full_name || ""} ${p.patient_name || ""}`.toLowerCase();
        const idStr = `${p.uhid || ""} ${p.patient_id || ""} ${p.mrn || ""}`.toLowerCase();
        const phone = String(p.phone || p.mobile || "").toLowerCase();
        const doc = String(p.referring_doctor || "").toLowerCase();
        return name.includes(q) || idStr.includes(q) || phone.includes(q) || doc.includes(q);
      });
    }

    if (selectedModality !== "ALL") {
      result = result.filter((p) => {
        const mod = String(p.modality || (Array.isArray(p.modalities) ? p.modalities.join(",") : "")).toUpperCase();
        return mod.includes(selectedModality);
      });
    }

    if (dateQuickFilter !== "ALL" || fromDate || toDate) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      result = result.filter((p) => {
        const ts = getPatientTimestamp(p);
        if (!ts) return dateQuickFilter === "ALL" && !fromDate && !toDate;

        if (dateQuickFilter === "TODAY") {
          return ts >= todayStart;
        } else if (dateQuickFilter === "YESTERDAY") {
          const yestStart = todayStart - 86400000;
          return ts >= yestStart && ts < todayStart;
        } else if (dateQuickFilter === "7DAYS") {
          return ts >= todayStart - 7 * 86400000;
        } else if (dateQuickFilter === "30DAYS") {
          return ts >= todayStart - 30 * 86400000;
        }

        if (fromDate || toDate) {
          let valid = true;
          if (fromDate) {
            const fTs = new Date(fromDate).getTime();
            if (ts < fTs) valid = false;
          }
          if (toDate) {
            const tTs = new Date(toDate).getTime() + 86399999;
            if (ts > tTs) valid = false;
          }
          return valid;
        }

        return true;
      });
    }

    return result;
  }, [patients, searchTerm, selectedModality, dateQuickFilter, fromDate, toDate]);

  const buildPatientPayload = (data) => {
    const payload = new FormData();
    Object.keys(data).forEach((key) => {
      if (key === "modalities" && Array.isArray(data[key])) {
        payload.append(key, JSON.stringify(data[key]));
      } else if (key === "government_id_file" || key === "photo") {
        if (data[key] instanceof File) {
          payload.append(key, data[key]);
        }
      } else if (data[key] !== null && data[key] !== undefined) {
        payload.append(key, data[key]);
      }
    });
    return payload;
  };

  const handleAddPatient = async (formData) => {
    const payload = buildPatientPayload(formData);
    const response = await api.post("/api/patients", payload, {
      headers: { "Content-Type": undefined },
    });
    const newPatient = response?.data?.patient;
    if (newPatient) {
      setPatients((prev) => [newPatient, ...prev]);
    }
    setShowForm(false);
    loadPatients();
    return newPatient;
  };

  const handleEditPatient = async (formData) => {
    if (!editingPatient) return null;
    const payload = buildPatientPayload(formData);
    const identifier = editingPatient.uhid || editingPatient.patient_id || editingPatient.mrn || editingPatient.id;
    const response = await api.put(`/api/patients/${encodeURIComponent(identifier)}`, payload, {
      headers: { "Content-Type": undefined },
    });
    const updatedPatient = response?.data?.patient;
    setPatients((prev) =>
      prev.map((p) =>
        (p.uhid || p.patient_id || p.mrn || p.id) === (editingPatient.uhid || editingPatient.patient_id || editingPatient.mrn || editingPatient.id)
          ? (updatedPatient || p)
          : p
      )
    );
    setEditingPatient(null);
    loadPatients();
    return updatedPatient;
  };

  const handleSchedule = (patient) => {
    navigate("/scheduling", { state: { patient } });
  };

  const handlePrint = async (patient) => {
    const identifier = patient?.uhid || patient?.patient_id || patient?.mrn || patient?.id;
    if (!identifier) return;
    try {
      toast.loading("Generating patient slip PDF...", { id: "print-pdf" });
      const { data } = await api.get(`/api/patients/print/${encodeURIComponent(identifier)}`, {
        responseType: "blob",
      });
      toast.dismiss("print-pdf");
      const blobUrl = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      toast.dismiss("print-pdf");
      console.error("Failed to print patient slip:", err);
      toast.error("Failed to generate print PDF.");
    }
  };

  const handlePrintInvoice = async (patient) => {
    const identifier = patient?.uhid || patient?.patient_id || patient?.mrn || patient?.id;
    if (!identifier) return;
    try {
      toast.loading("Generating billing receipt PDF...", { id: "print-inv" });
      const { data } = await api.get(`/api/billing/print/${encodeURIComponent(identifier)}`, {
        responseType: "blob",
      });
      toast.dismiss("print-inv");
      const blobUrl = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
      window.open(blobUrl, "_blank");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      toast.dismiss("print-inv");
      console.error("Failed to print invoice:", err);
      toast.error("Failed to generate billing receipt PDF.");
    }
  };

  const handleEdit = async (patient) => {
    try {
      const identifier = patient?.uhid || patient?.patient_id || patient?.mrn || patient?.id;
      if (!identifier) {
        setEditingPatient(patient);
        return;
      }
      const res = await api.get(`/api/patients/${encodeURIComponent(identifier)}`);
      const fullPatient = res?.data?.patient || patient;
      setEditingPatient(fullPatient);
    } catch (err) {
      console.error("Failed to fetch full patient for edit:", err);
      setEditingPatient(patient);
    }
  };

  const handleDelete = async (patient) => {
    const identifier = patient?.uhid || patient?.patient_id;
    if (!identifier) return;

    const confirmDelete = window.confirm(`Are you sure you want to delete patient ${identifier}?`);
    if (!confirmDelete) return;

    try {
      await api.delete(`/api/patients/${encodeURIComponent(identifier)}`);
      setPatients((prev) => prev.filter((p) => (p.uhid || p.patient_id) !== identifier));
      toast.success("Patient record deleted");
    } catch (err) {
      console.error("Failed to delete patient:", err);
      toast.error("Failed to delete patient.");
    }
  };

  return (
    <MainLayout>
      <div className="patient-page">
        {/* HEADER HERO BAR */}
        <header className="patient-header">
          <div className="pl-title-box">
            <div className="pl-icon-wrapper">
              <Users size={24} />
            </div>
            <div>
              <span className="pl-badge">Enterprise Master Patient Index (MPI)</span>
              <h1 className="pl-title">Patient Directory & Diagnostic Cases</h1>
              <p className="pl-subtitle">
                Browse master patient index, filter by Date Range / Modality, generate patient slips, billing receipts, and dispatch appointments.
              </p>
            </div>
          </div>

          <div className="pl-header-actions">
            <span className="pl-counter-tag">
              {filteredPatients.length} Active Records
            </span>
            <button
              className="pl-refresh-btn"
              onClick={loadPatients}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {loading ? "Syncing..." : "Refresh"}
            </button>
            <button
              className="add-patient-btn"
              onClick={() => setShowForm(true)}
            >
              <Plus size={16} /> Register Patient
            </button>
          </div>
        </header>

        {/* KPI SUMMARY STATS STRIP */}
        <div className="pl-stats-grid">
          <div className="pl-stat-card">
            <div className="pl-stat-icon indigo">
              <Users size={20} />
            </div>
            <div>
              <div className="pl-stat-value">{patients.length}</div>
              <div className="pl-stat-label">Total Registered MPI</div>
            </div>
          </div>

          <div className="pl-stat-card">
            <div className="pl-stat-icon emerald">
              <Clock size={20} />
            </div>
            <div>
              <div className="pl-stat-value">{filteredPatients.length}</div>
              <div className="pl-stat-label">Filtered Results</div>
            </div>
          </div>

          <div className="pl-stat-card">
            <div className="pl-stat-icon purple">
              <Activity size={20} />
            </div>
            <div>
              <div className="pl-stat-value">Active</div>
              <div className="pl-stat-label">PACS & DB Sync</div>
            </div>
          </div>

          <div className="pl-stat-card">
            <div className="pl-stat-icon sky">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="pl-stat-value">RBAC Isolated</div>
              <div className="pl-stat-label">Multi-Clinic Security</div>
            </div>
          </div>
        </div>

        {/* SEARCH & ADVANCED DATE RANGE FILTER TOOLBAR */}
        <div className="pl-filter-card">
          <div className="pl-filter-row">
            <div className="pl-search-box">
              <Search size={16} className="pl-search-icon" />
              <input
                type="text"
                className="pl-search-input"
                placeholder="Search by MRN / UHID, Patient Name, Mobile, Doctor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="pl-modality-select"
              value={selectedModality}
              onChange={(e) => setSelectedModality(e.target.value)}
            >
              <option value="ALL">🌐 All Modalities</option>
              <option value="CT">📡 CT Scan</option>
              <option value="MR">🧠 MRI Scan</option>
              <option value="US">🌊 Ultrasound (USG)</option>
              <option value="CR">🩻 X-Ray (CR/DX)</option>
              <option value="OPG">🦷 OPG Dental</option>
              <option value="MG">🎀 Mammography</option>
            </select>
          </div>

          <div className="pl-date-bar">
            <div className="pl-quick-dates">
              <span className="pl-quick-label">📅 Quick Date:</span>
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
                  className={`pl-quick-btn ${dateQuickFilter === quickKey ? "active" : ""}`}
                >
                  {quickKey === "ALL" ? "All Time" : quickKey === "TODAY" ? "Today" : quickKey === "YESTERDAY" ? "Yesterday" : quickKey === "7DAYS" ? "Last 7 Days" : "Last 30 Days"}
                </button>
              ))}
            </div>

            <div className="pl-custom-dates">
              <div className="pl-date-field">
                <label>From:</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setDateQuickFilter("CUSTOM");
                  }}
                />
              </div>

              <div className="pl-date-field">
                <label>To:</label>
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
                  className="pl-quick-btn"
                  style={{ color: '#ef4444', borderColor: '#fca5a5' }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Modal for Patient Registration */}
        {(showForm || editingPatient) && (
          <div className="modal-overlay">
            <div className="modal-content">
              <PatientRegistration
                onClose={() => {
                  setShowForm(false);
                  setEditingPatient(null);
                }}
                onSave={editingPatient ? handleEditPatient : handleAddPatient}
                initialData={editingPatient}
              />
            </div>
          </div>
        )}

        {/* PATIENT DIRECTORY TABLE CARD */}
        {loading ? (
          <div className="loading-text">
            <Activity size={28} className="animate-spin text-indigo-600 inline-block mb-2" /><br />
            Synchronizing Patient Directory & PACS Database...
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="patient-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>MRN / Patient ID</th>
                  <th>Patient Name</th>
                  <th>Gender</th>
                  <th>DOB / Age</th>
                  <th>Registration / Study Date</th>
                  <th>Referring Doctor</th>
                  <th>Visit Type</th>
                  <th>Modality</th>
                  <th>Study Description</th>
                  <th>Status</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPatients.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="no-data">
                      No matching patient records found for the selected date range and filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredPatients.map((p, idx) => (
                    <tr key={p.uhid || p.patient_id || idx}>
                      <td>{idx + 1}</td>
                      <td>
                        <span className="pl-mrn-badge">{p.uhid || p.patient_id}</span>
                      </td>
                      <td>
                        <div className="pl-patient-cell">
                          <div className="pl-avatar">
                            {getInitials(
                              `${p.first_name || ""} ${p.last_name || ""}`.trim() || p.patient_name
                            )}
                          </div>
                          <span className="pl-patient-name">
                            {`${p.first_name || ""} ${p.last_name || ""}`.trim() ||
                              p.full_name ||
                              p.patient_name ||
                              p.name ||
                              "-"}
                          </span>
                        </div>
                      </td>
                      <td>{p.gender || "O"}</td>
                      <td>
                        {(() => {
                          if (p?.age) return p.age;
                          if (!p?.dob) return "-";
                          const d = new Date(p.dob);
                          return isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
                        })()}
                      </td>

                      <td style={{ fontWeight: 600, color: "#0f172a" }}>
                        {formatDisplayDateTime(p.created_at || p.study_date, p.study_time)}
                      </td>

                      <td>{p.referring_doctor || "-"}</td>
                      <td>{p.visit_type || "-"}</td>
                      <td>
                        <span className={`pl-mod-badge mod-${(p.modality || "cr").toLowerCase()}`}>
                          {p.modality || (Array.isArray(p.modalities) ? p.modalities.join(", ") : "-")}
                        </span>
                      </td>
                      <td>{p.study_type || p.indication_for_scan || "-"}</td>
                      <td>
                        <div className="status-grid">
                          <span className={`status-badge ${p.billing_status === 'PAID' ? 'billing-paid' : p.billing_status ? 'billing-pending' : 'status-na'}`} title="Billing Status">
                            {p.billing_status || "No Bill"}
                          </span>
                          <span className={`status-badge ${p.report_status === 'Final' ? 'report-final' : p.report_status === 'Draft' ? 'report-draft' : 'status-na'}`} title="Report Status">
                            {p.report_status || "No Report"}
                          </span>
                        </div>
                      </td>
                      <td>
                        {(() => {
                          const scheduleKey = getPatientScheduleKey(p);
                          const isScheduled = scheduleKey && scheduledPatientIds.includes(scheduleKey);
                          return (
                            <div className="action-wrap">
                              <button
                                className={`schedule-btn ${isScheduled ? "scheduled" : "not-scheduled"}`}
                                onClick={() => handleSchedule(p)}
                                title={isScheduled ? "Scheduled" : "Schedule"}
                                aria-label={isScheduled ? "Scheduled" : "Schedule"}
                              ><CalendarDays size={14} /></button>
                              <button
                                className="schedule-btn edit-action"
                                onClick={() => handleEdit(p)}
                                title="Edit Record"
                                aria-label="Edit Record"
                              ><SquarePen size={14} /></button>
                              <button
                                className="schedule-btn print-action"
                                onClick={() => handlePrint(p)}
                                title="Print Patient Slip PDF"
                                aria-label="Print Patient Slip PDF"
                              ><Printer size={14} /></button>
                              <button
                                className="schedule-btn inv-action"
                                onClick={() => handlePrintInvoice(p)}
                                title="Print Billing Receipt PDF"
                                aria-label="Print Billing Receipt PDF"
                              ><Receipt size={14} /></button>
                              <button
                                className="schedule-btn delete-action"
                                onClick={() => handleDelete(p)}
                                title="Delete Record"
                                aria-label="Delete Record"
                              ><Trash2 size={14} /></button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

export default PatientList;
