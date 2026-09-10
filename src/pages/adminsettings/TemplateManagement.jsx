// src/pages/adminsettings/TemplateManagement.jsx
import React, { useState, useEffect } from "react";
import MainLayout from "../../layout/MainLayout";
import { FileText } from "lucide-react";
import "./TemplateManagement.css";
import "./AdminManagement.css";
import api from "../../api/axios";

export default function TemplateManagement() {
  const activeMain = "Templates";
  const [activeSub, setActiveSub] = useState("View Templates");
  const [editingId, setEditingId] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [selectedModalityFilter, setSelectedModalityFilter] = useState("ALL");

  const [templateName, setTemplateName] = useState("");
  const [isTemplateNameManual, setIsTemplateNameManual] = useState(false);
  const [templateModality, setTemplateModality] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [templateType, setTemplateType] = useState("");
  const [History, setHistory] = useState("");
  const [findings, setFindings] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [modalities, setModalities] = useState([]);
  const [_bodyParts, setBodyParts] = useState([]);

  const sections = { Templates: ["View Templates", "Add Template"] };

  /* ============================
     FETCH EXISTING TEMPLATES
  ============================ */
  const fetchTemplates = async () => {
    try {
      const { data } = await api.get("/api/report-templates");
      setTemplates(data || []);
    } catch (err) {
      console.error("Fetch templates error:", err);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  /* ============================
     FETCH MODALITIES
  ============================ */
  useEffect(() => {
    api.get("/api/modalities")
      .then(({ data }) => setModalities(data || []))
      .catch(err => console.error("Fetch modalities error:", err));
  }, []);

  /* ============================
     FETCH BODY PARTS
  ============================ */
  useEffect(() => {
    if (!templateModality) {
      setBodyParts([]);
      return;
    }

    const selected = modalities.find(m => m.code === templateModality);
    if (!selected) return;

    api.get(`/api/body-parts?modality_id=${selected.id}`)
      .then(({ data }) => setBodyParts(data || []))
      .catch(err => console.error("Fetch body parts error:", err));
  }, [templateModality, modalities]);

  /* ============================
     AUTO-GENERATE TEMPLATE NAME
  ============================ */
  useEffect(() => {
    if (!isTemplateNameManual && templateModality && templateBody) {
      const typePart = templateType ? `_${templateType}` : "";
      setTemplateName(`${templateModality}_${templateBody}${typePart}`);
    }
  }, [templateModality, templateBody, templateType, isTemplateNameManual]);

  /* ============================
     DEFAULT TEMPLATE
  ============================ */
  const fillDefaultTemplate = () => {
    setHistory("Routine clinical examination.");
    setFindings("<p><b>FINDINGS:</b> Normal anatomical landmarks. No abnormal signal intensity or focal lesion identified.</p>");
    setConclusion("<p><b>IMPRESSION:</b> Unremarkable study within normal limits.</p>");
  };

  /* ============================
     ADD / UPDATE TEMPLATE
  ============================ */
  const handleAddTemplate = async () => {
    if (!templateModality || !templateBody) {
      alert("Please fill at least Modality and Body Part");
      return;
    }

    const isEditMode = Boolean(editingId);

    const payload = {
      template_name: templateName.trim() || null,
      modality: templateModality,
      body_part: templateBody,
      template_type: templateType || "normal",
      content: {
        history: History,
        findings,
        conclusion,
      },
    };

    try {
      if (isEditMode) {
        await api.put(`/api/report-templates/${editingId}`, payload);
        alert("Template updated successfully");
      } else {
        await api.post(`/api/report-templates`, payload);
        alert("Template added successfully");
      }

      await fetchTemplates();

      setEditingId(null);
      setTemplateModality("");
      setTemplateBody("");
      setTemplateType("");
      setTemplateName("");
      setIsTemplateNameManual(false);
      setHistory("");
      setFindings("");
      setConclusion("");
      setActiveSub("View Templates");
    } catch (err) {
      console.error(err);
      alert("Failed to save template");
    }
  };

  /* ============================
     DELETE TEMPLATE
  ============================ */
  const deleteTemplate = async (id) => {
    if (!window.confirm("Delete this structured template?")) return;

    try {
      await api.delete(`/api/report-templates/${id}`);
      await fetchTemplates();
    } catch (err) {
      console.error(err);
      alert("Failed to delete template");
    }
  };

  /* ============================
     EDIT TEMPLATE
  ============================ */
  const handleEditTemplate = (template) => {
    setEditingId(template.id);
    setTemplateModality(template.modality);
    setTemplateBody(template.body_part);
    setTemplateType(template.template_type || "");
    setTemplateName(template.template_name);
    setHistory(template.content?.history || "");
    setFindings(template.content?.findings || "");
    setConclusion(template.content?.conclusion || "");
    setActiveSub("Add Template");
  };

  const filteredTemplates = templates.filter(t => {
    if (selectedModalityFilter === "ALL") return true;
    return (t.modality || "").toUpperCase() === selectedModalityFilter.toUpperCase();
  });

  return (
    <MainLayout>
      <div className="tm-container">
        {/* HERO HEADER BAR */}
        <header className="adm-header">
          <div className="adm-title-box">
            <div className="adm-icon-wrapper">
              <FileText size={22} />
            </div>
            <div>
              <span className="adm-badge">Structured Reporting Studio</span>
              <h1 className="adm-title">
                {editingId ? "Update Structured Template" : "Radiology Structured Template Studio"}
              </h1>
              <p className="adm-subtitle">
                Manage DICOM structured reporting templates, auto-fill macros, and modality-specific findings.
              </p>
            </div>
          </div>
        </header>

        <div className="sub-buttons-container">
          {sections[activeMain].map(sub => (
            <button
              key={sub}
              className={`sub-btn ${activeSub === sub ? "active" : ""}`}
              onClick={() => setActiveSub(sub)}
            >
              {sub}
            </button>
          ))}
        </div>

        {activeSub === "Add Template" && (
          <div className="add-template-container">
            <label>Modality</label>
            <input
              list="modality-list"
              className="input-box"
              value={templateModality}
              onChange={e => setTemplateModality(e.target.value.toUpperCase())}
              placeholder="Select or type modality (e.g., CT, MRI, MG, US, CR, EC)"
            />
            <datalist id="modality-list">
              <option value="CT">CT (Computed Tomography)</option>
              <option value="MRI">MRI (Magnetic Resonance Imaging)</option>
              <option value="MG">MG (Mammography & Tomosynthesis)</option>
              <option value="US">US (Ultrasound & Color Doppler)</option>
              <option value="CR">CR (Digital X-Ray / Radiography)</option>
              <option value="EC">EC (2D Echocardiography)</option>
            </datalist>

            <label>Body Part / Specialty</label>
            <input
              list="bodypart-list"
              className="input-box"
              value={templateBody}
              onChange={e => setTemplateBody(e.target.value)}
              placeholder="Select or type body part (e.g., Head, Heart, Breast, Spine, Knee, KUB)"
            />
            <datalist id="bodypart-list">
              <option value="Head">Head / Neuro</option>
              <option value="Heart">Heart / Cardiac / Angio</option>
              <option value="Breast">Breast / BI-RADS</option>
              <option value="Chest">Chest / Thorax</option>
              <option value="Abdomen">Abdomen & Pelvis</option>
              <option value="Spine">Lumbar & Cervical Spine</option>
              <option value="Extremity">Extremity / Vascular Doppler</option>
              <option value="KUB">KUB & Prostate</option>
            </datalist>

            <label>Template Type / Protocol</label>
            <select
              className="input-box"
              value={templateType}
              onChange={e => setTemplateType(e.target.value)}
            >
              <option value="normal">Normal / Screening</option>
              <option value="plain">Plain / Non-Contrast</option>
              <option value="contrast">Contrast / Angiography</option>
            </select>

            <label>Template Title / Clinical Name</label>
            <input
              type="text"
              className="input-box"
              value={templateName}
              onChange={(e) => {
                setTemplateName(e.target.value);
                setIsTemplateNameManual(true);
              }}
              placeholder="e.g. Digital Mammography Bilateral (BI-RADS Protocol)"
            />

            <label>Clinical History</label>
            <textarea
              className="input-box"
              rows="2"
              value={History}
              onChange={e => setHistory(e.target.value)}
            />

            <label>Technique & Findings (Rich HTML / Structured Paragraphs)</label>
            <textarea
              className="input-box font-mono text-xs"
              rows="8"
              value={findings}
              onChange={e => setFindings(e.target.value)}
              placeholder="Use <p>, <b>, <ul>, <li> tags for structured findings..."
            />

            <label>Impression / Conclusion & Recommendations</label>
            <textarea
              className="input-box font-mono text-xs"
              rows="4"
              value={conclusion}
              onChange={e => setConclusion(e.target.value)}
              placeholder="Use <p><b>IMPRESSION:</b></p><ul><li>Conclusion bullet points</li></ul>"
            />

            <div className="button-group">
              <button className="default-btn" onClick={fillDefaultTemplate}>
                Fill Sample Text
              </button>
              <button className="add-btn" onClick={handleAddTemplate}>
                {editingId ? "Update Template" : "Save Template"}
              </button>
            </div>
          </div>
        )}

        {activeSub === "View Templates" && (
          <div>
            {/* MODALITY QUICK FILTER TABS */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, background: '#f8fafc', padding: 8, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              {["ALL", "CT", "MRI", "MG", "US", "CR", "EC", "XA", "PT"].map(m => (
                <button
                  key={m}
                  onClick={() => setSelectedModalityFilter(m)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: selectedModalityFilter === m ? '2px solid #4338ca' : '1px solid #cbd5e1',
                    background: selectedModalityFilter === m ? '#4338ca' : '#ffffff',
                    color: selectedModalityFilter === m ? '#ffffff' : '#475569',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {m === "ALL" ? "🌐 All Modalities" : m === "MG" ? "🎀 MG (Mammo)" : m === "US" ? "🌊 US / Doppler" : m === "EC" ? "❤️ ECHO" : m === "XA" ? "💉 XA (Angio/DSA)" : m === "PT" ? "☢️ PET-CT" : `📡 ${m}`}
                  {` (${templates.filter(t => m === "ALL" || (t.modality || "").toUpperCase() === m).length})`}
                </button>
              ))}
            </div>

            <table className="template-table">
              <thead>
                <tr>
                  <th>Modality</th>
                  <th>Template Name</th>
                  <th>Body Part / Specialty</th>
                  <th>Type</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
                      No templates found for this modality filter.
                    </td>
                  </tr>
                ) : (
                  filteredTemplates.map(t => (
                    <tr key={t.id}>
                      <td>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          background: t.modality === 'CT' ? '#eff6ff' : t.modality === 'MRI' ? '#faf5ff' : t.modality === 'MG' ? '#fdf2f8' : t.modality === 'US' ? '#f0fdf4' : '#f8fafc',
                          color: t.modality === 'CT' ? '#1d4ed8' : t.modality === 'MRI' ? '#6b21a8' : t.modality === 'MG' ? '#be185d' : t.modality === 'US' ? '#15803d' : '#334155',
                          border: '1px solid currentColor'
                        }}>
                          {t.modality}
                        </span>
                      </td>
                      <td><strong>{t.template_name}</strong></td>
                      <td>{t.body_part}</td>
                      <td><span style={{ fontSize: 11, textTransform: 'capitalize', color: '#64748b' }}>{t.template_type}</span></td>
                      <td>
                        <button className="edit-btn" onClick={() => handleEditTemplate(t)}>
                          Edit
                        </button>
                        <button className="delete-btn" onClick={() => deleteTemplate(t.id)}>
                          Delete
                        </button>
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
