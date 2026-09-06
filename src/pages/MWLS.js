/* eslint-disable no-restricted-globals */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import MainLayout from "../layout/MainLayout";
import axiosInstance from "../services/axiosInstance";
import { toast } from "react-hot-toast";
import {
  Plus,
  UploadCloud,
  Trash2,
  Edit3,
  Search,
  HardDrive,
  Activity,
  Clock,
  Radio,
  Server,
  Zap,
  CheckCircle,
  X
} from "lucide-react";
import dayjs from "dayjs";
import "./MWLS.css";

const DEFAULT_MODALITIES = ["ALL", "CR", "CT", "MR", "US", "DX", "XA", "MG", "NM"];

const getInitials = (name) => {
  if (!name) return "P";
  const parts = String(name).replace(/\^/g, " ").trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

const toLocalInput = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const toDisplayTime = (value) => {
  if (!value) return "";
  const d = dayjs(value);
  if (!d.isValid()) return "";
  return d.format("DD-MM-YYYY h:mm A");
};

const fromDisplayTime = (value) => {
  if (!value) return "";
  const d = dayjs(value, "DD-MM-YYYY hh:mm A");
  if (!d.isValid()) return "";
  return d.format("YYYY-MM-DDTHH:mm");
};

const normalizeModalityCode = (mod) => {
  const k = String(mod || "CR").toUpperCase().trim();
  if (k.includes("ANGIO") || k.includes("DSA") || k === "XA") return "XA";
  if (k.includes("MRI") || k === "MR") return "MR";
  if (k.includes("ULTRA") || k.includes("USG") || k === "US") return "US";
  if (k.includes("X-RAY") || k.includes("XRAY") || k === "DX" || k === "CR") return "CR";
  if (k.includes("MAMMO") || k === "MG") return "MG";
  if (k.includes("PET") || k === "PT") return "PT";
  if (k.includes("ECHO") || k === "EC") return "EC";
  return k.slice(0, 4);
};

const modalityClass = (modality) => {
  const code = normalizeModalityCode(modality).toLowerCase();
  return `mwl-modality ${code}`;
};

const normalizeModalityValue = (value) => {
  const key = String(value || "").toUpperCase();
  if (key === "MRI") return "MR";
  if (key === "X-RAY" || key === "XRAY" || key === "X RAY") return "DX";
  return key;
};

export default function MWLS() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [activeModality, setActiveModality] = useState("ALL");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [modalities] = useState(DEFAULT_MODALITIES);
  const [reviewItem, setReviewItem] = useState(null);
  const [autoPush, setAutoPush] = useState(false);
  const [autoPushLoaded, setAutoPushLoaded] = useState(false);

  const [targetStatus, setTargetStatus] = useState({ online: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mwlRes, targetsRes] = await Promise.all([
        axiosInstance.get("/mwl"),
        axiosInstance.get("/mwl-targets")
      ]);
      
      const rows = Array.isArray(mwlRes.data?.data) ? mwlRes.data.data : [];
      setList(rows);

      const targets = Array.isArray(targetsRes.data?.data) ? targetsRes.data.data : [];
      const activeTargets = targets.filter(t => t.is_active);
      setTargetStatus(prev => ({ ...prev, total: activeTargets.length }));

      const checkTargets = async () => {
        let onlineCount = 0;
        for (const t of activeTargets) {
          try {
            const host = t.manual_host || t.ip_address;
            const port = t.manual_port || t.port;
            if (host && port) {
              const ping = await axiosInstance.post("/mwl-targets/ping", { host, port });
              if (ping.data?.success) onlineCount++;
            }
          } catch (err) {
            console.warn("Ping failed for target", t.modality_code);
          }
        }
        setTargetStatus({ online: onlineCount, total: activeTargets.length });
      };
      checkTargets();

    } catch (err) {
      console.error("load mwl", err);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const loadSetting = async () => {
      try {
        const res = await axiosInstance.get("/mwl-settings");
        setAutoPush(Boolean(res.data?.autopush_enabled));
      } catch (err) {
        console.error("load mwl settings", err);
      } finally {
        setAutoPushLoaded(true);
      }
    };
    loadSetting();
  }, []);

  const filtered = useMemo(() => {
    let result = list;
    if (activeModality !== "ALL") {
      result = result.filter((m) => {
        const normCode = normalizeModalityCode(m.modality);
        return normCode === activeModality || (m.modality || "").toUpperCase() === activeModality;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (m) =>
          (m.patient_name || "").toLowerCase().includes(q) ||
          (m.patient_id || "").toLowerCase().includes(q) ||
          (m.accession_number || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [list, query, activeModality]);

  const stats = {
    total: list.length,
    new: list.filter((m) => (m.status || "NEW") === "NEW").length,
    online: targetStatus.online,
    targetTotal: targetStatus.total
  };

  const openNew = async () => {
    let nextAccession = "";
    let nextPatientId = "";
    try {
      const [accRes, pidRes] = await Promise.allSettled([
        axiosInstance.get("/mwl/next-accession"),
        axiosInstance.get("/mwl/next-patient-id"),
      ]);
      if (accRes.status === "fulfilled") {
        nextAccession = accRes.value?.data?.accession_number || "";
      }
      if (pidRes.status === "fulfilled") {
        nextPatientId = pidRes.value?.data?.patient_id || "";
      }
    } catch (err) {
      console.error("load next ids", err);
    }
    setEditing({
      pacs_id: null,
      accession_number: nextAccession,
      study_instance_uid: "",
      patient_id: nextPatientId,
      patient_name: "",
      modality: "CT",
      scheduled_datetime: dayjs().format("YYYY-MM-DDTHH:mm"),
      scheduled_station_aetitle: "",
    });
    setShowModal(true);
  };

  const onPushNow = async (row) => {
    if (!autoPush) {
      setReviewItem(row);
      return;
    }
    await commitPush(row);
  };

  const commitPush = async (row) => {
    if (!row?.id) return;
    const tid = toast.loading("Broadcasting to DICOM Scanner AE...");
    try {
      await axiosInstance.post(`/mwl/${row.id}/send`, {
        modality: row.modality,
      });
      toast.success("Study Transmitted to Modality Worklist Successfully!", { id: tid });
      load();
    } catch (err) {
      const apiError = err?.response?.data;
      const message =
        apiError?.error ||
        apiError?.details ||
        err?.message ||
        "Transmission Failed";
      console.error("push mwl", err, apiError);
      toast.error(message, { id: tid });
    }
  };

  const onDelete = async (row) => {
    if (!row.id) return;
    if (!confirm("Remove this entry from active Worklist?")) return;
    const tid = toast.loading("Removing worklist entry...");
    try {
      await axiosInstance.delete(`/mwl/${row.id}`);
      toast.success("Worklist entry deleted", { id: tid });
      load();
    } catch (err) {
      console.error("delete mwl", err);
      toast.error("Failed to delete worklist entry", { id: tid });
    }
  };

  return (
    <MainLayout>
      <div className="mwl-page">
        {/* HEADER HERO BAR */}
        <header className="mwl-header-row">
          <div className="mwl-title-box">
            <div className="mwl-icon-wrapper">
              <Radio size={24} />
            </div>
            <div>
              <span className="mwl-badge">Enterprise C-FIND / DICOM Broker</span>
              <h1 className="page-header">DICOM Modality Worklist (MWL) Engine</h1>
              <p className="mwl-subtitle">
                Manage DICOM scheduled procedure steps, scanner AE titles, and automated C-FIND Worklist broadcasts.
              </p>
            </div>
          </div>

          <div className="mwl-header-actions">
            {/* AUTO-PUSH TOGGLE CARD */}
            <div className="mwl-toggle-card">
              <div className="mwl-toggle-text">
                <div className="mwl-toggle-label">Broadcast Automation</div>
                <div className="mwl-toggle-value">{autoPush ? "⚡ Auto-Push ON" : "Manual Push"}</div>
              </div>
              <button
                onClick={async () => {
                  const next = !autoPush;
                  setAutoPush(next);
                  try {
                    await axiosInstance.post("/mwl-settings", {
                      autopush_enabled: next,
                    });
                    toast.success(next ? "Auto-Push Enabled" : "Auto-Push Disabled");
                  } catch (err) {
                    console.error("save mwl settings", err);
                  }
                }}
                className={`mwl-toggle ${autoPush ? "on" : "off"}`}
                title="Toggle Automatic Broadcast on Patient Registration"
              >
                <span className="mwl-toggle-knob" />
              </button>
            </div>

            <button className="mwl-new-btn" onClick={openNew}>
              <Plus size={16} />
              Register Study
            </button>
          </div>
        </header>

        {/* KPI STATS STRIP */}
        <div className="mwl-stats-grid">
          <div className="mwl-stat-card">
            <div className="mwl-stat-icon indigo">
              <Radio size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">{stats.total}</div>
              <div className="mwl-stat-label">Active MWL Entries</div>
            </div>
          </div>

          <div className="mwl-stat-card">
            <div className="mwl-stat-icon amber">
              <Clock size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">{stats.new}</div>
              <div className="mwl-stat-label">Awaiting Broadcast</div>
            </div>
          </div>

          <div className="mwl-stat-card">
            <div className="mwl-stat-icon emerald">
              <Server size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">{stats.online} / {stats.targetTotal}</div>
              <div className="mwl-stat-label">Live Scanner Nodes</div>
            </div>
          </div>

          <div className="mwl-stat-card">
            <div className="mwl-stat-icon purple">
              <Zap size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">{autoPush ? "Enabled" : "Manual"}</div>
              <div className="mwl-stat-label">Automation Status</div>
            </div>
          </div>
        </div>

        {/* FILTER & SEARCH ROW */}
        <div className="mwl-filter-row">
          <div className="mwl-search">
            <Search size={16} className="mwl-search-icon" />
            <input
              type="text"
              placeholder="Search Patient Name, UHID, Accession Number..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="mwl-chips">
            <span className="mwl-chips-label">Modality:</span>
            {DEFAULT_MODALITIES.map((m) => (
              <button
                key={m}
                onClick={() => setActiveModality(m)}
                className={`mwl-chip ${activeModality === m ? "active" : ""}`}
              >
                {m === "ALL" ? "🌐 ALL" : m === "CR" ? "🩻 X-Ray" : m === "US" ? "🌊 US" : m}
              </button>
            ))}
          </div>
        </div>

        {/* WORKLIST ENTRIES GRID */}
        <div className="mwl-list">
          {loading ? (
            <div className="mwl-loading-box">
              <Activity size={28} className="animate-spin text-indigo-600 inline-block mb-2" /><br />
              Synchronizing DICOM Modality Worklist Engine...
            </div>
          ) : filtered.length === 0 ? (
            <div className="mwl-empty">
              <Radio size={40} style={{ color: '#94a3b8', marginBottom: 12 }} /><br />
              No Active Modality Worklist Entries Found for {activeModality}
            </div>
          ) : (
            filtered.map((m) => (
              <div key={m.id} className="mwl-card">
                <div className="mwl-card-left">
                  <div className={modalityClass(m.modality)} title={m.modality}>
                    {normalizeModalityCode(m.modality)}
                  </div>
                  <div className="mwl-card-details">
                    <div className="mwl-patient-row">
                      <div className="mwl-avatar">{getInitials(m.patient_name)}</div>
                      <span className="mwl-card-name">{m.patient_name || "Patient"}</span>
                    </div>
                    <div className="mwl-card-meta">
                      <span className="mwl-card-id">ID: {m.patient_id || "-"}</span>
                      <span className="mwl-card-sep">|</span>
                      <span className="mwl-card-acc">Acc: {m.accession_number || "-"}</span>
                      {(m.study_description || m.modality) && (
                        <>
                          <span className="mwl-card-sep">|</span>
                          <span className="mwl-card-desc">
                            {m.study_description || m.modality}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mwl-card-info">
                  <div className="mwl-info-block">
                    <div className="mwl-info-label">Schedule Sync</div>
                    <div className="mwl-info-value">
                      <Clock size={13} />
                      {m.scheduled_datetime
                        ? dayjs(m.scheduled_datetime).format("DD MMM h:mm A")
                        : "-"}
                    </div>
                  </div>

                  <div className="mwl-info-block">
                    <div className="mwl-info-label">Scanner AE Title</div>
                    <div className="mwl-info-value aet">
                      <Server size={13} />
                      {m.scheduled_station_aetitle || m.station_aet || "DEFAULT_AE"}
                    </div>
                  </div>

                  <div className="mwl-info-block">
                    <div className="mwl-info-label">Sync Status</div>
                    <div className="mwl-info-value">
                      <span
                        className={`mwl-status-dot ${
                          (m.status || "NEW") === "NEW" ? "warn" : "ok"
                        }`}
                      />
                      <span
                        className={`mwl-status-text ${
                          (m.status || "NEW") === "NEW" ? "warn" : "ok"
                        }`}
                      >
                        {(m.status || "NEW") === "NEW" ? "NEW / Awaiting Push" : m.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mwl-card-actions">
                  <button
                    onClick={() => onPushNow(m)}
                    className="mwl-action-btn push"
                    title="Transmit Study to Scanner MWL AE Title"
                  >
                    <UploadCloud size={13} /> Broadcast
                  </button>
                  <button
                    className="mwl-action-btn edit"
                    title="Edit Worklist Registry"
                    onClick={() => {
                      const normalizedModality = normalizeModalityValue(m.modality || "CT");
                      setEditing({
                        id: m.id,
                        pacs_id: m.pacs_id ?? null,
                        accession_number: m.accession_number || "",
                        study_instance_uid: m.study_instance_uid || "",
                        patient_id: m.patient_id || "",
                        patient_name: m.patient_name || "",
                        modality: normalizedModality,
                        scheduled_datetime: toLocalInput(m.scheduled_datetime),
                        scheduled_station_aetitle: m.scheduled_station_aetitle || "",
                      });
                      setShowModal(true);
                    }}
                  >
                    <Edit3 size={13} /> Edit
                  </button>
                  <button
                    onClick={() => onDelete(m)}
                    className="mwl-action-btn delete"
                    title="Remove Worklist Entry"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* MODAL EDITOR DIALOG */}
        {showModal && editing && (
          <div className="mwl-modal-backdrop">
            <div className="mwl-modal">
              <div className="mwl-modal-header">
                <div className="mwl-modal-title">
                  <HardDrive size={18} className="text-indigo-600" />
                  Modality Worklist Registration
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="mwl-modal-close"
                >
                  <X size={18} />
                </button>
              </div>

              <MwlEditor
                initial={editing}
                modalities={modalities.filter((m) => m !== "ALL")}
                onSaved={async () => {
                  setShowModal(false);
                  setEditing(null);
                  await load();
                }}
                onCancel={() => {
                  setShowModal(false);
                  setEditing(null);
                }}
              />
            </div>
          </div>
        )}

        {/* CONFIRMATION BROADCAST DIALOG */}
        {reviewItem && (
          <div className="mwl-modal-backdrop">
            <div className="mwl-modal">
              <div className="mwl-modal-header">
                <div className="mwl-modal-title">
                  <Activity size={18} className="text-indigo-600" />
                  Confirm DICOM Study Broadcast
                </div>
                <button
                  onClick={() => setReviewItem(null)}
                  className="mwl-modal-close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mwl-review">
                <div className="mwl-review-card">
                  <div className="mwl-review-title">Study Manifest</div>
                  <div className="mwl-review-grid">
                    <div>
                      <div className="mwl-review-label">Patient Name</div>
                      <div className="mwl-review-value">
                        {reviewItem.patient_name}
                      </div>
                    </div>
                    <div>
                      <div className="mwl-review-label">Patient ID</div>
                      <div className="mwl-review-value mono">
                        {reviewItem.patient_id}
                      </div>
                    </div>
                    <div>
                      <div className="mwl-review-label">Accession</div>
                      <div className="mwl-review-value ok">
                        {reviewItem.accession_number}
                      </div>
                    </div>
                    <div>
                      <div className="mwl-review-label">Modality</div>
                      <div className="mwl-review-value warn">
                        {reviewItem.modality}
                      </div>
                    </div>
                    <div>
                      <div className="mwl-review-label">Target Scanner AE</div>
                      <div className="mwl-review-value">
                        {reviewItem.scheduled_station_aetitle ||
                          reviewItem.scheduledstationaetitle ||
                          reviewItem.station_aet ||
                          "DEFAULT_AE"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mwl-review-note">
                  This DICOM C-FIND worklist item will be broadcasted to the target scanner AE title.
                </div>
              </div>

              <div className="mwl-modal-actions">
                <button
                  onClick={() => setReviewItem(null)}
                  className="mwl-btn ghost"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    commitPush(reviewItem);
                    setReviewItem(null);
                  }}
                  className="mwl-btn primary"
                >
                  Confirm & Broadcast
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

function MwlEditor({ initial, modalities, onSaved, onCancel }) {
  const [form, setForm] = useState(initial);
  const [stationOptions, setStationOptions] = useState([]);

  useEffect(() => {
    let active = true;
    const loadStations = async () => {
      try {
        const res = await axiosInstance.get("/mwl-targets");
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        const options = rows
          .filter((r) => r.is_active !== false)
          .map((r) => ({
            modality: String(r.modality_code || "").toUpperCase(),
            aeTitle: String(
              r.manual_called_ae || r.manual_calling_ae || r.manual_ae_title || ""
            ).trim(),
          }))
          .filter((o) => o.aeTitle);
        if (active) setStationOptions(options);
      } catch (err) {
        if (active) setStationOptions([]);
      }
    };
    loadStations();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!form.modality) return;
    if (String(form.scheduled_station_aetitle || "").trim()) return;
    const key = String(form.modality || "").toUpperCase();
    const match = stationOptions.find((o) => o.modality === key);
    if (match?.aeTitle) {
      setForm((prev) => ({ ...prev, scheduled_station_aetitle: match.aeTitle }));
    }
  }, [form.modality, form.scheduled_station_aetitle, stationOptions]);

  const filteredStations = stationOptions.filter((o) =>
    form.modality ? o.modality === String(form.modality || "").toUpperCase() : true
  );

  const save = async () => {
    const tid = toast.loading("Registering DICOM worklist entry...");
    try {
      if (form.id) {
        await axiosInstance.put(`/mwl/${form.id}`, form);
        toast.success("Worklist entry updated", { id: tid });
      } else {
        await axiosInstance.post("/mwl/register", form);
        toast.success("Worklist entry registered successfully!", { id: tid });
      }
      onSaved();
    } catch (err) {
      console.error("save mwl", err);
      toast.error("Failed to save worklist entry", { id: tid });
    }
  };

  return (
    <div className="mwl-editor">
      <div className="mwl-field">
        <label>Patient ID / UHID</label>
        <input
          value={form.patient_id ?? ""}
          onChange={(e) => setForm({ ...form, patient_id: e.target.value })}
          placeholder="Enterprise MRN..."
        />
      </div>

      <div className="mwl-field">
        <label>Patient Full Name</label>
        <input
          value={form.patient_name ?? ""}
          onChange={(e) => setForm({ ...form, patient_name: e.target.value })}
          placeholder="Full Name..."
        />
      </div>

      <div className="mwl-field">
        <label>Source Modality</label>
        <select
          value={form.modality}
          onChange={(e) => setForm({ ...form, modality: e.target.value })}
        >
          {modalities.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="mwl-field">
        <label>Scanner / Room AE Title</label>
        <input
          value={form.scheduled_station_aetitle ?? ""}
          onChange={(e) =>
            setForm({ ...form, scheduled_station_aetitle: e.target.value })
          }
          list="mwl-station-ae-options"
          placeholder="e.g. CT_ROOM_1"
        />
        <datalist id="mwl-station-ae-options">
          {filteredStations.map((o) => (
            <option key={`${o.modality}-${o.aeTitle}`} value={o.aeTitle}>
              {o.modality ? `${o.modality} - ${o.aeTitle}` : o.aeTitle}
            </option>
          ))}
        </datalist>
      </div>

      <div className="mwl-field">
        <label>Schedule Time</label>
        <input
          type="text"
          value={toDisplayTime(form.scheduled_datetime)}
          onChange={(e) =>
            setForm({ ...form, scheduled_datetime: fromDisplayTime(e.target.value) })
          }
          placeholder="DD-MM-YYYY hh:mm AM/PM"
        />
      </div>

      <div className="mwl-field wide">
        <label>Accession Identifier</label>
        <input
          value={form.accession_number ?? ""}
          onChange={(e) =>
            setForm({ ...form, accession_number: e.target.value })
          }
          placeholder="Unique Accession ID..."
        />
      </div>

      <div className="mwl-editor-actions">
        <button onClick={onCancel} className="mwl-btn ghost">
          Cancel
        </button>
        <button onClick={save} className="mwl-btn primary">
          Save Entry
        </button>
      </div>
    </div>
  );
}
