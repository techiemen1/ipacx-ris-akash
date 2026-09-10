import React, { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import AddScheduler from "./AddScheduler";
import api from "../api/axios";
import toast from "react-hot-toast";
import {
  Calendar,
  Clock,
  Plus,
  Search,
  Edit3,
  Trash2,
  Send,
  Activity,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  HardDrive
} from "lucide-react";
import "./Scheduling.css";

const getInitials = (name) => {
  if (!name) return "P";
  const parts = String(name).replace(/\^/g, " ").trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

export default function Scheduling() {
  const toLocalISODate = (d = new Date()) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const location = useLocation();
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showForm, setShowForm] = useState(false);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [prefillData, setPrefillData] = useState(null);
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModality, setSelectedModality] = useState("ALL");

  const loadAppointmentsByDate = async (dateObj) => {
    setLoading(true);
    try {
      const date = toLocalISODate(dateObj);
      const res = await api.get("/api/appointments", { params: { date } });
      const rows = Array.isArray(res.data) ? res.data : res?.data?.appointments || [];
      setAppointments(rows);
    } catch (err) {
      console.error("Failed to load appointments:", err);
      toast.error("Failed to load appointments");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppointmentsByDate(currentDate);
  }, [currentDate]);

  useEffect(() => {
    const patient = location.state?.patient;
    if (!patient) return;

    const normalizeModality = (value) => {
      const raw = String(value || "").trim().toUpperCase();
      const modalityMap = {
        USG: "Ultrasound",
        "X-RAY": "X-Ray",
        XRAY: "X-Ray",
        MR: "MRI",
        XA: "XA (Angiography)",
      };
      return modalityMap[raw] || (value || "");
    };

    const patientName =
      `${patient.first_name || ""} ${patient.last_name || ""}`.trim() ||
      patient.full_name ||
      patient.patient_name ||
      patient.name ||
      "";
    const patientId = patient.uhid || patient.patient_id || patient.mrn || "";
    const todayStr = toLocalISODate(new Date());

    setPrefillData({
      patientId: String(patientId),
      patientName,
      contact: patient.mobile || patient.phone || "",
      modality: normalizeModality(patient.modality),
      doctor: patient.referring_doctor || patient.attending_physician || "",
      date: todayStr,
    });
    setShowForm(true);

    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  const handleAddScheduler = () => {
    setEditingAppointment(null);
    setPrefillData(null);
    setShowForm(true);
  };

  const saveSchedule = async (newData) => {
    const tid = toast.loading("Saving appointment schedule...");
    try {
      const payload = {
        id: newData.id || "",
        patientId: newData.patientId,
        patientName: newData.patientName,
        contact: newData.contact,
        time: newData.time,
        modality: newData.modality,
        doctor: newData.doctor,
        date: newData.date,
        scheduled_station_aetitle: newData.scheduled_station_aetitle || "",
      };
      if (editingAppointment?.id) {
        await api.put(`/api/appointments/${encodeURIComponent(String(editingAppointment.id))}`, payload);
        toast.success("Appointment updated successfully", { id: tid });
      } else {
        await api.post("/api/appointments", payload);
        toast.success("New appointment scheduled!", { id: tid });
      }
      setEditingAppointment(null);
      setPrefillData(null);
      setShowForm(false);
      await loadAppointmentsByDate(currentDate);
    } catch (err) {
      console.error("Failed to save appointment:", err);
      toast.error("Failed to save appointment", { id: tid });
    }
  };

  const editAppointment = (appt) => {
    setEditingAppointment(appt);
    setPrefillData({ ...appt });
    setShowForm(true);
  };

  const deleteAppointment = async (appt) => {
    if (!appt?.id) {
      toast.error("Unable to delete (missing appointment ID)");
      return;
    }
    if (!window.confirm(`Delete scheduled appointment for ${appt.patientName || 'Patient'}?`)) return;
    const tid = toast.loading("Deleting appointment...");
    try {
      await api.delete(`/api/appointments/${encodeURIComponent(String(appt.id))}`);
      toast.success("Appointment removed", { id: tid });
      await loadAppointmentsByDate(currentDate);
    } catch (err) {
      console.error("Failed to delete appointment:", err);
      toast.error("Failed to delete appointment", { id: tid });
    }
  };

  const moveToMwl = async (appt) => {
    const tid = toast.loading("Broadcasting appointment to Modality Worklist...");
    try {
      const combineDateTime = (dateStr, timeStr) => {
        const date = String(dateStr || "").trim();
        const time = String(timeStr || "").trim();
        if (!date) return "";
        if (!time) return `${date}T00:00`;

        const ampm = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (ampm) {
          let hour = Number(ampm[1]);
          const minute = ampm[2];
          const period = ampm[3].toUpperCase();
          if (period === "PM" && hour < 12) hour += 12;
          if (period === "AM" && hour === 12) hour = 0;
          return `${date}T${String(hour).padStart(2, "0")}:${minute}`;
        }

        const m24 = time.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (m24) {
          const hour = String(Number(m24[1])).padStart(2, "0");
          return `${date}T${hour}:${m24[2]}`;
        }

        return `${date}T00:00`;
      };

      const scheduledDate = appt.date || toLocalISODate(new Date());
      const scheduledDateTime = combineDateTime(scheduledDate, appt.time || "");

      await api.post("/api/mwl", {
        PatientID: appt.patientId || "",
        PatientName: appt.patientName || "",
        Modality: appt.modality || "",
        SchedulingDate: scheduledDate,
        scheduled_datetime: scheduledDateTime,
        StudyDescription: `Scheduled ${appt.modality || ""}`.trim(),
        ReferringPhysician: appt.doctor || "",
        scheduled_station_aetitle: appt.scheduled_station_aetitle || "",
      });
      toast.success("Transmitted to DICOM Modality Worklist (MWL)!", { id: tid });
    } catch (err) {
      console.error("Move to MWL failed:", err);
      toast.error(err?.response?.data?.error || "Failed to transmit to MWL", { id: tid });
    }
  };

  const formatDisplayTime = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "-";

    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampm) {
      const h = Number(ampm[1]);
      const hour = h === 0 ? 12 : h > 12 ? ((h - 1) % 12) + 1 : h;
      return `${hour}:${ampm[2]} ${ampm[3].toUpperCase()}`;
    }

    const m24 = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m24) {
      let hour = Number(m24[1]);
      const minute = m24[2];
      const period = hour >= 12 ? "PM" : "AM";
      hour = hour % 12;
      if (hour === 0) hour = 12;
      return `${hour}:${minute} ${period}`;
    }

    return raw;
  };

  const changeDay = (days) => {
    setCurrentDate(
      new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        currentDate.getDate() + days
      )
    );
  };

  const setToday = () => {
    setCurrentDate(new Date());
  };

  const filteredAppointments = useMemo(() => {
    return appointments.filter((a) => {
      const pName = String(a.patientName || "").toLowerCase();
      const pId = String(a.patientId || "").toLowerCase();
      const contact = String(a.contact || "").toLowerCase();
      const doctor = String(a.doctor || "").toLowerCase();
      const mod = String(a.modality || "").toUpperCase();

      const q = searchQuery.toLowerCase().trim();
      const matchSearch = !q || pName.includes(q) || pId.includes(q) || contact.includes(q) || doctor.includes(q) || mod.includes(q);

      const matchMod = selectedModality === "ALL" ||
        (selectedModality === "CT" && mod.includes("CT")) ||
        (selectedModality === "MR" && (mod.includes("MR") || mod.includes("MRI"))) ||
        (selectedModality === "US" && (mod.includes("US") || mod.includes("ULTRA"))) ||
        (selectedModality === "CR" && (mod.includes("CR") || mod.includes("DX") || mod.includes("X-RAY") || mod.includes("XRAY"))) ||
        (selectedModality === "XA" && (mod.includes("XA") || mod.includes("ANGIO"))) ||
        (selectedModality === "MG" && (mod.includes("MG") || mod.includes("MAMMO")));

      return matchSearch && matchMod;
    });
  }, [appointments, searchQuery, selectedModality]);

  const stats = useMemo(() => {
    const total = appointments.length;
    const ct = appointments.filter(a => (a.modality || "").toUpperCase().includes("CT")).length;
    const mri = appointments.filter(a => (a.modality || "").toUpperCase().includes("MR")).length;
    const xray = appointments.filter(a => (a.modality || "").toUpperCase().includes("X") || (a.modality || "").toUpperCase().includes("CR") || (a.modality || "").toUpperCase().includes("DX")).length;
    return { total, ct, mri, xray };
  }, [appointments]);

  const todayDateObj = new Date();
  const isPast =
    currentDate.getFullYear() < todayDateObj.getFullYear() ||
    (currentDate.getFullYear() === todayDateObj.getFullYear() &&
      currentDate.getMonth() < todayDateObj.getMonth()) ||
    (currentDate.getFullYear() === todayDateObj.getFullYear() &&
      currentDate.getMonth() === todayDateObj.getMonth() &&
      currentDate.getDate() < todayDateObj.getDate());

  return (
    <MainLayout>
      <div className="sch-container">
        {/* HEADER HERO CARD */}
        <header className="sch-header">
          <div className="sch-title-box">
            <div className="sch-icon-wrapper">
              <Calendar size={24} />
            </div>
            <div>
              <span className="sch-badge">Enterprise RIS Worklist</span>
              <h1 className="sch-title">Diagnostic Patient Scheduling</h1>
              <p className="sch-subtitle">
                Manage appointment slots, scanner AE title allocations, and direct DICOM Modality Worklist transfers.
              </p>
            </div>
          </div>

          <div className="sch-header-actions">
            {/* DATE NAVIGATOR CONTROL */}
            <div className="sch-date-navigator">
              <button onClick={() => changeDay(-1)} className="sch-date-btn" title="Previous Day">
                <ChevronLeft size={16} />
              </button>
              <button onClick={setToday} className="sch-today-btn" title="Go to Today">
                Today
              </button>
              <div className="sch-date-picker-wrap">
                <input
                  type="date"
                  value={toLocalISODate(currentDate)}
                  onChange={(e) => {
                    if (e.target.value) setCurrentDate(new Date(e.target.value + "T00:00:00"));
                  }}
                  className="sch-date-input"
                />
                <span className="sch-date-label">
                  {currentDate.toLocaleDateString("en-IN", { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </div>
              <button onClick={() => changeDay(1)} className="sch-date-btn" title="Next Day">
                <ChevronRight size={16} />
              </button>
            </div>

            {!isPast && (
              <button onClick={handleAddScheduler} className="sch-add-btn">
                <Plus size={16} />
                New Appointment
              </button>
            )}
          </div>
        </header>

        {/* KPI STATS CARDS */}
        <div className="sch-stats-grid">
          <div className="sch-stat-card">
            <div className="sch-stat-icon indigo">
              <Calendar size={20} />
            </div>
            <div>
              <div className="sch-stat-value">{stats.total}</div>
              <div className="sch-stat-label">Total Appointments</div>
            </div>
          </div>

          <div className="sch-stat-card">
            <div className="sch-stat-icon sky">
              <Activity size={20} />
            </div>
            <div>
              <div className="sch-stat-value">{stats.ct}</div>
              <div className="sch-stat-label">CT Appointments</div>
            </div>
          </div>

          <div className="sch-stat-card">
            <div className="sch-stat-icon purple">
              <UserCheck size={20} />
            </div>
            <div>
              <div className="sch-stat-value">{stats.mri}</div>
              <div className="sch-stat-label">MRI Appointments</div>
            </div>
          </div>

          <div className="sch-stat-card">
            <div className="sch-stat-icon amber">
              <HardDrive size={20} />
            </div>
            <div>
              <div className="sch-stat-value">{stats.xray}</div>
              <div className="sch-stat-label">X-Ray & Angio</div>
            </div>
          </div>
        </div>

        {/* FILTER & SEARCH CARD */}
        <div className="sch-filter-card">
          <div className="sch-filter-row">
            <div className="sch-search-box">
              <Search size={16} className="sch-search-icon" />
              <input
                type="text"
                placeholder="Search patient, UHID, mobile, doctor, scanner AE..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="sch-search-input"
              />
            </div>
          </div>

          {/* MODALITY CHIPS STRIP */}
          <div className="sch-modality-chips">
            <span className="sch-chips-label">Modality Filter:</span>
            {[
              { id: "ALL", label: "🌐 All Modalities" },
              { id: "CT", label: "📡 CT" },
              { id: "MR", label: "🧠 MRI" },
              { id: "US", label: "🌊 Ultrasound" },
              { id: "CR", label: "🩻 X-Ray" },
              { id: "XA", label: "🩸 XA (Angio)" },
              { id: "MG", label: "🎀 Mammography" },
            ].map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedModality(m.id)}
                className={`sch-chip ${selectedModality === m.id ? "active" : ""}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* APPOINTMENTS TABLE CARD */}
        <div className="sch-table-card">
          <div className="sch-table-header">
            <div className="sch-table-title">
              <Clock size={18} className="text-indigo-600" />
              <h2>Scheduled Diagnostic Patient Worklist</h2>
            </div>
            <span className="sch-counter-tag">{filteredAppointments.length} Appointments</span>
          </div>

          {loading ? (
            <div className="sch-loading-box">
              <Activity size={28} className="animate-spin text-indigo-600" />
              <span>Fetching scheduled appointments...</span>
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="sch-empty-box">
              <Calendar size={40} style={{ color: '#94a3b8', marginBottom: 12 }} />
              <h3>No Appointments Scheduled</h3>
              <p>No diagnostic patient appointments found for {currentDate.toDateString()}.</p>
            </div>
          ) : (
            <div className="sch-table-responsive">
              <table className="sch-table">
                <thead>
                  <tr>
                    <th>Patient Name</th>
                    <th>UHID / Contact</th>
                    <th>Time</th>
                    <th>Modality</th>
                    <th>Scanner AE Title</th>
                    <th>Attending Doctor</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.map((appt) => {
                    const mod = (appt.modality || "CR").toUpperCase();
                    return (
                      <tr key={appt.id || `${appt.patientId}-${appt.date}-${appt.time}`}>
                        <td>
                          <div className="sch-patient-cell">
                            <div className="sch-avatar">{getInitials(appt.patientName)}</div>
                            <span className="sch-patient-name">{appt.patientName || "Patient"}</span>
                          </div>
                        </td>
                        <td>
                          <div className="sch-code-group">
                            <span className="sch-code-main">ID: {appt.patientId || "-"}</span>
                            <span className="sch-code-sub">📞 {appt.contact || "N/A"}</span>
                          </div>
                        </td>
                        <td>
                          <span className="sch-time-pill">
                            <Clock size={13} /> {formatDisplayTime(appt.time)}
                          </span>
                        </td>
                        <td>
                          <span className={`sch-mod-badge mod-${mod.toLowerCase().slice(0, 3)}`}>
                            {mod}
                          </span>
                        </td>
                        <td>
                          <span className="sch-station-tag">
                            🖥️ {appt.scheduled_station_aetitle || "DEFAULT_AE"}
                          </span>
                        </td>
                        <td>
                          <span className="sch-doctor-tag">
                            👨‍⚕️ {appt.doctor || "Unassigned"}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="sch-action-group">
                            <button
                              onClick={() => editAppointment(appt)}
                              className="sch-action-btn edit"
                              title="Edit Appointment Details"
                            >
                              <Edit3 size={13} /> Edit
                            </button>

                            <button
                              onClick={() => moveToMwl(appt)}
                              className="sch-action-btn mwl"
                              title="Transmit Patient to DICOM Modality Worklist (MWL)"
                            >
                              <Send size={13} /> Move to MWL
                            </button>

                            <button
                              onClick={() => deleteAppointment(appt)}
                              className="sch-action-btn delete"
                              title="Cancel / Delete Appointment"
                            >
                              <Trash2 size={13} />
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

      {showForm && (
        <div className="sch-modal-overlay">
          <div className="sch-modal-content">
            <AddScheduler
              initialData={prefillData}
              onSave={saveSchedule}
              onClose={() => {
                setShowForm(false);
                setPrefillData(null);
                setEditingAppointment(null);
              }}
            />
          </div>
        </div>
      )}
    </MainLayout>
  );
}
