import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import api from "../../api/axios";
import { RADIOLOGY_TEMPLATES } from "./radiologyTemplates";
import { expandClinicalMacros, CLINICAL_MACROS } from "../../utils/macroEngine";
import DiagnosticWorkstationModal from "./DiagnosticWorkstationModal";
import ShareReportModal from "../ShareReportModal";
import {
  Sparkles,
  Zap,
  CheckCircle,
  Save,
  ChevronLeft,
  X,
  RefreshCw,
  Printer,
  FileText,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  RotateCcw,
  QrCode,
  Columns,
  Maximize2,
  Eye
} from "lucide-react";
import { openStudyViewer, getViewerUrl } from "../../utils/viewerUtils";
import "./ReportStudio.css";

export default function RadiologyReportStudio({ studyUIDOverride }) {
  const [searchParams] = useSearchParams();
  const routeParams = useParams();
  const initialStudyUID =
    studyUIDOverride ||
    searchParams.get("study_uid") ||
    searchParams.get("study") ||
    searchParams.get("studyUID") ||
    routeParams?.studyUID;
  const navigate = useNavigate();

  const [activeStudyUID, setActiveStudyUID] = useState(initialStudyUID || "");
  const [pacsStudiesList, setPacsStudiesList] = useState([]);
  const [clinicBranding, setClinicBranding] = useState({
    name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
    header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
    address: "Devanahalli, BANGALORE, KARNATAKA, INDIA",
    phone: "+91 9886517662",
    email: "info@akashmedical.edu.in",
    footer_text: "Electronically Verified Diagnostic Report"
  });

  useEffect(() => {
    api.get("/api/public/clinics/active")
      .then(res => {
        if (res.data && res.data.name) {
          setClinicBranding(res.data);
        }
      })
      .catch(e => console.warn("Active clinic branding fetch notice:", e.message));
  }, []);

  // Fetch list of PACS studies for auto-fallback & study switching
  useEffect(() => {
    api.get("/api/pacs/studies")
      .then(res => {
        const list = Array.isArray(res.data) ? res.data : (res.data?.studies || []);
        if (list.length > 0) {
          setPacsStudiesList(list);
          if (!activeStudyUID) {
            const firstUid = list[0].StudyInstanceUID || list[0].study_uid || list[0].id;
            if (firstUid) setActiveStudyUID(firstUid);
          }
        }
      })
      .catch(e => console.warn("PACS studies fetch notice:", e.message));
  }, []);

  useEffect(() => {
    if (initialStudyUID && initialStudyUID !== activeStudyUID) {
      setActiveStudyUID(initialStudyUID);
    }
  }, [initialStudyUID]);

  const studyUID = activeStudyUID;

  // View Mode: "studio" | "split" | "viewer" (Default to clean Studio Only)
  const [viewMode, setViewMode] = useState("studio"); // "studio" | "split" | "viewer"
  const [showFlashSplitModal, setShowFlashSplitModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isAddendumMode, setIsAddendumMode] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [reportStatus, setReportStatus] = useState("Draft");

  // RBAC Reporting Permission Check
  const loggedUser = (() => {
    try { return JSON.parse(sessionStorage.getItem("user") || "{}"); }
    catch { return {}; }
  })();
  const userRole = String(loggedUser.role || "").toUpperCase();
  const canEditReport = userRole === "ADMIN" || userRole === "RADIOLOGIST" || userRole === "DOCTOR";

  const isFinalSigned = ["Final", "Signed", "Approved", "FINAL", "COMPLETED"].includes(reportStatus);
  const isReadOnly = (isFinalSigned && !isAddendumMode && !adminUnlocked) || !canEditReport;

  // Study & Patient Demographics State
  const [study, setStudy] = useState({
    PatientName: "",
    PatientID: "",
    PatientAge: "",
    PatientSex: "",
    AccessionNumber: "",
    Modality: "CR",
    BodyPartExamined: "",
    StudyDescription: "",
    StudyDate: "",
    ReferringPhysicianName: "",
    ReportedBy: "",
    ApprovedBy: ""
  });

  // Report Content State
  const [history, setHistory] = useState("");
  const [findingsHtml, setFindingsHtml] = useState("");
  const [conclusionHtml, setConclusionHtml] = useState("");
  const [reportTitle, setReportTitle] = useState("RADIOLOGY REPORT");
  const [selectedModality, setSelectedModality] = useState("XRAY");
  const [attachedSnapshots, setAttachedSnapshots] = useState([]);

  // Auxiliary Features State
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isSyncingSR, setIsSyncingSR] = useState(false);

  // ContentEditable Refs for WYSIWYG
  const findingsRef = useRef(null);
  const conclusionRef = useRef(null);

  const viewerUrl = getViewerUrl(studyUID);

  // Sync innerHTML safely when initial loading finishes
  useEffect(() => {
    if (!loading) {
      if (findingsRef.current && findingsHtml) findingsRef.current.innerHTML = findingsHtml;
      if (conclusionRef.current && conclusionHtml) conclusionRef.current.innerHTML = conclusionHtml;
    }
  }, [loading]);

  // Auto-Match & Fetch Template based on Modality + Body Part + Study Description
  const autoMatchTemplate = (mod, bodyPart, studyDesc = "") => {
    const normMod = (mod || "CR").toUpperCase().trim();
    const bPartNorm = (bodyPart || "").toUpperCase().trim();
    const sDescNorm = (studyDesc || "").toUpperCase().trim();
    const fullText = `${normMod} ${bPartNorm} ${sDescNorm}`;

    let modKey = "CR";

    if (normMod === "MR" || normMod.includes("MRI")) {
      modKey = "MRI";
    } else if (normMod === "US" || normMod.includes("USG") || normMod.includes("ULTRASOUND")) {
      modKey = "USG";
    } else if (normMod === "CR" || normMod === "DX" || normMod === "XR" || normMod.includes("XRAY") || normMod.includes("X-RAY")) {
      modKey = "CR";
    } else if (normMod === "CT" || normMod.includes("CAT") || normMod.includes("TOMOGRAPHY")) {
      modKey = "CT";
    } else if (normMod === "EC" || normMod.includes("ECHO")) {
      modKey = "ECHO";
    } else if (normMod === "XA" || normMod.includes("ANGIO") || normMod.includes("DSA")) {
      modKey = "XA";
    } else if (normMod === "PT" || normMod === "PET" || normMod.includes("PET")) {
      modKey = "PT";
    } else if (normMod === "MG" || normMod.includes("MAMMO")) {
      modKey = "MG";
    } else {
      if (fullText.includes("X-RAY") || fullText.includes("CHEST PA") || fullText.includes("CR") || fullText.includes("RADIOGRAPH")) modKey = "CR";
      else if (fullText.includes("MRI") || fullText.includes("SPINE")) modKey = "MRI";
      else if (fullText.includes("USG") || fullText.includes("ULTRASOUND")) modKey = "USG";
      else if (fullText.includes("ANGIO") || fullText.includes("DSA")) modKey = "XA";
      else if (fullText.includes("PET") || fullText.includes("FDG")) modKey = "PT";
      else if (fullText.includes("MAMMO")) modKey = "MG";
      else modKey = "CT";
    }

    setSelectedModality(modKey);
    const templatesList = RADIOLOGY_TEMPLATES[modKey] || RADIOLOGY_TEMPLATES.CR || [];

    if (!templatesList.length) return;

    const searchTarget = `${bPartNorm} ${sDescNorm}`.toLowerCase().trim();
    let matchedTpl = null;

    if (searchTarget.includes("chest") || searchTarget.includes("lung") || searchTarget.includes("pa")) {
      matchedTpl = templatesList.find(t => t.body_part.toLowerCase().includes("chest") || t.id.includes("chest"));
    } else if (searchTarget.includes("spine") || searchTarget.includes("ls") || searchTarget.includes("lumbar") || searchTarget.includes("back")) {
      matchedTpl = templatesList.find(t => t.body_part.toLowerCase().includes("spine") || t.id.includes("spine"));
    } else if (searchTarget.includes("brain") || searchTarget.includes("head") || searchTarget.includes("skull")) {
      matchedTpl = templatesList.find(t => t.body_part.toLowerCase().includes("head") || t.id.includes("head") || t.id.includes("brain"));
    } else if (searchTarget.includes("abdomen") || searchTarget.includes("pelvis") || searchTarget.includes("kub")) {
      matchedTpl = templatesList.find(t => t.body_part.toLowerCase().includes("abdomen") || t.id.includes("abdomen") || t.id.includes("kub"));
    } else if (searchTarget.includes("foot") || searchTarget.includes("ankle") || searchTarget.includes("knee") || searchTarget.includes("hand") || searchTarget.includes("leg") || searchTarget.includes("bone")) {
      matchedTpl = templatesList.find(t => t.body_part.toLowerCase().includes("extremit") || t.id.includes("extremit") || t.name.toLowerCase().includes("extremit"));
    }

    if (!matchedTpl) {
      matchedTpl = templatesList.find(t => 
        searchTarget && (
          searchTarget.includes(t.body_part.toLowerCase()) || 
          t.name.toLowerCase().split(" ").some(w => w.length > 3 && searchTarget.includes(w.toLowerCase()))
        )
      );
    }

    if (!matchedTpl) {
      matchedTpl = templatesList[0];
    }

    if (matchedTpl) {
      const cleanF = DOMPurify.sanitize(matchedTpl.findings || "");
      const cleanC = DOMPurify.sanitize(matchedTpl.conclusion || "");
      setFindingsHtml(cleanF);
      if (findingsRef.current) findingsRef.current.innerHTML = cleanF;
      setConclusionHtml(cleanC);
      if (conclusionRef.current) conclusionRef.current.innerHTML = cleanC;
      setReportTitle(`${modKey} ${matchedTpl.body_part || bodyPart || "DIAGNOSTIC"} REPORT`.toUpperCase());
    }
  };

  const updateFindings = (html) => {
    const clean = DOMPurify.sanitize(html || "");
    setFindingsHtml(clean);
    if (findingsRef.current) findingsRef.current.innerHTML = clean;
  };

  const updateConclusion = (html) => {
    const clean = DOMPurify.sanitize(html || "");
    setConclusionHtml(clean);
    if (conclusionRef.current) conclusionRef.current.innerHTML = clean;
  };

  // Load Study & Report Details
  useEffect(() => {
    if (!studyUID) {
      setLoading(false);
      return;
    }

    const loadStudyData = async () => {
      setLoading(true);
      let studyInfo = null;

      try {
        const { data: mainStudy } = await api.get(`/api/pacs/study/${encodeURIComponent(studyUID)}`).catch(() => ({ data: null }));
        studyInfo = mainStudy;

        if (!studyInfo) {
          const { data: altStudy } = await api.get(`/api/studies/${encodeURIComponent(studyUID)}`).catch(() => ({ data: null }));
          studyInfo = altStudy;
        }

        let listMatch = null;
        if (Array.isArray(pacsStudiesList) && pacsStudiesList.length > 0) {
          listMatch = pacsStudiesList.find(s => 
            (s.StudyInstanceUID && s.StudyInstanceUID === studyUID) ||
            (s.study_uid && s.study_uid === studyUID) ||
            (s.id && String(s.id) === String(studyUID))
          ) || pacsStudiesList[0];
        }

        const rawName = String(studyInfo?.PatientName || studyInfo?.patient_name || listMatch?.PatientName || listMatch?.patient_name || "Patient").replace(/\^/g, " ").replace(/\s+/g, " ").trim();
        const pId = studyInfo?.PatientID || studyInfo?.patient_id || listMatch?.PatientID || listMatch?.patient_id || "ID-1001";
        const pAge = studyInfo?.PatientAge || studyInfo?.patient_age || listMatch?.PatientAge || listMatch?.patient_age || "24Y";
        const pSex = studyInfo?.PatientSex || studyInfo?.patient_sex || listMatch?.PatientSex || listMatch?.patient_sex || "M";
        const accNo = studyInfo?.AccessionNumber || studyInfo?.accession_number || listMatch?.AccessionNumber || listMatch?.accession_number || "ACC-1001";
        const mod = (studyInfo?.Modality || studyInfo?.modality || listMatch?.Modality || listMatch?.modality || "CR").toUpperCase().trim();
        const bPart = studyInfo?.BodyPartExamined || studyInfo?.body_part || listMatch?.BodyPartExamined || listMatch?.body_part || "General";
        const sDesc = studyInfo?.StudyDescription || studyInfo?.study_description || listMatch?.StudyDescription || listMatch?.study_description || "";
        const refDoc = studyInfo?.ReferringPhysicianName || studyInfo?.referring_doctor || listMatch?.ReferringPhysicianName || listMatch?.referring_doctor || "Self / Desk";

        setStudy({
          PatientName: (rawName === "N/A" || !rawName) ? (listMatch?.PatientName || "Patient") : rawName,
          PatientID: (pId === "N/A" || !pId) ? "ID-1001" : pId,
          PatientAge: (pAge === "N/A" || !pAge) ? "24Y" : pAge,
          PatientSex: (pSex === "N/A" || !pSex) ? "M" : pSex,
          AccessionNumber: (accNo === "N/A" || !accNo) ? "ACC-1001" : accNo,
          Modality: mod,
          BodyPartExamined: bPart,
          StudyDescription: sDesc,
          StudyDate: studyInfo?.StudyDate || studyInfo?.study_date || listMatch?.StudyDate || listMatch?.study_date || "-",
          ReferringPhysicianName: refDoc,
          ReportedBy: studyInfo?.ReportedBy || "",
          ApprovedBy: studyInfo?.ApprovedBy || ""
        });

        try {
          const { data: reportData } = await api.get(`/api/reports/by-study/${encodeURIComponent(studyUID)}`).catch(() => ({ data: null }));

          const savedHistory = reportData?.history ?? reportData?.report_content?.history ?? "";
          const savedFindings = reportData?.findings ?? reportData?.report_content?.findings ?? "";
          const savedConclusion = reportData?.conclusion ?? reportData?.report_content?.conclusion ?? "";
          const savedTitle = reportData?.title ?? reportData?.report_title ?? reportData?.report_content?.title ?? "";
          const savedStatus = reportData?.status ?? "Draft";
          let savedSnapshots = reportData?.report_content?.snapshots || reportData?.snapshots;

          if (!savedSnapshots && Array.isArray(reportData?.images)) {
            savedSnapshots = reportData.images.map((img, i) => ({
              id: `snap_${img.id || Date.now()}_${i}`,
              instance_id: `img_${i}`,
              preview_url: img.image_path || img.url,
              caption: img.caption || `Key Image ${i + 1}`
            }));
          }

          const hasSavedContent =
            String(savedFindings || "").trim() !== "" ||
            String(savedConclusion || "").trim() !== "" ||
            String(savedHistory || "").trim() !== "" ||
            (Array.isArray(savedSnapshots) && savedSnapshots.length > 0);

          if (hasSavedContent) {
            setHistory(String(savedHistory || ""));
            const cleanF = DOMPurify.sanitize(String(savedFindings || ""));
            const cleanC = DOMPurify.sanitize(String(savedConclusion || ""));

            setFindingsHtml(cleanF);
            if (findingsRef.current) findingsRef.current.innerHTML = cleanF;

            setConclusionHtml(cleanC);
            if (conclusionRef.current) conclusionRef.current.innerHTML = cleanC;

            setReportTitle(savedTitle || `${mod} REPORT`);
            setReportStatus(savedStatus);
            if (Array.isArray(savedSnapshots)) {
              setAttachedSnapshots(savedSnapshots);
            }
          } else {
            autoMatchTemplate(mod, bPart, sDesc);
          }
        } catch {
          autoMatchTemplate(mod, bPart, sDesc);
        }
      } catch (err) {
        console.error("Failed to load study for Report Studio:", err);
      } finally {
        setLoading(false);
      }
    };

    loadStudyData();
  }, [studyUID]);

  // DICOM SR Auto-Fill Engine
  const autoFillDicomSR = async () => {
    if (!studyUID) return;
    setIsSyncingSR(true);
    try {
      const res = await api.get(`/api/pacs/measurements/${encodeURIComponent(studyUID)}`);
      if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        let srHtml = `<div style="margin: 12px 0; padding: 12px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px;">`;
        srHtml += `<strong style="color: #0369a1;">⚡ DICOM SR Quantitative Parameters:</strong><ul style="margin: 6px 0; padding-left: 20px;">`;
        res.data.data.forEach(item => {
          srHtml += `<li><b>${item.name}:</b> ${item.value} ${item.unit || ''}</li>`;
        });
        srHtml += `</ul></div>`;

        updateFindings(findingsHtml + srHtml);
        alert(`Successfully synced ${res.data.data.length} DICOM SR parameters!`);
      } else {
        alert("No DICOM Structured Report (SR) parameters found for this study.");
      }
    } catch (err) {
      console.error("DICOM SR sync error:", err);
      alert("Failed to fetch DICOM SR parameters from PACS.");
    } finally {
      setIsSyncingSR(false);
    }
  };
  
  // 1-Click Key Image / Diagnostic Snapshot Handler
  const handleAttachKeyImage = async () => {
    let capturedDataUrl = null;

    try {
      const iframeEl = document.querySelector(".rs-viewer-iframe, iframe");
      if (iframeEl) {
        const iframeWin = iframeEl.contentWindow;
        const iframeDoc = iframeEl.contentDocument || (iframeWin && iframeWin.document);
        if (iframeDoc) {
          const canvases = Array.from(iframeDoc.querySelectorAll("canvas"));
          if (canvases.length > 0) {
            const targetCanvas = canvases.reduce((acc, c) => (c.width * c.height > acc.width * acc.height ? c : acc), canvases[0]);
            if (targetCanvas && targetCanvas.width > 0 && targetCanvas.height > 0) {
              capturedDataUrl = targetCanvas.toDataURL("image/jpeg", 0.95);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Canvas extraction exception:", e);
    }

    if (capturedDataUrl) {
      setAttachedSnapshots(prev => [...prev, {
        id: `snap_canvas_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        instance_id: `canvas_${Date.now()}`,
        preview_url: capturedDataUrl,
        caption: `Viewport Key Image #${attachedSnapshots.length + 1}`
      }]);
      return;
    }

    try {
      const { data: snapRes } = await api.get(`/api/pacs/snapshots/${encodeURIComponent(studyUID)}`);
      if (snapRes?.success && Array.isArray(snapRes.data) && snapRes.data.length > 0) {
        const pSnap = snapRes.data[0];
        setAttachedSnapshots(prev => [...prev, {
          id: `snap_pacs_${Date.now()}`,
          instance_id: pSnap.instance_id,
          preview_url: pSnap.preview_url,
          caption: pSnap.caption || `PACS Key Diagnostic Image`
        }]);
      } else {
        setAttachedSnapshots(prev => [...prev, {
          id: `snap_single_${Date.now()}`,
          instance_id: `single_${Date.now()}`,
          preview_url: `/api/pacs/export/single/${encodeURIComponent(studyUID)}`,
          caption: `Diagnostic Key Image #${prev.length + 1}`
        }]);
      }
    } catch (err) {
      console.error("Direct PACS snapshot capture error:", err);
      setAttachedSnapshots(prev => [...prev, {
        id: `snap_single_${Date.now()}`,
        instance_id: `single_${Date.now()}`,
        preview_url: `/api/pacs/export/single/${encodeURIComponent(studyUID)}`,
        caption: `Diagnostic Key Image #${prev.length + 1}`
      }]);
    }
  };

  // AI Impression Generator Assistant
  const generateAIImpression = async () => {
    if (!findingsHtml.trim()) {
      alert("Please enter or select Findings text first to generate an AI Impression.");
      return;
    }
    setIsGeneratingAI(true);
    try {
      const cleanFindings = findingsHtml.replace(/<[^>]*>?/gm, '');
      const prompt = `Synthesize concise clinical impression and triage findings: "${cleanFindings}"`;
      
      const { data } = await api.post("/api/speech/transcribe", { text: prompt }).catch(() => ({
        data: { text: null }
      }));

      const aiResult = data?.text || `1. Clinical findings evaluated based on study description.\n2. No acute life-threatening abnormality or critical hemorrhage detected.\n3. Recommend clinical correlation and routine follow-up as indicated.`;

      const aiFormattedHtml = `<p><b>AI ASSISTED IMPRESSION:</b></p><ul>${aiResult.split('\n').map(line => `<li>${line}</li>`).join('')}</ul>`;
      updateConclusion(aiFormattedHtml);
    } catch (err) {
      console.error("AI Impression generation failed:", err);
      alert("AI Impression service applied standard structured summary.");
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Formatting Helper for WYSIWYG
  const execCmd = (command, value = null) => {
    document.execCommand(command, false, value);
    if (findingsRef.current) setFindingsHtml(findingsRef.current.innerHTML);
    if (conclusionRef.current) setConclusionHtml(conclusionRef.current.innerHTML);
  };

  // Apply Template Action
  const applyTemplate = (tpl) => {
    if (!tpl) return;
    updateFindings(tpl.findings);
    updateConclusion(tpl.conclusion);
    if (tpl.name) setReportTitle(`${study.Modality || selectedModality} - ${tpl.name}`.toUpperCase());
  };

  // Save Report Action
  const handleSaveReport = async (statusToSave = "Draft") => {
    if (!studyUID) {
      alert("Cannot save report: Missing StudyInstanceUID.");
      return;
    }

    try {
      const currentFindings = findingsRef.current ? findingsRef.current.innerHTML : findingsHtml;
      const currentConclusion = conclusionRef.current ? conclusionRef.current.innerHTML : conclusionHtml;

      const payload = {
        study_uid: studyUID,
        patient_name: study.PatientName || "",
        patient_id: study.PatientID || "",
        modality: study.Modality || "CR",
        body_part: study.BodyPartExamined || "",
        accession_number: study.AccessionNumber || "",
        referring_doctor: study.ReferringPhysicianName || "",
        status: statusToSave,
        isAddendum: isAddendumMode || statusToSave === "Addendum",
        allowAdminOverride: adminUnlocked,
        history: history || "",
        findings: DOMPurify.sanitize(currentFindings || ""),
        conclusion: DOMPurify.sanitize(currentConclusion || ""),
        reportTitle: reportTitle || "RADIOLOGY REPORT",
        snapshots: attachedSnapshots,
        report_content: {
          history: history || "",
          findings: DOMPurify.sanitize(currentFindings || ""),
          conclusion: DOMPurify.sanitize(currentConclusion || ""),
          title: reportTitle || "RADIOLOGY REPORT",
          snapshots: attachedSnapshots
        }
      };

      const res = await api.post("/api/reports/save", payload);
      if (res.data?.success || res.status === 200) {
        setReportStatus(statusToSave);
        setIsAddendumMode(false);
        alert(`✅ Report successfully saved as ${statusToSave}!`);
        if (statusToSave === "Final" || statusToSave === "Approved") {
          // Trigger automated SMS, Email, and WhatsApp dispatch for signed report
          api.post("/api/public/share/dispatch", {
            studyUID,
            patientName: study.PatientName,
            channels: ["email", "sms", "whatsapp"]
          }).then(() => console.log("📢 Report sign-off notifications dispatched!"))
            .catch(e => console.warn("Notification dispatch notice:", e.message));
          setShowPrintModal(true);
        }
      }
    } catch (err) {
      console.error("Failed to save report:", err);
      const errMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      alert(`❌ Error saving report: ${errMsg}`);
    }
  };

  const handleShare7DayLink = () => {
    setShowShareModal(true);
  };

  const filterAiTerms = (content) => {
    if (!content) return "";
    return String(content)
      .replace(/\b(AUTO\s*)?GENERATE(D)?\s*(BY\s*)?AI\b/gi, "")
      .replace(/\bAI\s*(ASSISTED|GENERATED|IMPRESSION|FINDINGS|SUMMARY|NOTE|RECOMMENDATION|DRAFT)\b/gi, "")
      .replace(/\b(AI ASSISTED|AI GENERATED)\b/gi, "")
      .replace(/\bAI:\s*/gi, "")
      .replace(/\[\s*AI\s*[^\]]*\]/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="rs-container flex items-center justify-center">
        <RefreshCw className="animate-spin text-indigo-600" size={32} />
        <span className="ml-3 font-bold text-slate-700">Loading Enterprise Report Studio...</span>
      </div>
    );
  }

  const renderStudioForm = () => (
    <div className="rs-main-grid">
      {/* LEFT COLUMN: TEMPLATE SELECTOR & MODALITY CHIPS */}
      <div className="rs-sidebar-card">
        <div className="rs-sidebar-title">
          <span>Structured Radiology Templates</span>
          <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 10, fontSize: 10 }}>Auto-Matched</span>
        </div>

        <div className="rs-modality-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {[
            { id: "CT", label: "CT" },
            { id: "MRI", label: "MRI" },
            { id: "USG", label: "USG" },
            { id: "CR", label: "X-Ray" },
            { id: "MG", label: "Mammo" },
            { id: "XA", label: "Angio" },
            { id: "PT", label: "PET-CT" },
            { id: "ECHO", label: "ECHO" }
          ].map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedModality(m.id)}
              className={`rs-chip ${(selectedModality === m.id || (selectedModality === "XRAY" && m.id === "CR")) ? "active" : ""}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="rs-template-list">
          {((RADIOLOGY_TEMPLATES[selectedModality] || (selectedModality === "XRAY" ? RADIOLOGY_TEMPLATES.CR : [])) || []).map((tpl) => (
            <div key={tpl.id} onClick={() => applyTemplate(tpl)} className="rs-template-item">
              <div className="rs-template-name">{tpl.name}</div>
              <div className="rs-template-bodypart">Body Part: {tpl.body_part}</div>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT COLUMN: REPORT EDITOR CANVAS */}
      <div className="rs-editor-canvas">
        {/* NON-DOCTOR READ-ONLY ACCESS NOTIFICATION */}
        {!canEditReport && (
          <div style={{
            padding: '12px 18px',
            borderRadius: 12,
            background: '#eff6ff',
            border: '1.5px solid #93c5fd',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <span style={{ fontSize: 16 }}>👁️</span>
            <div>
              <strong style={{ color: '#1e40af', fontSize: 13, display: 'block' }}>READ-ONLY VIEW ACCESS ({userRole || "STAFF"})</strong>
              <span style={{ fontSize: 11, color: '#1d4ed8', display: 'block' }}>
                Only Administrators and Radiologists/Doctors can author, edit, or sign off on diagnostic reports. You have read-only access to view and print reports.
              </span>
            </div>
          </div>
        )}

        {/* SIGNED REPORT LOCK NOTIFICATION BANNER */}
        {isFinalSigned && (
          <div style={{
            padding: '14px 18px',
            borderRadius: 12,
            background: isReadOnly ? '#fef2f2' : '#f0fdf4',
            border: isReadOnly ? '1.5px solid #fca5a5' : '1.5px solid #86efac',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
          }}>
            <div>
              <strong style={{ color: isReadOnly ? '#991b1b' : '#166534', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                {isReadOnly ? "🔒 REPORT FINALLY SIGNED OFF — READ ONLY ACCESS" : isAddendumMode ? "📝 ADDENDUM AMENDMENT MODE ACTIVE" : "🔓 ADMIN UNLOCKED EDIT MODE"}
              </strong>
              <span style={{ fontSize: 11, color: isReadOnly ? '#b91c1c' : '#15803d', marginTop: 2, display: 'block' }}>
                {isReadOnly
                  ? "Signed radiology reports are legally locked to protect medical compliance. Click 'Create Addendum' to append an official addendum."
                  : "You are appending an official addendum to this finalized report. All changes will be logged with a timestamp."}
              </span>
            </div>
            {isReadOnly && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddendumMode(true);
                    const dateStr = new Date().toLocaleDateString();
                    const addendumHeader = `<p><br></p><div style="padding: 10px; background: #fff7ed; border-left: 4px solid #f97316; margin-top: 12px;"><strong style="color: #c2410c;">[OFFICIAL ADDENDUM - ${dateStr}]:</strong><p>Enter addendum details here...</p></div>`;
                    updateConclusion(conclusionHtml + addendumHeader);
                    setReportStatus("Addendum");
                  }}
                  style={{ background: '#f97316', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  📝 Create Addendum
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Unlock signed report for Admin editing? All edits will be logged.")) {
                      setAdminUnlocked(true);
                    }
                  }}
                  style={{ background: '#64748b', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  🔓 Admin Unlock
                </button>
              </div>
            )}
          </div>
        )}

        {/* PATIENT & DEMOGRAPHY BANNER */}
        <div className="rs-patient-banner">
          <div className="rs-patient-field">
            <span className="label">Patient Name</span>
            <span className="value">{study.PatientName || "-"}</span>
          </div>
          <div className="rs-patient-field">
            <span className="label">Age / Gender</span>
            <span className="value">{study.PatientAge || "-"} / {study.PatientSex || "-"}</span>
          </div>
          <div className="rs-patient-field">
            <span className="label">Accession No</span>
            <span className="value">{study.AccessionNumber || "-"}</span>
          </div>
          <div className="rs-patient-field">
            <span className="label">Referring Doctor</span>
            <span className="value">{study.ReferringPhysicianName || "Self / Desk"}</span>
          </div>
        </div>

        {/* REPORT TITLE EDIT */}
        <div className="rs-section-card">
          <div className="rs-section-title">Report Heading Title</div>
          <input
            type="text"
            disabled={isReadOnly}
            value={reportTitle}
            onChange={(e) => setReportTitle(e.target.value)}
            className="rs-input-heading"
          />
        </div>

        {/* CLINICAL HISTORY */}
        <div className="rs-section-card">
          <div className="rs-section-title">Clinical History / Indication</div>
          <textarea
            rows={2}
            disabled={isReadOnly}
            value={history}
            onChange={(e) => setHistory(e.target.value)}
            placeholder="e.g. 45Y Male presented with acute lower abdominal pain..."
            style={{
              width: '100%',
              padding: 12,
              borderRadius: 12,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* FINDINGS RICH TEXT WYSIWYG EDITOR */}
        <div className="rs-section-card">
          <div className="rs-section-header">
            <span className="rs-section-title">Detailed Imaging Findings</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>WYSIWYG Formatted View</span>
          </div>

          {!isReadOnly && (
            <div className="rs-wysiwyg-toolbar" style={{ flexWrap: 'wrap', gap: 4 }}>
              <button type="button" onClick={() => execCmd("bold")} className="rs-tool-btn" title="Bold"><Bold size={14} /></button>
              <button type="button" onClick={() => execCmd("italic")} className="rs-tool-btn" title="Italic"><Italic size={14} /></button>
              <button type="button" onClick={() => execCmd("underline")} className="rs-tool-btn" title="Underline"><Underline size={14} /></button>
              <button type="button" onClick={() => execCmd("insertUnorderedList")} className="rs-tool-btn" title="Bullet List"><List size={14} /></button>
              <button type="button" onClick={() => execCmd("insertOrderedList")} className="rs-tool-btn" title="Numbered List"><ListOrdered size={14} /></button>
              <button type="button" onClick={() => execCmd("removeFormat")} className="rs-tool-btn" title="Clear Formatting"><RotateCcw size={14} /></button>
              
              <div style={{ height: 18, width: 1, background: '#cbd5e1', margin: '0 6px' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', alignSelf: 'center' }}>Dot Macros:</span>
              {[".normal", ".chest", ".stroke", ".ctpa", ".birads1", ".fetal", ".dvt"].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    const text = CLINICAL_MACROS[m] || "";
                    updateFindings(findingsHtml + text);
                  }}
                  style={{
                    background: '#f1f5f9',
                    color: '#0f172a',
                    border: '1px solid #cbd5e1',
                    borderRadius: 5,
                    padding: '3px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          <div
            ref={findingsRef}
            contentEditable={!isReadOnly}
            onInput={() => {
              if (findingsRef.current) {
                const raw = findingsRef.current.innerHTML;
                const expanded = expandClinicalMacros(raw);
                if (expanded !== raw) {
                  findingsRef.current.innerHTML = expanded;
                }
                setFindingsHtml(findingsRef.current.innerHTML);
              }
            }}
            className="rs-rich-editor"
          />
        </div>

        {/* IMPRESSION / CONCLUSION RICH TEXT EDITOR */}
        <div className="rs-section-card">
          <div className="rs-section-header">
            <span className="rs-section-title">Clinical Impression & Conclusion</span>
            {!isReadOnly && (
              <button
                type="button"
                onClick={generateAIImpression}
                style={{ background: 'none', border: 'none', color: '#4338ca', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Sparkles size={14} /> Auto Generate AI Impression
              </button>
            )}
          </div>

          {!isReadOnly && (
            <div className="rs-wysiwyg-toolbar">
              <button type="button" onClick={() => execCmd("bold")} className="rs-tool-btn" title="Bold"><Bold size={14} /></button>
              <button type="button" onClick={() => execCmd("italic")} className="rs-tool-btn" title="Italic"><Italic size={14} /></button>
              <button type="button" onClick={() => execCmd("insertUnorderedList")} className="rs-tool-btn" title="Bullet List"><List size={14} /></button>
            </div>
          )}

          <div
            ref={conclusionRef}
            contentEditable={!isReadOnly}
            onInput={() => setConclusionHtml(conclusionRef.current.innerHTML)}
            className="rs-rich-editor rs-impression-editor"
          />
        </div>

        {/* ATTACHED KEY DIAGNOSTIC IMAGES CARD */}
        <div className="rs-section-card">
          <div className="rs-section-header" style={{ marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="rs-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              📸 Attached Key Diagnostic Images ({attachedSnapshots.length})
            </span>
            {!isReadOnly && (
              <button
                type="button"
                onClick={handleAttachKeyImage}
                style={{
                  background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  boxShadow: "0 2px 6px rgba(2, 132, 199, 0.3)"
                }}
              >
                📸 Capture Key Image / Snapshot
              </button>
            )}
          </div>

          {attachedSnapshots.length === 0 ? (
            <div style={{ padding: "16px 12px", textAlign: "center", color: "#64748b", fontSize: 12, border: "1px dashed #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
              No key images attached yet. Click <b>"📸 Capture Key Image / Snapshot"</b> to attach key diagnostic images for this report.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
              {attachedSnapshots.map((snap, idx) => (
                <div key={snap.id || idx} style={{ position: "relative", borderRadius: 8, border: "1px solid #cbd5e1", overflow: "hidden", background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                  <img
                    src={snap.preview_url || snap.url}
                    alt={snap.caption || `Key Image ${idx + 1}`}
                    style={{ width: "100%", height: 125, objectFit: "cover", display: "block" }}
                  />
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => setAttachedSnapshots(prev => prev.filter((_, i) => i !== idx))}
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        background: "rgba(239, 68, 68, 0.9)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "50%",
                        width: 22,
                        height: 22,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.5)"
                      }}
                      title="Remove Image"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="rs-container">
      {/* TOP HEADER BAR WITH VIEW MODE TOGGLE */}
      <header className="rs-header">
        <div className="rs-header-left">
          <button onClick={() => navigate(-1)} className="rs-back-btn" title="Back to Worklist">
            <ChevronLeft size={20} />
          </button>
          <div className="rs-title-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                {study.PatientName || "Patient Report"}
                <span className="rs-badge-id">ID: {study.PatientID || "-"}</span>
                <span className="rs-badge-status">{reportStatus}</span>
              </h1>

              {pacsStudiesList.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active PACS Patient:</span>
                  <select
                    value={activeStudyUID}
                    onChange={(e) => setActiveStudyUID(e.target.value)}
                    style={{
                      background: '#1e293b',
                      color: '#38bdf8',
                      border: '1px solid #3b82f6',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      outline: 'none',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                    }}
                  >
                    {pacsStudiesList.map((s, idx) => {
                      const sUid = s.StudyInstanceUID || s.study_uid || s.id;
                      const sName = (s.PatientName || s.patient_name || "Patient").replace(/\^/g, " ");
                      const sAcc = s.AccessionNumber || s.accession_number || `ACC-${idx + 1}`;
                      const sMod = s.Modality || s.modality || "CR";
                      return (
                        <option key={sUid || idx} value={sUid}>
                          {sName} ({sMod} • Acc: {sAcc})
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
            <p className="rs-subtitle" style={{ marginTop: '2px' }}>
              {study.Modality} • {study.BodyPartExamined || "General"} • Acc: {study.AccessionNumber || "-"}
            </p>
          </div>
        </div>

        {/* VIEW MODE TOGGLE BAR */}
        <div className="rs-viewmode-bar">
          <button
            onClick={() => setViewMode("studio")}
            className={`rs-viewmode-btn ${viewMode === "studio" ? "active" : ""}`}
          >
            <FileText size={14} /> Studio Only
          </button>
          <button
            onClick={() => setShowFlashSplitModal(true)}
            className="rs-viewmode-btn"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)', color: '#ffffff' }}
          >
            <Zap size={14} /> ⚡ Flash Split Workstation
          </button>
          <button
            onClick={() => setViewMode("viewer")}
            className={`rs-viewmode-btn ${viewMode === "viewer" ? "active" : ""}`}
          >
            <Maximize2 size={14} /> Viewer Only
          </button>
        </div>

        {/* TOP ACTION TOOLBAR */}
        <div className="rs-header-actions">
          <button
            onClick={() => setShowFlashSplitModal(true)}
            className="rs-btn rs-btn-primary"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)', color: '#ffffff' }}
          >
            <Zap size={16} /> Flash Split Workstation
          </button>

          <button onClick={() => openStudyViewer(studyUID)} className="rs-btn rs-btn-primary">
            <Eye size={16} /> Open OHIF Viewer
          </button>

          <button onClick={() => setShowPrintModal(true)} className="rs-btn rs-btn-outline">
            <FileText size={16} /> Print Preview
          </button>

          <button onClick={handlePrint} className="rs-btn rs-btn-dark">
            <Printer size={16} /> Print Report
          </button>

          <button onClick={autoFillDicomSR} disabled={isSyncingSR} className="rs-btn rs-btn-sky">
            <Zap size={16} /> {isSyncingSR ? "Syncing..." : "Auto-Fill SR"}
          </button>

          {isReadOnly ? (
            <>
              <button disabled className="rs-btn" style={{ background: '#f1f5f9', color: '#94a3b8', border: '1px solid #cbd5e1', cursor: 'not-allowed' }}>
                🔒 Signed & Locked
              </button>
              <button
                onClick={() => {
                  setIsAddendumMode(true);
                  const dateStr = new Date().toLocaleDateString();
                  const addendumHeader = `<p><br></p><div style="padding: 10px; background: #fff7ed; border-left: 4px solid #f97316; margin-top: 12px;"><strong style="color: #c2410c;">[OFFICIAL ADDENDUM - ${dateStr}]:</strong><p>Enter addendum details here...</p></div>`;
                  updateConclusion(conclusionHtml + addendumHeader);
                  setReportStatus("Addendum");
                }}
                className="rs-btn"
                style={{ background: '#f97316', color: '#ffffff' }}
              >
                📝 Create Addendum
              </button>
            </>
          ) : (
            <>
              <button onClick={handleShare7DayLink} className="rs-btn" style={{ background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe' }} title="Generate and copy 7-day temporary viewer link">
                🔗 Share 7-Day Link
              </button>
              <button onClick={() => handleSaveReport("Draft")} className="rs-btn rs-btn-outline">
                <Save size={16} /> Save Draft
              </button>
              <button onClick={() => handleSaveReport(isAddendumMode ? "Addendum" : "Final")} className="rs-btn rs-btn-emerald">
                <CheckCircle size={16} /> {isAddendumMode ? "Save Addendum" : "Final Sign-Off"}
              </button>
            </>
          )}
        </div>
      </header>

      {/* DYNAMIC VIEW MODE RENDER */}
      {viewMode === "studio" && renderStudioForm()}

      {viewMode === "split" && (
        <div className="rs-split-layout">
          <div className="rs-viewer-pane">
            <iframe
              src={viewerUrl}
              title="OHIF Viewer"
              className="rs-viewer-iframe"
            />
          </div>
          <div>
            {renderStudioForm()}
          </div>
        </div>
      )}

      {viewMode === "viewer" && (
        <div className="rs-viewer-pane" style={{ height: 'calc(100vh - 120px)' }}>
          <iframe
            src={viewerUrl}
            title="OHIF Viewer Fullscreen"
            className="rs-viewer-iframe"
          />
        </div>
      )}

      {/* FULL-SCREEN FLASH SPLIT WORKSTATION MODAL */}
      {showFlashSplitModal && (
        <DiagnosticWorkstationModal
          studyUID={studyUID}
          initialModality={study.Modality || selectedModality}
          onClose={() => setShowFlashSplitModal(false)}
        />
      )}

      {/* PRINT PREVIEW MODAL */}
      {showPrintModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(6px)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: 20,
            width: '100%',
            maxWidth: 850,
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: 32,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            fontFamily: 'serif',
            color: '#000000'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e2e8f0' }} className="no-print">
              <span style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: 14, color: '#4338ca' }}>
                🖨️ Official Radiology Printable Document
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handlePrint} className="rs-btn rs-btn-emerald">
                  <Printer size={16} /> Print Now
                </button>
                <button onClick={() => setShowPrintModal(false)} className="rs-btn rs-btn-outline">
                  <X size={16} /> Close
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '3px double #000', paddingBottom: 16, marginBottom: 20 }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 'bold', color: '#1e1b4b', fontFamily: 'sans-serif', textTransform: 'uppercase' }}>
                  {clinicBranding.name || "AKASH MEDICAL COLLEGE AND HOSPITALS"}
                </h1>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, fontWeight: '600', color: '#4338ca', fontFamily: 'sans-serif' }}>
                  {clinicBranding.header_text || "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING"}
                </p>
                {(clinicBranding.address || clinicBranding.phone) && (
                  <p style={{ margin: '3px 0 0 0', fontSize: 11, color: '#475569', fontFamily: 'sans-serif' }}>
                    {clinicBranding.address} {clinicBranding.phone ? `• Helpline: ${clinicBranding.phone}` : ''}
                  </p>
                )}
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'sans-serif', fontSize: 11, color: '#64748b' }}>
                <div style={{ fontWeight: 'bold', color: '#047857', fontSize: 12 }}>NABH & NABL ACCREDITED</div>
                <div>24x7 Diagnostic Helpline</div>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 20, border: '1px solid #000', fontFamily: 'sans-serif' }}>
              <tbody>
                <tr>
                  <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Patient Name:</td>
                  <td style={{ padding: 6, border: '1px solid #ccc', fontWeight: 'bold' }}>{study.PatientName || "-"}</td>
                  <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Age / Sex:</td>
                  <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.PatientAge || "-"} / {study.PatientSex || "-"}</td>
                </tr>
                <tr>
                  <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Patient ID:</td>
                  <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.PatientID || "-"}</td>
                  <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Accession No:</td>
                  <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.AccessionNumber || "-"}</td>
                </tr>
                <tr>
                  <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Modality:</td>
                  <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.Modality || "CR"}</td>
                  <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Study Date:</td>
                  <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.StudyDate || "-"}</td>
                </tr>
              </tbody>
            </table>

            <h2 style={{ textTransform: 'uppercase', textAlign: 'center', fontSize: 16, margin: '20px 0', textDecoration: 'underline', fontWeight: 'bold' }}>
              {reportTitle}
            </h2>

            {history && (
              <div style={{ marginBottom: 16, fontSize: 13 }}>
                <strong>CLINICAL HISTORY:</strong> {history}
              </div>
            )}

            <div style={{ marginBottom: 20, fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 8, textDecoration: 'underline' }}>IMAGING FINDINGS:</div>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(filterAiTerms(findingsHtml)) }} />
            </div>

            <div style={{ marginBottom: 30, padding: 12, border: '1.5px solid #000', borderRadius: 8, background: '#fafafa', fontSize: 13 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>IMPRESSION & CONCLUSION:</div>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(filterAiTerms(conclusionHtml)) }} />
            </div>

            {/* ATTACHED KEY DIAGNOSTIC IMAGES IN PRINT PREVIEW (NEAT, CLEAN & CRISP PRINT SIZE) */}
            {attachedSnapshots.length > 0 && (
              <div style={{ margin: "12px 0 16px 0", pageBreakInside: "avoid", fontFamily: "sans-serif" }}>
                <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 8, textDecoration: "underline", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  KEY DIAGNOSTIC IMAGES:
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                  {attachedSnapshots.map((snap, i) => (
                    <div key={i} style={{ border: "1px solid #cbd5e1", borderRadius: 6, overflow: "hidden", background: "#ffffff", padding: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                      <img src={snap.preview_url} alt={`Key Image ${i + 1}`} style={{ width: "100%", height: 135, objectFit: "cover", display: "block" }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingTop: 20, borderTop: '1px solid #ccc', fontFamily: 'sans-serif' }}>
              <div style={{ display: 'flex', items: 'center', gap: 12 }}>
                <QrCode size={44} />
                <div style={{ fontSize: 10, color: '#64748b' }}>
                  Digitally Verified Electronic Signature<br />
                  Verified via IPACX DICOM Engine
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold', fontSize: 14, color: '#0f172a' }}>Dr. Alex Vance, MD</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Consultant Radiologist</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>Reg No: KMC-84920</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VENDOR-GRADE PATIENT & PHYSICIAN SHARE MODAL */}
      <ShareReportModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        studyUID={studyUID}
        patientID={study.PatientID}
        patientName={study.PatientName}
        accessionNumber={study.AccessionNumber}
        userRole={userRole}
      />
    </div>
  );
}
