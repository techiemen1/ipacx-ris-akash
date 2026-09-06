import React, { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import MainLayout from "../../layout/MainLayout";
import { Building2, Plus, Edit3, Check, X, Shield, Radio, Server, Activity } from "lucide-react";
import "./AdminManagement.css";

export default function HospitalManagement() {
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingHospital, setEditingHospital] = useState(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    logo_url: "",
  });

  useEffect(() => {
    loadHospitals();
  }, []);

  const loadHospitals = async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/hospitals");
      setHospitals(res.data.hospitals || []);
    } catch (err) {
      console.error("Failed to load hospitals:", err);
      toast.error("Failed to load hospital network list");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingHospital(null);
    setFormData({ code: "", name: "", logo_url: "" });
    setShowModal(true);
  };

  const handleOpenEdit = (h) => {
    setEditingHospital(h);
    setFormData({
      code: h.code,
      name: h.name,
      logo_url: h.logo_url || "",
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const tid = toast.loading("Saving hospital network configuration...");
    try {
      if (editingHospital) {
        await axios.put(`/api/hospitals/${editingHospital.id}`, formData);
        toast.success("Hospital network updated successfully", { id: tid });
      } else {
        await axios.post("/api/hospitals", formData);
        toast.success("New hospital network connected!", { id: tid });
      }
      setShowModal(false);
      loadHospitals();
    } catch (err) {
      console.error("Failed to save hospital:", err);
      toast.error("Failed to save hospital details", { id: tid });
    }
  };

  return (
    <MainLayout>
      <div className="adm-container">
        {/* HEADER HERO BAR */}
        <header className="adm-header">
          <div className="adm-title-box">
            <div className="adm-icon-wrapper">
              <Building2 size={24} />
            </div>
            <div>
              <span className="adm-badge">Multi-Tenant PACS Network</span>
              <h1 className="adm-title">Hospital Networks & Enterprise Configuration</h1>
              <p className="adm-subtitle">
                Configure top-level multi-tenant hospital groups, DICOM router AE titles, and regional health systems.
              </p>
            </div>
          </div>

          <button onClick={handleOpenAdd} className="adm-add-btn">
            <Plus size={16} /> Connect Hospital Group
          </button>
        </header>

        {/* KPI STATS GRID */}
        <div className="adm-stats-grid">
          <div className="adm-stat-card">
            <div className="adm-stat-icon indigo">
              <Building2 size={20} />
            </div>
            <div>
              <div className="adm-stat-value">{hospitals.length}</div>
              <div className="adm-stat-label">Hospital Networks</div>
            </div>
          </div>

          <div className="adm-stat-card">
            <div className="adm-stat-icon emerald">
              <Radio size={20} />
            </div>
            <div>
              <div className="adm-stat-value">Active</div>
              <div className="adm-stat-label">DICOM AE Router</div>
            </div>
          </div>

          <div className="adm-stat-card">
            <div className="adm-stat-icon purple">
              <Shield size={20} />
            </div>
            <div>
              <div className="adm-stat-value">HL7 / ABDM</div>
              <div className="adm-stat-label">FHIR Interoperability</div>
            </div>
          </div>

          <div className="adm-stat-card">
            <div className="adm-stat-icon sky">
              <Server size={20} />
            </div>
            <div>
              <div className="adm-stat-value">100%</div>
              <div className="adm-stat-label">PACS Node Sync</div>
            </div>
          </div>
        </div>

        {/* HOSPITAL CARDS GRID */}
        {loading ? (
          <div className="py-12 text-center text-slate-500 font-bold">
            <Activity size={28} className="animate-spin text-indigo-600 inline-block mb-2" /><br />
            Synchronizing Hospital Network Configurations...
          </div>
        ) : (
          <div className="adm-grid">
            {hospitals.map((h) => (
              <div key={h.id} className="adm-card">
                <div>
                  <div className="adm-card-top">
                    <span className="adm-code-badge">{h.code}</span>
                    <button onClick={() => handleOpenEdit(h)} className="adm-edit-btn" title="Edit Configuration">
                      <Edit3 size={15} />
                    </button>
                  </div>
                  <h3 className="adm-card-title">{h.name}</h3>
                  <p className="adm-card-desc">
                    Enterprise Healthcare System & Multi-Clinic DICOM Node Group.
                  </p>

                  <div className="adm-card-details">
                    <div className="adm-detail-item">
                      <Radio size={14} className="text-emerald-600" />
                      <span><strong>DICOM AE Router:</strong> Active (Port 104 / 4242)</span>
                    </div>
                    <div className="adm-detail-item">
                      <Shield size={14} className="text-indigo-600" />
                      <span><strong>HL7 / ABDM:</strong> Enabled & Encrypted</span>
                    </div>
                  </div>
                </div>

                <div className="adm-card-footer">
                  <span>Network Sync</span>
                  <span className="adm-status-tag">
                    <Check size={13} /> Connected & Operational
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MODAL CONFIGURATION DIALOG */}
        {showModal && (
          <div className="adm-modal-overlay">
            <div className="adm-modal">
              <div className="adm-modal-header">
                <h2 className="adm-modal-title">
                  <Building2 size={20} className="text-indigo-600" />
                  {editingHospital ? "Edit Hospital Network" : "Connect New Hospital Network"}
                </h2>
                <button onClick={() => setShowModal(false)} className="adm-modal-close">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="adm-form">
                <div className="adm-field-group">
                  <label>Network Code Identifier</label>
                  <input
                    type="text"
                    required
                    disabled={!!editingHospital}
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="adm-input mono"
                    placeholder="e.g. KMC_HEALTH"
                  />
                </div>

                <div className="adm-field-group">
                  <label>Hospital / Health System Full Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="adm-input"
                    placeholder="e.g. KMC Enterprise Diagnostic Health System"
                  />
                </div>

                <div className="adm-field-group">
                  <label>Logo Asset URL (Optional)</label>
                  <input
                    type="text"
                    value={formData.logo_url}
                    onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                    className="adm-input"
                    placeholder="https://example.com/logo.png"
                  />
                </div>

                <div className="adm-modal-actions">
                  <button type="button" onClick={() => setShowModal(false)} className="adm-btn-ghost">
                    Cancel
                  </button>
                  <button type="submit" className="adm-btn-primary">
                    {editingHospital ? "Update Network" : "Connect Hospital"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </MainLayout>
  );
}
