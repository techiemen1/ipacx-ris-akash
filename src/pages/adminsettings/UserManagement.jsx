import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../../layout/MainLayout";
import api, { apiUrl } from "../../api/axios";
import { Users, UserPlus, Shield, Building2, X, Edit3, Trash2, Activity } from "lucide-react";
import "./UserManagement.css";

const EMPTY_FORM = {
  id: null,
  title: "",
  full_name: "",
  username: "",
  email: "",
  password: "",
  role: "",
  qualification: "",
  designation: "",
  signature: null,
  signature_url: "",
  assigned_clinics: ["ALL"]
};

const TITLES = ["Dr", "Mr", "Miss", "Mrs"];
const ROLES = ["ADMIN", "RADIOLOGIST", "TECHNICIAN", "RECEPTIONIST", "NURSE", "SUPERVISOR"];
const QUALIFICATIONS = ["MBBS", "MBBS, DMRD", "MBBS, MD (Radiology)", "MBBS, DNB (Radiology)"];
const DESIGNATIONS = ["PG Resident", "Senior Resident", "Consultant Radiologist", "Senior Consultant"];

const getInitials = (name) => {
  if (!name) return "U";
  const parts = String(name).replace(/\^/g, " ").trim().split(" ");
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

export default function UserManagement() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    fetchUsers();
    fetchClinics();
  }, []);

  const fetchClinics = async () => {
    try {
      const res = await api.get("/api/clinics");
      const list = Array.isArray(res.data) ? res.data : (res.data?.availableClinics || []);
      setClinics(list);
    } catch (err) {
      console.error("Fetch clinics error:", err);
    }
  };

  const signaturePreview = useMemo(() => {
    if (form.signature) return URL.createObjectURL(form.signature);
    if (form.signature_url) return apiUrl(form.signature_url);
    return "";
  }, [form.signature, form.signature_url]);

  useEffect(() => {
    return () => {
      if (form.signature && signaturePreview.startsWith("blob:")) {
        URL.revokeObjectURL(signaturePreview);
      }
    };
  }, [form.signature, signaturePreview]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/api/users");
      if (!Array.isArray(res.data)) throw new Error("Unexpected response from server");
      setUsers(res.data);
    } catch (err) {
      console.error("Fetch users error:", err);
      setError(err.response?.data?.error || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  const openAddForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (user) => {
    setForm({
      id: user.id,
      title: user.title || "",
      full_name: user.full_name || "",
      username: user.username || "",
      email: user.email || "",
      password: "",
      role: user.role || "",
      qualification: user.qualification || "",
      designation: user.designation || "",
      signature: null,
      signature_url: user.signature_url || "",
      assigned_clinics: Array.isArray(user.assigned_clinics) && user.assigned_clinics.length > 0 ? user.assigned_clinics : ["ALL"]
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const toggleUser = async (id) => {
    try {
      const res = await api.put(`/api/users/${id}/toggle`);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, is_active: res.data.is_active } : u)));
    } catch (err) {
      console.error("Toggle failed:", err);
      alert("Failed to toggle user status");
    }
  };

  const deleteUser = async (id) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try {
      await api.delete(`/api/users/${id}`);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete user");
    }
  };

  const toggleClinicSelection = (code) => {
    setForm(prev => {
      let current = [...(prev.assigned_clinics || [])];
      if (code === "ALL") {
        return { ...prev, assigned_clinics: ["ALL"] };
      }

      current = current.filter(c => c !== "ALL");
      if (current.includes(code)) {
        current = current.filter(c => c !== code);
      } else {
        current.push(code);
      }

      if (current.length === 0) current = ["ALL"];
      return { ...prev, assigned_clinics: current };
    });
  };

  const saveUser = async (e) => {
    e.preventDefault();

    if (!form.username || (!form.password && !form.id) || !form.role || !form.email) {
      alert("Username, email, password (for new users), and role are required");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      alert("Invalid email format");
      return;
    }

    try {
      setSaving(true);
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("full_name", form.full_name);
      fd.append("username", form.username);
      fd.append("email", form.email);
      fd.append("role", form.role);
      fd.append("qualification", form.qualification);
      fd.append("designation", form.designation);
      fd.append("assigned_clinics", JSON.stringify(form.assigned_clinics || ["ALL"]));
      if (form.password) fd.append("password", form.password);
      if (form.signature) fd.append("signature", form.signature);

      let res;
      if (form.id) {
        res = await api.put(`/api/users/${form.id}`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setUsers((prev) => prev.map((u) => (u.id === form.id ? { ...u, ...res.data } : u)));
      } else {
        res = await api.post("/api/users", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setUsers((prev) => [...prev, res.data]);
      }

      closeForm();
    } catch (err) {
      console.error("Save user failed:", err);
      alert(err.response?.data?.error || "Failed to save user");
    } finally {
      setSaving(false);
    }
  };

  const radiologistsCount = users.filter(u => u.role === "RADIOLOGIST").length;

  return (
    <MainLayout>
      <div className="um-page">
        {/* HEADER HERO BAR */}
        <header className="um-header">
          <div className="um-title-box">
            <div className="um-icon-wrapper">
              <Users size={24} />
            </div>
            <div>
              <span className="um-badge">RBAC Security Gateway</span>
              <h1 className="um-title">User Management & Multi-Clinic Access</h1>
              <p className="um-subtitle">
                Manage user accounts, digital signatures, role-based security permissions, and multi-tenant clinic assignments.
              </p>
            </div>
          </div>

          <div className="um-header-actions">
            <button className="um-btn um-btn-primary" onClick={openAddForm}>
              <UserPlus size={16} /> Add User Account
            </button>
            <button className="um-btn" onClick={() => navigate("/admin/clinics")}>
              <Building2 size={16} /> Clinic Branch Studio
            </button>
          </div>
        </header>

        {/* KPI SUMMARY STATS STRIP */}
        <div className="um-stats-grid">
          <div className="um-stat-card">
            <div className="um-stat-icon indigo">
              <Users size={20} />
            </div>
            <div>
              <div className="um-stat-value">{users.length}</div>
              <div className="um-stat-label">User Accounts</div>
            </div>
          </div>

          <div className="um-stat-card">
            <div className="um-stat-icon emerald">
              <Shield size={20} />
            </div>
            <div>
              <div className="um-stat-value">{radiologistsCount}</div>
              <div className="um-stat-label">Radiologists Signed</div>
            </div>
          </div>

          <div className="um-stat-card">
            <div className="um-stat-icon purple">
              <Activity size={20} />
            </div>
            <div>
              <div className="um-stat-value">{ROLES.length}</div>
              <div className="um-stat-label">Security Roles</div>
            </div>
          </div>

          <div className="um-stat-card">
            <div className="um-stat-icon sky">
              <Building2 size={20} />
            </div>
            <div>
              <div className="um-stat-value">{clinics.length || "All"}</div>
              <div className="um-stat-label">Configured Clinics</div>
            </div>
          </div>
        </div>

        {/* MODAL FORM DIALOG */}
        {showForm && (
          <div className="um-modal-backdrop">
            <div className="um-modal-panel">
              <div className="um-form-top">
                <h3>{form.id ? "Edit User Credentials" : "Create New User Account"}</h3>
                <button className="um-close-link" onClick={closeForm}>
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={saveUser} className="um-form-grid">
                <label>
                  <span>Title</span>
                  <select value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}>
                    <option value="">Select Title...</option>
                    {TITLES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Full Name</span>
                  <input
                    type="text"
                    placeholder="Full Name..."
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </label>

                <label>
                  <span>Username *</span>
                  <input
                    type="text"
                    placeholder="e.g. dr_smith"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                  />
                </label>

                <label>
                  <span>Email *</span>
                  <input
                    type="email"
                    placeholder="doctor@hospital.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </label>

                <label>
                  <span>{form.id ? "New Password (Optional)" : "Password *"}</span>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!form.id}
                  />
                </label>

                <label>
                  <span>Role *</span>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required>
                    <option value="">Select Role...</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Qualification</span>
                  <select value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })}>
                    <option value="">Select Qualification...</option>
                    {QUALIFICATIONS.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Designation</span>
                  <select value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })}>
                    <option value="">Select Designation...</option>
                    {DESIGNATIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>

                <div style={{ gridColumn: "span 2", background: "#f8fafc", padding: 14, borderRadius: 12, border: "1px solid #e2e8f0" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                    🏥 Clinic & Hospital Branch Access (Multi-Tenancy RBAC)
                  </span>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "#ffffff", padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12, fontWeight: 700, color: '#3730a3' }}>
                      <input
                        type="checkbox"
                        checked={form.assigned_clinics?.includes("ALL")}
                        onChange={() => toggleClinicSelection("ALL")}
                      />
                      🌐 All Clinics (Full Enterprise Access)
                    </label>
                    {clinics.map((c) => (
                      <label key={c.code || c.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "#ffffff", padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                        <input
                          type="checkbox"
                          checked={form.assigned_clinics?.includes(c.code) && !form.assigned_clinics?.includes("ALL")}
                          onChange={() => toggleClinicSelection(c.code)}
                        />
                        🏥 {c.name || c.code} ({c.code})
                      </label>
                    ))}
                  </div>
                </div>

                <div className="um-signature-block">
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Digital Signature Stamp</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ marginTop: 6 }}
                      onChange={(e) => setForm({ ...form, signature: e.target.files[0] || null })}
                    />
                  </div>
                  {signaturePreview ? (
                    <div className="um-signature-preview">
                      <img src={signaturePreview} alt="Signature Preview" />
                    </div>
                  ) : (
                    <div className="um-signature-preview" style={{ color: '#94a3b8', fontSize: 11 }}>
                      No Signature
                    </div>
                  )}
                </div>

                <div className="um-form-actions">
                  <button type="button" className="um-btn" onClick={closeForm}>
                    Cancel
                  </button>
                  <button type="submit" className="um-btn um-btn-primary" disabled={saving}>
                    {saving ? "Saving..." : "Save User Account"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* USER LIST TABLE CARD */}
        <section className="um-table-shell">
          {loading && (
            <div className="um-state">
              <Activity size={24} className="animate-spin inline-block mb-2 text-indigo-600" /><br />
              Loading User Accounts & Permissions...
            </div>
          )}
          {error && <div className="um-state um-error">{error}</div>}
          {!loading && !error && users.length === 0 && <div className="um-state">No users found.</div>}

          {!loading && users.length > 0 && (
            <div className="um-table-wrap">
              <table className="um-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>User & Full Name</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Assigned Clinics</th>
                    <th>Qualification</th>
                    <th>Signature</th>
                    <th>Status</th>
                    <th style={{ textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, index) => {
                    const assigned = Array.isArray(u.assigned_clinics) ? u.assigned_clinics : ["ALL"];
                    return (
                      <tr key={u.id}>
                        <td>{index + 1}</td>
                        <td>
                          <div className="um-user-cell">
                            <div className="um-avatar">
                              {getInitials(u.full_name || u.username)}
                            </div>
                            <span style={{ fontWeight: 800, color: '#0f172a' }}>
                              {u.title ? `${u.title} ` : ""}{u.full_name || u.username}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>
                            {u.username}
                          </span>
                        </td>
                        <td>
                          <span className={`um-role-badge role-${u.role?.toLowerCase()}`}>
                            {u.role}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {assigned.includes("ALL") ? (
                              <span style={{ background: '#e0e7ff', color: '#3730a3', fontSize: 11, padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                                🌐 All Clinics
                              </span>
                            ) : (
                              assigned.map(c => (
                                <span key={c} style={{ background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>
                                  🏥 {c}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td>{u.qualification || "-"}</td>
                        <td>
                          {u.signature_url ? (
                            <img
                              className="um-signature-thumb"
                              src={apiUrl(u.signature_url)}
                              alt="signature"
                              onClick={() => window.open(apiUrl(u.signature_url), "_blank")}
                            />
                          ) : (
                            <span className="um-muted">-</span>
                          )}
                        </td>
                        <td>
                          {u.role === "ADMIN" ? (
                            <span className="um-status active">Active</span>
                          ) : (
                            <button
                              className={`um-switch ${u.is_active ? "is-on" : "is-off"}`}
                              onClick={() => toggleUser(u.id)}
                              aria-label={u.is_active ? "Set inactive" : "Set active"}
                              title={u.is_active ? "Active" : "Inactive"}
                            >
                              <span className="um-switch-knob" />
                            </button>
                          )}
                        </td>
                        <td>
                          <div className="um-actions" style={{ justifyContent: 'center' }}>
                            <button className="um-btn um-btn-small" onClick={() => openEditForm(u)}>
                              <Edit3 size={13} /> Edit
                            </button>
                            <button className="um-btn um-btn-small um-btn-danger" onClick={() => deleteUser(u.id)}>
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
        </section>
      </div>
    </MainLayout>
  );
}
