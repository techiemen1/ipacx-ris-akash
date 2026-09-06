import React, { useEffect, useState } from "react";
import MainLayout from "../../layout/MainLayout";
import api from "../../api/axios";
import { Server, Radio, HardDrive, Cpu, CheckCircle, RefreshCw, Plus, Edit2, Trash2, Zap, Activity } from "lucide-react";
import "./MwlsManagement.css";

function MwlsManagement() {
  const [activeTab, setActiveTab] = useState("status"); // status | modalities | pacs | ohif
  const [mappings, setMappings] = useState([]);
  const [pacsList, setPacsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState({ success: null, error: null, checking: false });
  const [modalityOptions, setModalityOptions] = useState([{ code: "ALL", name: "All Modalities" }]);
  const [ohifUrl, setOhifUrl] = useState(localStorage.getItem("OHIF_VIEWER_URL") || "");

  // Modality Form
  const [form, setForm] = useState({
    modality_code: "ALL",
    manual_host: "",
    manual_port: "",
    manual_ae_title: "",
    manual_type: "ORTHANC",
    manual_protocol: "DICOMWEB",
    manual_calling_ae: "",
    manual_called_ae: "",
    viewer_protocol: "OHIF (Web-based)",
    is_active: true,
  });

  // PACS Form
  const [pacsForm, setPacsForm] = useState({
    id: null,
    pacs_name: "",
    ae_title: "",
    ip_address: "",
    port: "",
    pacs_type: "ORTHANC",
    username: "",
    password: ""
  });

  const checkServiceStatus = async () => {
    setServiceStatus(prev => ({ ...prev, checking: true }));
    try {
      const res = await api.get("/api/mwl-targets/service-status");
      setServiceStatus({ success: res.data?.success, error: res.data?.error || null, checking: false });
    } catch (err) {
      setServiceStatus({ success: false, error: "Backend Unreachable", checking: false });
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [mappingsRes, optionsRes, pacsRes] = await Promise.all([
        api.get("/api/mwl-targets"),
        api.get("/api/mwl-targets/options"),
        api.get("/api/pacs")
      ]);

      setMappings(mappingsRes.data?.data || []);
      setPacsList(pacsRes.data || []);

      const options = Array.isArray(optionsRes.data?.modalities) ? optionsRes.data.modalities : [];
      const normalized = options.map((m) => ({
        code: String(m.code || "").toUpperCase(),
        name: m.name || m.code || "Unknown",
      }));
      setModalityOptions([{ code: "ALL", name: "All Modalities" }, ...normalized]);
    } catch (err) {
      console.error("Failed to load management data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    checkServiceStatus();
  }, []);

  const handleModalityChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSaveModality = async () => {
    if (!form.manual_host || !form.manual_port) return alert("Enter IP/Hostname and Port");
    try {
      await api.post("/api/mwl-targets", { ...form, manual_port: Number(form.manual_port) });
      loadData();
      alert("Modality configuration saved");
    } catch (err) {
      alert(err?.response?.data?.error || "Failed to save");
    }
  };

  const handlePacsChange = (e) => {
    setPacsForm({ ...pacsForm, [e.target.name]: e.target.value });
  };

  const handleSavePacs = async () => {
    if (!pacsForm.pacs_name || !pacsForm.ip_address || !pacsForm.port) return alert("Name, IP, and Port are required");
    try {
      await api.post("/api/pacs", pacsForm);
      loadData();
      alert("PACS destination saved");
      setPacsForm({ id: null, pacs_name: "", ae_title: "", ip_address: "", port: "", pacs_type: "ORTHANC", username: "", password: "" });
    } catch (err) {
      alert(err.response?.data?.error || "Failed to save PACS");
    }
  };

  const handleEditPacs = (p) => {
    setPacsForm({
      id: p.id,
      pacs_name: p.pacs_name,
      ae_title: p.ae_title,
      ip_address: p.ip_address,
      port: p.port,
      pacs_type: p.pacs_type || "ORTHANC",
      username: p.username || "",
      password: p.password || ""
    });
  };

  const handleDeletePacs = async (id) => {
    if (!window.confirm("Delete this PACS destination?")) return;
    try {
      await api.delete(`/api/pacs/${id}`);
      loadData();
    } catch (err) {
      alert("Delete failed");
    }
  };

  const handleTestPacs = async (p) => {
    try {
      const res = await api.post("/api/pacs/test", p);
      if (res.data.success) alert("Connection Successful!");
      else alert("Connection Failed: " + res.data.message);
    } catch (err) {
      alert("Test Error: " + (err.response?.data?.error || err.message));
    }
  };

  const handleTogglePacs = async (p) => {
    try {
      const action = p.is_active ? "deactivate" : "activate";
      await api.post(`/api/pacs/${p.id}/${action}`);
      loadData();
    } catch (err) {
      alert("Toggle failed");
    }
  };

  const handleSyncPacs = async (id) => {
    try {
      alert("Sync started... please wait.");
      const res = await api.post(`/api/pacs/${id}/sync`);
      alert(`Sync completed! ${res.data.synced} studies added.`);
      loadData();
    } catch (err) {
      alert("Sync failed");
    }
  };

  const handleSaveOhifUrl = () => {
    if (ohifUrl.trim()) {
      localStorage.setItem("OHIF_VIEWER_URL", ohifUrl.trim());
      alert("External OHIF Viewer URL saved!");
    } else {
      localStorage.removeItem("OHIF_VIEWER_URL");
      alert("Reset to default OHIF path.");
    }
  };

  return (
    <MainLayout>
      <div className="mwl-management">
        {/* HEADER HERO BAR */}
        <header className="mwl-header">
          <div className="mwl-title-box">
            <div className="mwl-icon-wrapper">
              <Server size={24} />
            </div>
            <div>
              <span className="mwl-badge">DICOM C-FIND / C-STORE Gateway</span>
              <h1 className="mwl-title">Radiology Stack & PACS Infrastructure</h1>
              <p className="mwl-subtitle">
                Configure internal DICOM MWL SCP broker, modality scanner targets, and auto-archival PACS nodes.
              </p>
            </div>
          </div>
        </header>

        {/* KPI STATS STRIP */}
        <div className="mwl-stats-grid">
          <div className="mwl-stat-card">
            <div className="mwl-stat-icon indigo">
              <Radio size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">IPACX_MWL</div>
              <div className="mwl-stat-label">Internal AE Title</div>
            </div>
          </div>

          <div className="mwl-stat-card">
            <div className="mwl-stat-icon emerald">
              <CheckCircle size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">
                {serviceStatus.checking ? "Checking..." : serviceStatus.success ? "Online" : "Offline"}
              </div>
              <div className="mwl-stat-label">MWL SCP Service</div>
            </div>
          </div>

          <div className="mwl-stat-card">
            <div className="mwl-stat-icon purple">
              <Cpu size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">{mappings.length}</div>
              <div className="mwl-stat-label">Configured Modalities</div>
            </div>
          </div>

          <div className="mwl-stat-card">
            <div className="mwl-stat-icon amber">
              <HardDrive size={20} />
            </div>
            <div>
              <div className="mwl-stat-value">{pacsList.length}</div>
              <div className="mwl-stat-label">Archival PACS Nodes</div>
            </div>
          </div>
        </div>

        {/* TABS HEADER */}
        <div className="mwl-tabs">
          <button 
            className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            <Radio size={15} /> 1. MWL Server Status
          </button>
          <button 
            className={`tab-btn ${activeTab === 'modalities' ? 'active' : ''}`}
            onClick={() => setActiveTab('modalities')}
          >
            <Cpu size={15} /> 2. Modalities & Scanners
          </button>
          <button 
            className={`tab-btn ${activeTab === 'pacs' ? 'active' : ''}`}
            onClick={() => setActiveTab('pacs')}
          >
            <HardDrive size={15} /> 3. Archival PACS Nodes
          </button>
          <button 
            className={`tab-btn ${activeTab === 'ohif' ? 'active' : ''}`}
            onClick={() => setActiveTab('ohif')}
          >
            <Activity size={15} /> 4. External OHIF Viewer URL
          </button>
        </div>

        <div className="tab-content">
          {/* TAB 1: SERVICE STATUS */}
          {activeTab === 'status' && (
            <div className="status-section">
              <div className="mwl-card-form" style={{ maxWidth: 540 }}>
                <h3><Server size={18} className="text-indigo-600 inline mr-2" /> Internal MWL SCP Service Engine</h3>
                <div className={`status-badge ${serviceStatus.checking ? 'checking' : serviceStatus.success ? 'online' : 'offline'}`}>
                  {serviceStatus.checking ? "Checking..." : serviceStatus.success ? "SERVICE ONLINE 🟢" : "SERVICE OFFLINE 🔴"}
                </div>
                {serviceStatus.error && <p className="error-text" style={{ color: '#ef4444', fontSize: 12 }}>Error: {serviceStatus.error}</p>}
                
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, margin: '16px 0', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>AE Title:</span>
                    <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>IPACX_MWL</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>DICOM C-FIND Port:</span>
                    <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>11118</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>HL7 Ingest Port:</span>
                    <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>6060</strong>
                  </div>
                </div>

                <button className="mwl-save-btn" onClick={checkServiceStatus} disabled={serviceStatus.checking}>
                  <RefreshCw size={14} className={serviceStatus.checking ? "animate-spin inline mr-1" : "inline mr-1"} /> Refresh Service Status
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: MODALITIES */}
          {activeTab === 'modalities' && (
            <div className="modality-section">
              <div className="mwl-card-form">
                <h3><Plus size={18} className="text-indigo-600 inline mr-2" /> Add New Modality Scanner Target</h3>
                <div className="mwl-form-grid">
                  <div className="mwl-field">
                    <label>Modality Type</label>
                    <select name="modality_code" value={form.modality_code} onChange={handleModalityChange}>
                      {modalityOptions.map((m) => (
                        <option key={m.code} value={m.code}>{m.name} ({m.code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="mwl-field">
                    <label>Modality AE Title</label>
                    <input name="manual_ae_title" placeholder="e.g. US_ROOM_1" value={form.manual_ae_title} onChange={handleModalityChange} />
                  </div>
                  <div className="mwl-field">
                    <label>IP Address</label>
                    <input name="manual_host" placeholder="192.168.x.x" value={form.manual_host} onChange={handleModalityChange} />
                  </div>
                  <div className="mwl-field">
                    <label>Port</label>
                    <input name="manual_port" placeholder="104" value={form.manual_port} onChange={handleModalityChange} />
                  </div>
                </div>
                <button className="mwl-save-btn" onClick={handleSaveModality}>
                  <Plus size={14} className="inline mr-1" /> Save Modality Target
                </button>
              </div>

              <div className="modality-list">
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Registered Modality Scanners</h3>
                <table className="setting-table">
                  <thead>
                    <tr>
                      <th>Modality</th>
                      <th>AE Title</th>
                      <th>IP Address</th>
                      <th>Port</th>
                      <th style={{ textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map(m => (
                      <tr key={m.id}>
                        <td><span style={{ fontWeight: 800, color: '#4338ca' }}>{m.modality_code}</span></td>
                        <td><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{m.manual_ae_title}</span></td>
                        <td>{m.manual_host}</td>
                        <td>{m.manual_port}</td>
                        <td style={{ textAlign: "center" }}>
                          <button onClick={() => api.delete(`/api/mwl-targets/${m.modality_code}`).then(loadData)} className="danger-btn">
                            <Trash2 size={13} /> Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {mappings.length === 0 && <tr><td colSpan="5" style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>No modalities configured</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: PACS SERVERS */}
          {activeTab === 'pacs' && (
            <div className="pacs-section">
              <div className="mwl-card-form">
                <h3><HardDrive size={18} className="text-indigo-600 inline mr-2" /> Configure Archival PACS Node</h3>
                <div className="mwl-form-grid">
                  <div className="mwl-field">
                    <label>PACS Name</label>
                    <input name="pacs_name" placeholder="e.g. Main Orthanc Server" value={pacsForm.pacs_name} onChange={handlePacsChange} />
                  </div>
                  <div className="mwl-field">
                    <label>Server Type</label>
                    <select name="pacs_type" value={pacsForm.pacs_type} onChange={handlePacsChange}>
                      <option value="ORTHANC">ORTHANC</option>
                      <option value="DCM4CHEE">DCM4CHEE</option>
                    </select>
                  </div>
                  <div className="mwl-field">
                    <label>AE Title</label>
                    <input name="ae_title" placeholder="ORTHANC" value={pacsForm.ae_title} onChange={handlePacsChange} />
                  </div>
                  <div className="mwl-field">
                    <label>IP Address / Host</label>
                    <input name="ip_address" placeholder="192.168.x.x or 'orthanc'" value={pacsForm.ip_address} onChange={handlePacsChange} />
                  </div>
                  <div className="mwl-field">
                    <label>Port</label>
                    <input name="port" type="number" placeholder="4242 or 8042" value={pacsForm.port} onChange={handlePacsChange} />
                  </div>
                  <div className="mwl-field">
                    <label>Username</label>
                    <input name="username" placeholder="Optional" value={pacsForm.username} onChange={handlePacsChange} />
                  </div>
                  <div className="mwl-field">
                    <label>Password</label>
                    <input name="password" type="password" placeholder="Optional" value={pacsForm.password} onChange={handlePacsChange} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="mwl-save-btn" onClick={handleSavePacs}>
                    {pacsForm.id ? "Update PACS Node" : "Add PACS Node"}
                  </button>
                  {pacsForm.id && (
                    <button className="mwl-save-btn" style={{ background: '#cbd5e1', color: '#475569' }} onClick={() => setPacsForm({ id: null, pacs_name: "", ae_title: "", ip_address: "", port: "", pacs_type: "ORTHANC" })}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              <div className="pacs-list">
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Configured PACS Nodes</h3>
                <table className="setting-table">
                  <thead>
                    <tr>
                      <th>Node Name</th>
                      <th>Type</th>
                      <th>AE Title</th>
                      <th>IP:Port</th>
                      <th>Status</th>
                      <th style={{ textAlign: "center" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pacsList.map(p => (
                      <tr key={p.id}>
                        <td><strong style={{ color: '#0f172a' }}>{p.pacs_name}</strong></td>
                        <td><span style={{ fontWeight: 800, color: '#0284c7' }}>{p.pacs_type}</span></td>
                        <td><span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{p.ae_title}</span></td>
                        <td>{p.ip_address}:{p.port}</td>
                        <td>
                          <span className={`status-pill ${p.is_active ? 'active' : 'inactive'}`}>
                            {p.is_active ? "Enabled" : "Disabled"}
                          </span>
                        </td>
                        <td>
                          <div className="action-btns" style={{ justifyContent: 'center' }}>
                            <button onClick={() => handleEditPacs(p)} className="edit-btn" title="Edit Node">Edit</button>
                            <button onClick={() => handleTestPacs(p)} className="test-btn" title="Test Connection">Test</button>
                            <button onClick={() => handleSyncPacs(p.id)} className="sync-btn" title="Sync Studies">Sync</button>
                            <button onClick={() => handleTogglePacs(p)} className={p.is_active ? "disable-btn" : "enable-btn"}>
                              {p.is_active ? "Disable" : "Enable"}
                            </button>
                            <button onClick={() => handleDeletePacs(p.id)} className="danger-btn" title="Delete">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {pacsList.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8', padding: 24 }}>No PACS nodes configured</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: EXTERNAL OHIF VIEWER */}
          {activeTab === 'ohif' && (
            <div className="ohif-section">
              <div className="mwl-card-form" style={{ maxWidth: 640 }}>
                <h3><Activity size={18} className="text-indigo-600 inline mr-2" /> External OHIF Viewer Configuration</h3>
                <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                  Configure the base URL of your remote OHIF Viewer server (e.g. <code>http://192.168.1.100:3000/viewer</code> or <code>http://pacs.hospital.org/ohif/</code>).
                </p>

                <div className="mwl-field" style={{ marginBottom: 16 }}>
                  <label>External OHIF Viewer URL (IP:Port / Path)</label>
                  <input 
                    type="text" 
                    placeholder="http://192.168.1.50:3000/viewer"
                    value={ohifUrl}
                    onChange={(e) => setOhifUrl(e.target.value)}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', fontFamily: 'monospace' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="mwl-save-btn" onClick={handleSaveOhifUrl}>
                    Save OHIF Viewer Path
                  </button>
                  {ohifUrl && (
                    <button 
                      className="mwl-save-btn" 
                      style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' }}
                      onClick={() => window.open(ohifUrl, '_blank')}
                    >
                      Test Open URL
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}

export default MwlsManagement;
