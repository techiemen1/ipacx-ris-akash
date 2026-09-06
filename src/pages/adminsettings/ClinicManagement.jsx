import React, { useState, useEffect } from "react";
import api from "../../api/axios";
import toast from "react-hot-toast";
import MainLayout from "../../layout/MainLayout";
import { Building, Plus, Edit3, Check, X, Phone, MapPin, FileText, Hash, Activity } from "lucide-react";
import "./AdminManagement.css";

export default function ClinicManagement() {
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingClinic, setEditingClinic] = useState(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    header_text: "",
    footer_text: "",
    address: "",
    phone: "",
    email: "",
    mrn_prefix: "MRN",
    mrn_format: "{PREFIX}-{YY}{MM}-{SEQ}",
    mrn_next_seq: 1001,
  });

  useEffect(() => {
    loadClinics();
  }, []);

  const loadClinics = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/clinics");
      const list = Array.isArray(res.data) ? res.data : (res.data?.clinics || res.data?.availableClinics || []);
      setClinics(list);
    } catch (err) {
      console.error("Failed to load clinics:", err);
      toast.error("Failed to load clinic branches");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingClinic(null);
    setFormData({
      code: "",
      name: "",
      header_text: "Department of Radio-Diagnosis & Advanced Imaging",
      footer_text: "Electronically Verified Diagnostic Report",
      address: "",
      phone: "",
      email: "",
      mrn_prefix: "MRN",
      mrn_format: "{PREFIX}-{YY}{MM}-{SEQ}",
      mrn_next_seq: 1001,
    });
    setShowModal(true);
  };

  const handleOpenEdit = (clinic) => {
    setEditingClinic(clinic);
    setFormData({
      code: clinic.code,
      name: clinic.name,
      header_text: clinic.header_text || "",
      footer_text: clinic.footer_text || "",
      address: clinic.address || "",
      phone: clinic.phone || "",
      email: clinic.email || "",
      mrn_prefix: clinic.mrn_prefix || "MRN",
      mrn_format: clinic.mrn_format || "{PREFIX}-{YY}{MM}-{SEQ}",
      mrn_next_seq: clinic.mrn_next_seq || 1001,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      toast.error("Clinic Code and Clinic Name are required!");
      return;
    }
    const tid = toast.loading("Saving clinic branch configuration...");
    try {
      if (editingClinic) {
        await api.put(`/api/clinics/${editingClinic.id}`, formData);
        toast.success("Clinic branch updated successfully", { id: tid });
      } else {
        await api.post("/api/clinics", formData);
        toast.success("New clinic branch registered!", { id: tid });
      }
      setShowModal(false);
      loadClinics();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || "Failed to save clinic details";
      console.error("Failed to save clinic:", err);
      toast.error(msg, { id: tid });
    }
  };

  return (
    <MainLayout>
      <div className="adm-container">
        {/* HEADER HERO BAR */}
        <header className="adm-header">
          <div className="adm-title-box">
            <div className="adm-icon-wrapper">
              <Building size={24} />
            </div>
            <div>
              <span className="adm-badge">Multi-Branch Diagnostic Centers</span>
              <h1 className="adm-title">Clinic Branches & PDF Report Branding</h1>
              <p className="adm-subtitle">
                Configure multi-clinic locations, custom PDF report header/footer branding, and automated MRN patient ID sequence patterns.
              </p>
            </div>
          </div>

          <button onClick={handleOpenAdd} className="adm-add-btn">
            <Plus size={16} /> Add Clinic Branch
          </button>
        </header>

        {/* KPI STATS GRID */}
        <div className="adm-stats-grid">
          <div className="adm-stat-card">
            <div className="adm-stat-icon indigo">
              <Building size={20} />
            </div>
            <div>
              <div className="adm-stat-value">{clinics.length}</div>
              <div className="adm-stat-label">Active Clinic Branches</div>
            </div>
          </div>

          <div className="adm-stat-card">
            <div className="adm-stat-icon emerald">
              <FileText size={20} />
            </div>
            <div>
              <div className="adm-stat-value">Configured</div>
              <div className="adm-stat-label">PDF Report Letterhead</div>
            </div>
          </div>

          <div className="adm-stat-card">
            <div className="adm-stat-icon purple">
              <Hash size={20} />
            </div>
            <div>
              <div className="adm-stat-value">Auto MRN</div>
              <div className="adm-stat-label">Sequence Generator</div>
            </div>
          </div>
        </div>

        {/* CLINIC CARDS GRID */}
        {loading ? (
          <div className="py-12 text-center text-slate-500 font-bold">
            <Activity size={28} className="animate-spin text-indigo-600 inline-block mb-2" /><br />
            Loading Clinic Branches...
          </div>
        ) : (
          <div className="adm-grid">
            {clinics.map((c) => (
              <div key={c.id} className="adm-card">
                <div>
                  <div className="adm-card-top">
                    <span className="adm-code-badge">{c.code}</span>
                    <button onClick={() => handleOpenEdit(c)} className="adm-edit-btn" title="Edit Clinic Branch">
                      <Edit3 size={15} />
                    </button>
                  </div>
                  <h3 className="adm-card-title">{c.name}</h3>
                  <p className="adm-card-desc">
                    {c.address ? (
                      <span className="flex items-center gap-1.5"><MapPin size={13} className="text-indigo-500 shrink-0" /> {c.address}</span>
                    ) : (
                      "Diagnostic & Radio-Diagnosis Imaging Center"
                    )}
                  </p>

                  <div className="adm-card-details">
                    <div className="adm-detail-item">
                      <FileText size={14} className="text-indigo-600 shrink-0" />
                      <span><strong>Header:</strong> {c.header_text || "Default Header"}</span>
                    </div>
                    <div className="adm-detail-item">
                      <Phone size={14} className="text-emerald-600 shrink-0" />
                      <span><strong>Phone / Helpline:</strong> {c.phone || "N/A"}</span>
                    </div>
                    <div className="adm-detail-item">
                      <Hash size={14} className="text-purple-600 shrink-0" />
                      <span><strong>MRN Format:</strong> <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[11px]">{c.mrn_prefix || 'MRN'}-SEQ:{c.mrn_next_seq || 1001}</code></span>
                    </div>
                  </div>
                </div>

                <div className="adm-card-footer">
                  <span>Branch Status</span>
                  <span className="adm-status-tag">
                    <Check size={13} /> Active & Operational
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MODAL CONFIGURATION DIALOG */}
        {showModal && (
          <div className="adm-modal-overlay">
            <div className="adm-modal" style={{ maxWidth: 600 }}>
              <div className="adm-modal-header">
                <h2 className="adm-modal-title">
                  <Building size={20} className="text-indigo-600" />
                  {editingClinic ? "Edit Clinic Branch Settings" : "Register New Clinic Branch"}
                </h2>
                <button onClick={() => setShowModal(false)} className="adm-modal-close">
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="adm-form">
                <div className="adm-form-row">
                  <div className="adm-field-group">
                    <label>Branch Code</label>
                    <input
                      type="text"
                      required
                      disabled={!!editingClinic}
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      className="adm-input mono"
                      placeholder="e.g. CLINIC_MAIN"
                    />
                  </div>

                  <div className="adm-field-group">
                    <label>Branch Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="adm-input"
                      placeholder="e.g. Main City Diagnostic Center"
                    />
                  </div>
                </div>

                <div className="adm-field-group">
                  <label>PDF Report Letterhead Header Text</label>
                  <input
                    type="text"
                    value={formData.header_text}
                    onChange={(e) => setFormData({ ...formData, header_text: e.target.value })}
                    className="adm-input"
                    placeholder="Department of Radiology & Advanced Imaging"
                  />
                </div>

                <div className="adm-field-group">
                  <label>PDF Report Footer Text</label>
                  <input
                    type="text"
                    value={formData.footer_text}
                    onChange={(e) => setFormData({ ...formData, footer_text: e.target.value })}
                    className="adm-input"
                    placeholder="Electronically Verified Diagnostic Report"
                  />
                </div>

                {/* AUTOMATED MRN ID PATTERN CONFIGURATION */}
                <div className="adm-mrn-card">
                  <div className="adm-mrn-title">
                    <Hash size={15} /> Automated Patient MRN / ID Pattern Generator
                  </div>
                  <div className="adm-form-row">
                    <div className="adm-field-group">
                      <label>MRN Prefix Token</label>
                      <input
                        type="text"
                        value={formData.mrn_prefix}
                        onChange={(e) => setFormData({ ...formData, mrn_prefix: e.target.value })}
                        className="adm-input mono"
                        placeholder="e.g. KMC, MRN, IPX"
                      />
                    </div>
                    <div className="adm-field-group">
                      <label>Next Sequence Start</label>
                      <input
                        type="number"
                        value={formData.mrn_next_seq}
                        onChange={(e) => setFormData({ ...formData, mrn_next_seq: Number(e.target.value) })}
                        className="adm-input mono"
                        placeholder="1001"
                      />
                    </div>
                  </div>
                  <div className="adm-field-group">
                    <label>MRN Pattern Template</label>
                    <input
                      type="text"
                      value={formData.mrn_format}
                      onChange={(e) => setFormData({ ...formData, mrn_format: e.target.value })}
                      className="adm-input mono"
                      placeholder="{PREFIX}-{YY}{MM}-{SEQ}"
                    />
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      Tokens: <code>&#123;PREFIX&#125;</code>, <code>&#123;YY&#125;</code>, <code>&#123;MM&#125;</code>, <code>&#123;YYYY&#125;</code>, <code>&#123;SEQ&#125;</code>
                    </span>
                  </div>
                </div>

                <div className="adm-form-row">
                  <div className="adm-field-group">
                    <label>Phone / Helpline Number</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="adm-input"
                      placeholder="+91 98765 43210"
                    />
                  </div>

                  <div className="adm-field-group">
                    <label>Email Address</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="adm-input"
                      placeholder="info@diagnosticcenter.com"
                    />
                  </div>
                </div>

                <div className="adm-field-group">
                  <label>Full Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="adm-input"
                    placeholder="123 Health City Avenue, Medical District"
                  />
                </div>

                <div className="adm-modal-actions">
                  <button type="button" onClick={() => setShowModal(false)} className="adm-btn-ghost">
                    Cancel
                  </button>
                  <button type="submit" className="adm-btn-primary">
                    {editingClinic ? "Update Branch" : "Save Branch"}
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
