import React, { useEffect, useMemo, useState } from "react";
import ProtectedRoute from "../../components/ProtectedRoute";
import MainLayout from "../../layout/MainLayout";
import api, { apiUrl } from "../../api/axios";
import "./UserManagement.css";

const EMPTY_FORM = {
  id: null,
  title: "Dr.",
  full_name: "",
  email: "",
  qualification: "MBBS, MD (Radiology)",
  designation: "Consultant Radiologist",
  registration_number: "",
  specialty: "Radiodiagnosis & Imaging",
  signature: null,
  signature_url: "",
};

const TITLES = ["Dr.", "Prof. Dr.", "Dr. (Mrs)", "Dr. (Col)"];

function ReportedBy() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

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

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await api.get("/api/reported-by");
      if (!Array.isArray(res.data)) throw new Error("Unexpected response from server");
      setUsers(res.data);
    } catch (err) {
      console.error("Fetch reported by users error:", err);
      setError(err.response?.data?.error || "Failed to fetch users");
    } finally {
      setLoading(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const openAddForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const editUser = (u) => {
    setForm({
      id: u.id,
      title: u.title || "Dr.",
      full_name: u.full_name || "",
      email: u.email || "",
      qualification: u.qualification || "",
      designation: u.designation || "",
      registration_number: u.registration_number || "",
      specialty: u.specialty || "",
      signature: null,
      signature_url: u.signature_url || "",
    });
    setShowForm(true);
  };

  const saveUser = async (e) => {
    e.preventDefault();
    if (!form.full_name) {
      alert("Doctor Full Name is required");
      return;
    }

    try {
      setSaving(true);
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("full_name", form.full_name);
      fd.append("email", form.email || "");
      fd.append("qualification", form.qualification);
      fd.append("designation", form.designation);
      fd.append("registration_number", form.registration_number);
      fd.append("specialty", form.specialty);
      if (form.signature) fd.append("signature", form.signature);

      let res;
      if (form.id) {
        res = await api.put(`/api/reported-by/${form.id}`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setUsers((prev) => prev.map((u) => (u.id === form.id ? { ...u, ...res.data } : u)));
      } else {
        res = await api.post("/api/reported-by", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        setUsers((prev) => [...prev, res.data]);
      }

      closeForm();
    } catch (err) {
      console.error("Save reported by user failed:", err);
      alert(err.response?.data?.error || "Failed to save reporting doctor");
    } finally {
      setSaving(false);
    }
  };


  const deleteUser = async (id) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try {
      await api.delete(`/api/reported-by/${id}`);
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete user");
    }
  };

  return (
    <MainLayout>
      <div className="um-page">
        <div className="um-header">
          <h2>Reporting Radiologists / Doctors Management</h2>
          <div className="um-header-actions">
            <button className="um-btn um-btn-primary" onClick={openAddForm}>
              + Add Reporting Doctor
            </button>
          </div>
        </div>

        <section className="um-table-shell">
          {loading && <div className="um-state">Loading reporting doctors...</div>}
          {error && <div className="um-state um-error">{error}</div>}
          {!loading && !error && users.length === 0 && <div className="um-state">No reporting doctors found.</div>}

          {!loading && users.length > 0 && (
            <div className="um-table-wrap">
              <table className="um-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Doctor Name</th>
                    <th>Medical License / Reg No</th>
                    <th>Qualification</th>
                    <th>Designation</th>
                    <th>Specialty</th>
                    <th>Signature</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, index) => (
                    <tr key={u.id}>
                      <td>{index + 1}</td>
                      <td><strong>{u.title || "Dr."} {u.full_name}</strong></td>
                      <td><span style={{ fontFamily: "monospace", fontWeight: "bold", color: "#0284c7" }}>{u.registration_number || "-"}</span></td>
                      <td>{u.qualification || "-"}</td>
                      <td>{u.designation || "-"}</td>
                      <td>{u.specialty || "-"}</td>
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
                        <div className="um-actions">
                          <button className="um-btn um-btn-small" onClick={() => editUser(u)}>
                            Edit
                          </button>
                          <button className="um-btn um-btn-small um-btn-danger" onClick={() => deleteUser(u.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {showForm && (
          <div className="um-modal-backdrop" onClick={closeForm}>
            <section className="um-form-shell um-modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="um-form-top">
                <div>
                  <h3>{form.id ? "Edit Reporting Doctor Profile" : "Add Reporting Doctor Profile"}</h3>
                  <p>{form.id ? "Update medical qualifications and digital signature" : "Create a new radiologist profile for diagnostic report verification"}</p>
                </div>
                <button type="button" className="um-close-link" onClick={closeForm}>
                  Cancel
                </button>
              </div>

              <form onSubmit={saveUser} className="um-form-grid">
                <label>
                  <span>Title</span>
                  <select value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}>
                    {TITLES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>Doctor Full Name <span style={{ color: "red" }}>*</span></span>
                  <input
                    type="text"
                    placeholder="e.g. Rajesh Kumar"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    required
                  />
                </label>

                <label>
                  <span>Medical Registration / License No</span>
                  <input
                    type="text"
                    placeholder="e.g. KMC/Reg-88741/2019"
                    value={form.registration_number}
                    onChange={(e) => setForm({ ...form, registration_number: e.target.value })}
                  />
                </label>

                <label>
                  <span>Qualifications</span>
                  <input
                    type="text"
                    placeholder="e.g. MBBS, MD (Radiology), FRCR"
                    value={form.qualification}
                    onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                  />
                </label>

                <label>
                  <span>Designation</span>
                  <input
                    type="text"
                    placeholder="e.g. Senior Consultant Radiologist"
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  />
                </label>

                <label>
                  <span>Specialty / Subspecialty</span>
                  <input
                    type="text"
                    placeholder="e.g. Neuroradiology & Body Imaging"
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  />
                </label>

                <label>
                  <span>Email (Optional)</span>
                  <input
                    type="email"
                    placeholder="doctor@hospital.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </label>


                <div className="um-signature-block">
                  <span>Signature</span>
                  <div className="um-signature-upload">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setForm({ ...form, signature: e.target.files?.[0] || null })}
                    />
                    <small>Upload PNG/JPG signature image</small>
                  </div>
                  <div className="um-signature-preview">
                    {signaturePreview ? (
                      <img
                        src={signaturePreview}
                        alt="signature preview"
                        onClick={() => window.open(signaturePreview, "_blank")}
                      />
                    ) : (
                      <div className="um-signature-empty">No signature</div>
                    )}
                  </div>
                </div>

                <div className="um-form-actions">
                  <button type="submit" className="um-btn um-btn-primary" disabled={saving}>
                    {saving ? "Saving..." : form.id ? "Update" : "Create"}
                  </button>
                  <button type="button" className="um-btn" onClick={closeForm} disabled={saving}>
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </MainLayout>
  );
}

export default function AdminReportedByPage() {
  return (
    <ProtectedRoute roles={["ADMIN"]}>
      <ReportedBy />
    </ProtectedRoute>
  );
}
