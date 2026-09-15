/* eslint-disable no-unused-vars */
// src/pages/ReportPanel.jsx 
import React, { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import "./CreateReport.css";
import api, { apiUrl } from "../api/axios";
import DigitalSignatureField from "../components/DigitalSignatureField"; // adjust path
import { normalizeRadiologyDictation } from "../utils/RadiologyVoiceDictationEngine";

/* ===========================
      RichEditor component
   ========================== */
function RichEditor({
  value,
  onChange,
  onFocus,
  onSelectionChange,
  placeholder,
  disabled = false,
  editorKey, 
}) {
  const ref = useRef();

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || "";
    }
  }, [value]);

  return (
    <div
      ref={ref}
      data-editor={editorKey} 
      contentEditable={!disabled}
      suppressContentEditableWarning
      onFocus={() => {
        if (!disabled && typeof onFocus === "function") {
          onFocus(ref.current);
          setTimeout(onSelectionChange, 0);
        }
      }}
      onInput={(e) => !disabled && onChange(e.currentTarget.innerHTML)}
      onMouseUp={!disabled ? onSelectionChange : undefined}
      onKeyUp={!disabled ? onSelectionChange : undefined}
      style={{
        minHeight: 100,
        padding: 8,
        border: "1px solid #aaa",
        backgroundColor: disabled ? "#f1f3f5" : "#fff",
        cursor: disabled ? "not-allowed" : "text",
      }}
      data-placeholder={placeholder}
    />
  );
}

function changeCase(caseType) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const selectedText = range.toString();
  if (!selectedText) return;

  let newText = selectedText;
  switch (caseType) {
    case "uppercase":
      newText = selectedText.toUpperCase();
      break;
    case "lowercase":
      newText = selectedText.toLowerCase();
      break;
    case "capitalize":
      newText = selectedText.replace(/\b\w/g, c => c.toUpperCase());
      break;
    default:
      break;
  }

  // Replace selection
  range.deleteContents();
  range.insertNode(document.createTextNode(newText));

  // Move cursor to the end of new text
  selection.removeAllRanges();
  const newRange = document.createRange();
  newRange.setStart(range.endContainer, range.endOffset);
  selection.addRange(newRange);
}

function setLineSpacing(spacing) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const anchorEl =
    selection.anchorNode?.nodeType === 1
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
  const editor = anchorEl?.closest?.("[data-editor]");
  if (!editor) return;

  const isBlock = (el) =>
    !!el &&
    el.nodeType === 1 &&
    [
      "P",
      "DIV",
      "LI",
      "UL",
      "OL",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "BLOCKQUOTE",
      "PRE",
    ].includes(el.tagName);

  // If no selection, apply to the current paragraph/block at cursor.
  if (range.collapsed) {
    let target = anchorEl;
    while (target && target !== editor && !isBlock(target)) {
      target = target.parentElement;
    }
    (target && target !== editor ? target : editor).style.lineHeight = spacing;
    return;
  }

  // Apply to all block elements touched by the selection.
  const blocks = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.nextNode();
  while (node) {
    if (isBlock(node) && range.intersectsNode(node)) {
      blocks.push(node);
    }
    node = walker.nextNode();
  }

  if (blocks.length === 0) {
    editor.style.lineHeight = spacing;
    return;
  }

  blocks.forEach((b) => {
    b.style.lineHeight = spacing;
  });
}

//reporttitle
function ReportTitle({ value, onChange, onManualEdit }) {
  const ref = useRef();

  useEffect(() => {
    if (ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value || "";
    }
  }, [value]);

  return (
    <div
      ref={ref}
      className="report-title"
      contentEditable
      suppressContentEditableWarning
      onBlur={(e) => {
        onChange(e.currentTarget.innerText);
        onManualEdit(); // ✅ user finished typing
      }}
      style={{
        fontWeight: "bold",
        fontSize: "14px",
        padding: "4px 0",
        minHeight: 24,
      }}
    />
  );
}


/* ===========================
      Helper functions
   ========================== */
const cleanPatientName = (name) => (name ? name.replace(/\^/g, " ").trim() : "");

const formatDicomDateTime = (date, time) => {
  if (!date || !time) return "";
  const d = date.trim();
  const t = time.trim().padEnd(6, "0").substring(0, 6);
  const iso = `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(
    6,
    8
  )}T${t.substring(0, 2)}:${t.substring(2, 4)}:${t.substring(4, 6)}`;
  return formatDateTime(iso);
};

const formatDateTime = (date) => {
  try {
    const dt = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(dt.getTime())) return "";
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    let hh = dt.getHours();
    const min = String(dt.getMinutes()).padStart(2, "0");
    const sec = String(dt.getSeconds()).padStart(2, "0");
    const ampm = hh >= 12 ? "PM" : "AM";
    hh = hh % 12 || 12;
    return `${dd}/${mm}/${yyyy}, ${String(hh).padStart(2, "0")}:${min}:${sec} ${ampm}`;
  } catch {
    return "";
  }
};

const extractAgeGender = (rawName, rawAge, rawSex) => {
  let name = rawName || "";
  let age = "";
  let gender = "";

  // 1️⃣ DICOM style parsing (^ separated)
  if (name.includes("^")) {
    const parts = name.split("^").map(p => p.trim());
    const nameParts = [];

    for (const p of parts) {
      // Match age/gender like 27Y/F
      const agMatch = p.match(/^(\d{1,3})Y?\/([MFO])$/i);
      if (agMatch) {
        age = agMatch[1];
        gender = agMatch[2].toUpperCase();
        continue;
      }

      // Match age only like 27Y
      const ageMatch = p.match(/^(\d{1,3})Y$/i);
      if (ageMatch) {
        age = ageMatch[1];
        continue;
      }

      // Match gender only like M/F/O
      const genderMatch = p.match(/^([MFO])$/i);
      if (genderMatch) {
        gender = genderMatch[1].toUpperCase();
        continue;
      }

      // Otherwise, part of name
      nameParts.push(p);
    }

    name = nameParts.join(" ").trim();
  }

  // 2️⃣ Plain text parsing for formats like "NAME 24Y/M"
  if (!age || !gender) {
    const plainMatch = name.match(/(\d{1,3})Y?\/([MFO])/i);
    if (plainMatch) {
      age = age || plainMatch[1];
      gender = gender || plainMatch[2].toUpperCase();
      name = name.replace(plainMatch[0], "").trim();
    }
  }

  // 3️⃣ Fallback to rawAge/rawSex fields
  if (!age && rawAge) age = rawAge;
  if (!gender && rawSex && rawSex !== "O") gender = rawSex;

  // 4️⃣ Final clean name
  name = name.replace(/\^/g, " ").replace(/\s+/g, " ").trim();
  if (!name) name = "N/A";

  // Return standardized object
  return {
    name,
    age: age || "N/A",
    gender: gender || "N/A",
  };
};



/* ===========================
      WordColorPicker
   ========================== */
function WordColorPicker({ onSelect }) {
  const automaticColor = "#000000";

  const themeColors = [
    ["#ffffff", "#f2f2f2", "#d9d9d9", "#bfbfbf", "#7f7f7f"],
    ["#000000", "#7f7f7f", "#595959", "#3f3f3f", "#262626"],
    ["#4472c4", "#8eaadb", "#b4c6e7", "#c9daf8", "#ddebf7"],
    ["#ed7d31", "#f4b183", "#f7caac", "#f8dfd0", "#fce5cd"],
    ["#ffc000", "#ffd966", "#ffe699", "#fff2cc", "#fff3cd"],
    ["#70ad47", "#a9d18e", "#c6e0b4", "#e2efda", "#e9f7ef"],
  ];

  const standardColors = [
    "#c00000",
    "#ff0000",
    "#ffc000",
    "#ffff00",
    "#92d050",
    "#00b050",
    "#00b0f0",
    "#0070c0",
    "#002060",
    "#7030a0",
  ];

  return (
    <div
      className="word-color-menu"
      style={{
        padding: 8,
        background: "#fff",
        border: "1px solid #ccc",
        borderRadius: 6,
        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
      }}
    >
      <div
        className="color-option automatic"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onSelect(automaticColor)}
        style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, cursor: "pointer" }}
      >
        <div style={{ width: 18, height: 14, background: automaticColor, border: "1px solid #999" }} />
        <div style={{ fontSize: 12 }}>Automatic</div>
      </div>

      <div style={{ fontSize: 11, marginBottom: 6 }}>Theme Colors</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {themeColors.map((col, ci) => (
          <div key={ci} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {col.map((color, ri) => (
              <div
                key={ri}
                className="swatch"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(color)}
                style={{
                  width: 20,
                  height: 14,
                  backgroundColor: color,
                  border: "1px solid #ccc",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, marginBottom: 6 }}>Standard Colors</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {standardColors.map((c, i) => (
          <div
            key={i}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(c)}
            style={{
              width: 20,
              height: 20,
              backgroundColor: c,
              border: "1px solid #ccc",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ===========================
      Main CreateReport component
   ========================== */
export default function CreateReport() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const studyUID =
    searchParams.get("study") ||
    searchParams.get("study_uid") ||
    searchParams.get("studyUID") ||
    location.state?.studyUID ||
    "";
  const navigate = useNavigate();

  const defaultStudy = {
    PatientName: "",
    PatientAge: "",
    PatientSex: "",
    ReferringPhysicianName: "",
    BodyPartExamined: "",
    PatientID: "",
    StudyDate: "",
    StudyTime: "",
    Modality: "",
    AccessionNumber: "",
    History: "",
    Findings: "",
    Conclusion: "",
    ReportedBy: "null",
    ApprovedBy: "null",
    ReportStatus: "",
  };
  const [isLoadingReport, setIsLoadingReport] = useState(true);
  const [study, setStudy] = useState(defaultStudy);
  const [history, setHistory] = useState("");
  const [findings, setFindings] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [keyImages, setKeyImages] = useState([]);
  const [showKeyImages, setShowKeyImages] = useState(false);
  const [reportTitle, setReportTitle] = useState("CT REPORT");
  const [loading, setLoading] = useState(true);
  const reportRef = useRef(null);
  const fileInputRef = useRef(null);
  const reportedByRef = useRef(null);
  const approvedByRef = useRef(null);
  const activeEditorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const refDoctorRef = useRef(null);
  const bodyPartRef = useRef(null);
  const [isManualTitle, setIsManualTitle] = useState(false);
  const [editRefDoctor, setEditRefDoctor] = useState(false);
  const [editBodyPart, setEditBodyPart] = useState(false);
  const [editAccession, setEditAccession] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [listening, setListening] = useState(false);
  const [isUploadingDictation, setIsUploadingDictation] = useState(false);
  const [dictationMode, setDictationMode] = useState("native");
  const recognitionRef = useRef(null);
  const recognitionRunningRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const reportSheetRef = useRef(null);
  const previewMeasureRef = useRef(null);
  const previewPaneRef = useRef(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewPageCount, setPreviewPageCount] = useState(1);
  const [previewContentHeight, setPreviewContentHeight] = useState(0);
  const [previewScale, setPreviewScale] = useState(0.31);
  const [showPreviewPane, setShowPreviewPane] = useState(false);
  const [dicomData, setDicomData] = useState(null);
  const [isSyncingDicom, setIsSyncingDicom] = useState(false);

  const [isAddendum, setIsAddendum] = useState(false);
const [noteInput, setNoteInput] = useState("");
const [parentReportId, setParentReportId] = useState(null);
const [addendumConfirmed, setAddendumConfirmed] = useState(false);
const PX_PER_MM = 96 / 25.4;
const PREVIEW_PAGE_HEIGHT_PX = 1122;
const PREVIEW_HEADER_HEIGHT_PX = Math.round(30 * PX_PER_MM);
const PREVIEW_FOOTER_HEIGHT_PX = Math.round(20 * PX_PER_MM);
const PREVIEW_CONTENT_HEIGHT_PX =
  PREVIEW_PAGE_HEIGHT_PX -
  PREVIEW_HEADER_HEIGHT_PX -
  PREVIEW_FOOTER_HEIGHT_PX;
const PREVIEW_SCALED_PAGE_HEIGHT_PX = PREVIEW_PAGE_HEIGHT_PX * previewScale;
const PREVIEW_SCALED_HEADER_HEIGHT_PX = PREVIEW_HEADER_HEIGHT_PX * previewScale;
const PREVIEW_SCALED_CONTENT_HEIGHT_PX =
  PREVIEW_CONTENT_HEIGHT_PX * previewScale;
const PREVIEW_SCALED_FOOTER_HEIGHT_PX = PREVIEW_FOOTER_HEIGHT_PX * previewScale;
const viewerRef = useRef(null);
const arrowsRef = useRef(null);
const [viewerMinimized, setViewerMinimized] = useState(false);
const [reportMinimized, setReportMinimized] = useState(false);
//report tile
//report tile
// Auto-update report title based on modality + body part
useEffect(() => {
  if (isManualTitle) return; // do not override manual edits

  const modality = study.Modality?.trim() || "";
  const bodyPart = study.BodyPartExamined?.trim() || "";

  if (!modality) {
    // fallback if modality is missing
    setReportTitle("Report");
    return;
  }

  // Build title: include body part only if present
  const title = bodyPart ? `${modality} ${bodyPart} REPORT` : `${modality} REPORT`;
  setReportTitle(title);
}, [study.Modality, study.BodyPartExamined, isManualTitle]);

// 🎙️ Voice based dictation (insert at cursor)
const insertTranscriptAtCursor = (transcript) => {
  if (!transcript.trim()) return;
  if (!activeEditorRef.current) return;
  restoreSelection();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const textNode = document.createTextNode(" " + transcript.trim());
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  sel.removeAllRanges();
  sel.addRange(range);
  saveSelection();
  const editorType = activeEditorRef.current.dataset.editor;
  if (editorType === "history") setHistory(activeEditorRef.current.innerHTML);
  if (editorType === "findings") setFindings(activeEditorRef.current.innerHTML);
  if (editorType === "conclusion") setConclusion(activeEditorRef.current.innerHTML);
};

const cleanupRecorderStream = () => {
  if (mediaStreamRef.current) {
    mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }
};

const stopFallbackDictation = () => {
  const recorder = mediaRecorderRef.current;
  if (!recorder) {
    cleanupRecorderStream();
    recognitionRunningRef.current = false;
    setListening(false);
    return;
  }
  if (recorder.state !== "inactive") recorder.stop();
  else {
    cleanupRecorderStream();
    recognitionRunningRef.current = false;
    setListening(false);
  }
};

const startFallbackDictation = async () => {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    alert("This browser does not support microphone recording.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    audioChunksRef.current = [];
    const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
    const recorder = preferredMime
      ? new MediaRecorder(stream, { mimeType: preferredMime })
      : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      recognitionRunningRef.current = false;
      setListening(false);
      cleanupRecorderStream();
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      audioChunksRef.current = [];
      mediaRecorderRef.current = null;
      if (!blob.size) return;
      setIsUploadingDictation(true);
      try {
        const fd = new FormData();
        fd.append("audio", blob, "dictation.webm");
        fd.append("language", "en");
        const resp = await api.post("/api/speech/transcribe", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const text = String(resp?.data?.text || "").trim();
        if (text) insertTranscriptAtCursor(text);
      } catch (err) {
        console.error("Fallback dictation failed:", err);
        alert(err?.response?.data?.error || "Failed to transcribe audio.");
      } finally {
        setIsUploadingDictation(false);
      }
    };
    mediaRecorderRef.current = recorder;
    recognitionRunningRef.current = true;
    setListening(true);
    recorder.start(250);
  } catch (err) {
    console.error("Microphone permission/recording failed:", err);
    cleanupRecorderStream();
    recognitionRunningRef.current = false;
    setListening(false);
    alert("Microphone access failed. Please allow mic permission.");
  }
};

useEffect(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setDictationMode("fallback");
    return () => {
      stopFallbackDictation();
    };
  }
  setDictationMode("native");
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  recognition.onstart = () => {
    recognitionRunningRef.current = true;
  };
  recognition.onend = () => {
    recognitionRunningRef.current = false;
    setListening(false);
  };
  recognition.onerror = (e) => {
    console.error("Speech recognition error:", e);
    recognitionRunningRef.current = false;
    setListening(false);
  };
  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
    }
    insertTranscriptAtCursor(normalizeRadiologyDictation(transcript));
  };
  recognitionRef.current = recognition;
  return () => {
    if (recognitionRunningRef.current) {
      try {
        recognition.stop();
      } catch {
        // Ignored recognition stop error
      }
    }
    stopFallbackDictation();
  };
}, []);


// template
useEffect(() => {
  if (!study.Modality || !study.BodyPartExamined) return;

  fetch(`${api.defaults.baseURL}/api/report-templates`)
    .then(res => res.json())
    .then(data => {
      const bodyPart = study.BodyPartExamined.trim().toLowerCase();
      const modality = study.Modality.trim();

      // 1️⃣ First look for exact "plain" template
      const plainTemplate = data.filter(t =>
        t.modality === modality &&
        t.body_part.toLowerCase() === `${bodyPart}_plain` &&
        t.is_active
      );

      // 2️⃣ If no "plain" template, fall back to normal template
      const filtered = plainTemplate.length > 0
        ? plainTemplate
        : data.filter(t =>
            t.modality === modality &&
            t.body_part.toLowerCase() === bodyPart &&
            t.is_active
          );

      setTemplates(filtered);
    })
    .catch(err => console.error("Template load error", err));
}, [study.Modality, study.BodyPartExamined]);

const applyTemplate = (template) => {
  if (!template || !template.content) return;

  // Apply history, findings, conclusion if present
  if (template.content.history) setHistory(template.content.history);
  if (template.content.findings) setFindings(template.content.findings);
  if (template.content.conclusion) setConclusion(template.content.conclusion);

  alert(`Template applied: ${template.template_name}`);
  setShowTemplateMenu(false);
};

const fetchDicomMeasurements = async () => {
  if (!studyUID) return;
  setIsSyncingDicom(true);
  try {
    const activeModality = study.Modality || "";
    const desc = study.StudyDescription || reportTitle || "";
    const bodyPart = study.BodyPartExamined || "";
    const res = await api.get(`/api/pacs/measurements/${studyUID}?modality=${encodeURIComponent(activeModality)}&description=${encodeURIComponent(desc)}&bodyPart=${encodeURIComponent(bodyPart)}`);
    if (res.data.success) {
      setDicomData(res.data.data);
      alert("DICOM measurements synced successfully.");
    }
  } catch (err) {
    console.error("Sync measurements failed", err);
    alert("No measurements found for this study.");
  } finally {
    setIsSyncingDicom(false);
  }
};

const insertStructuredTable = (type) => {
  let tableHtml = "";
  if (type === "CT") {
    tableHtml = `
      <table border="1" style="width:100%; border-collapse:collapse; margin:10px 0; font-size:13px; border: 1px solid #cbd5e1;">
        <tr style="background:#f1f5f9; color: #1e293b;"><th>Organ</th><th>Findings</th></tr>
        <tr><td><div style="padding: 4px;"><b>Liver</b></div></td><td><div style="padding: 4px;">Normal size and attenuation. No focal lesions.</div></td></tr>
        <tr><td><div style="padding: 4px;"><b>Spleen</b></div></td><td><div style="padding: 4px;">Normal in size and echotexture.</div></td></tr>
        <tr><td><div style="padding: 4px;"><b>Kidneys</b></div></td><td><div style="padding: 4px;">Normal cortical thickness. No calculi.</div></td></tr>
      </table>
    `;
  } else if (type === "US_ANOMALY") {
    tableHtml = `
      <div style="margin: 15px 0;">
        <h4 style="color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; margin-bottom: 10px;">ANOMALY SCAN - FETAL PARAMETERS</h4>
        
        <table border="1" style="width:100%; border-collapse:collapse; margin-bottom: 15px; font-size: 13px; border: 1px solid #cbd5e1;">
          <tr style="background:#eff6ff; color: #1e40af;">
            <th style="padding: 6px;">Dating</th>
            <th style="padding: 6px;">LMP / USG date</th>
            <th style="padding: 6px;">GA (Weeks/Days)</th>
            <th style="padding: 6px;">EDD</th>
            <th style="padding: 6px;">Remark</th>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>By LMP</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.LMP_DATE || "-"}</td>
            <td style="padding: 6px;">${dicomData?.measurements?.GA_LMP || "-"}</td>
            <td style="padding: 6px;">${dicomData?.measurements?.EDD_LMP || "-"}</td>
            <td style="padding: 6px;">Assigned</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>By Present USG</b></td>
            <td style="padding: 6px;">${new Date().toLocaleDateString()}</td>
            <td style="padding: 6px;">${dicomData?.measurements?.GA_USG || "-"}</td>
            <td style="padding: 6px;">${dicomData?.measurements?.EDD_USG || "-"}</td>
            <td style="padding: 6px;">-</td>
          </tr>
        </table>

        <table border="1" style="width:100%; border-collapse:collapse; font-size: 13px; border: 1px solid #cbd5e1;">
          <tr style="background:#f8fafc; color: #475569;">
            <th style="padding: 6px;">Fetal Growth Parameters</th>
            <th style="padding: 6px;">Value (mm)</th>
            <th style="padding: 6px;">GA (W/D)</th>
            <th style="padding: 6px;">Percentile</th>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>Biparietal Diameter (BPD)</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.BPD || "-"}</td>
            <td style="padding: 6px;">-</td>
            <td style="padding: 6px;">-</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>Head Circumference (HC)</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.HC || "-"}</td>
            <td style="padding: 6px;">-</td>
            <td style="padding: 6px;">-</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>Abdominal Circumference (AC)</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.AC || "-"}</td>
            <td style="padding: 6px;">-</td>
            <td style="padding: 6px;">-</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>Femoral Length (FL)</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.FL || "-"}</td>
            <td style="padding: 6px;">-</td>
            <td style="padding: 6px;">-</td>
          </tr>
          <tr style="background: #f1f5f9;">
            <td style="padding: 6px;"><b>Estimated Fetal Weight (FW)</b></td>
            <td style="padding: 6px;" colspan="3"><b>${dicomData?.measurements?.FW || "-"}</b></td>
          </tr>
          <tr style="background: #f1f5f9;">
            <td style="padding: 6px;"><b>Fetal Heart Rate (HR)</b></td>
            <td style="padding: 6px;" colspan="3"><b>${dicomData?.measurements?.HR || "-"}</b></td>
          </tr>
        </table>
      </div>
    `;
  } else if (type === "US_DOPPLER") {
    tableHtml = `
      <div style="margin: 15px 0;">
        <h4 style="color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; margin-bottom: 10px;">DOPPLER VELOCIMETRY</h4>
        <table border="1" style="width:100%; border-collapse:collapse; font-size: 13px; border: 1px solid #cbd5e1;">
          <tr style="background:#eff6ff; color: #1e40af;">
            <th style="padding: 6px;">Vessels</th>
            <th style="padding: 6px;">PSV</th>
            <th style="padding: 6px;">EDV</th>
            <th style="padding: 6px;">RI / PI</th>
            <th style="padding: 6px;">Remarks</th>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>Right Uterine Artery</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.PSV_RT || "-"}</td>
            <td style="padding: 6px;">-</td>
            <td style="padding: 6px;">${dicomData?.measurements?.PI_RT || "-"}</td>
            <td style="padding: 6px;">-</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><b>Left Uterine Artery</b></td>
            <td style="padding: 6px;">${dicomData?.measurements?.PSV_LT || "-"}</td>
            <td style="padding: 6px;">-</td>
            <td style="padding: 6px;">${dicomData?.measurements?.PI_LT || "-"}</td>
            <td style="padding: 6px;">-</td>
          </tr>
          <tr style="background: #f1f5f9;">
            <td style="padding: 6px;"><b>Uterine Arteries Mean PI</b></td>
            <td style="padding: 6px;" colspan="3"><b>${dicomData?.measurements?.PI_MEAN || "-"}</b></td>
            <td style="padding: 6px;">-</td>
          </tr>
        </table>
      </div>
    `;
  }

  if (activeEditorRef.current) {
    restoreSelection();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const div = document.createElement("div");
      div.innerHTML = tableHtml;
      range.insertNode(div);
      
      // Sync state
      syncActiveEditorContent();
    }
  } else {
    // If no active editor, append to findings
    setFindings(prev => prev + tableHtml);
  }
};

useEffect(() => {
  if (refDoctorRef.current && refDoctorRef.current.innerText !== study.ReferringPhysicianName) {
    refDoctorRef.current.innerText = study.ReferringPhysicianName || "";
  }
}, [study.ReferringPhysicianName]);

useEffect(() => {
  if (reportedByRef.current && reportedByRef.current.textContent !== study.ReportedBy) {
    reportedByRef.current.textContent = study.ReportedBy || "";
  }
}, [study.ReportedBy]);

// Sync ApprovedBy span after study state changes
useEffect(() => {
  if (approvedByRef.current && approvedByRef.current.textContent !== study.ApprovedBy) {
    approvedByRef.current.textContent = study.ApprovedBy || "";
  }
}, [study.ApprovedBy]);

useEffect(() => {
  const syncPreviewHtml = () => {
    setPreviewHtml(reportSheetRef.current?.innerHTML || "");
  };
  syncPreviewHtml();
  const timer = setTimeout(syncPreviewHtml, 0);
  return () => clearTimeout(timer);
}, [
  study,
  history,
  findings,
  conclusion,
  showKeyImages,
  keyImages,
  reportTitle,
]);

useEffect(() => {
  if (!showPreviewPane) return;
  const measureEl = previewMeasureRef.current;
  if (!measureEl) return;

  const updatePageCount = () => {
    const computed = window.getComputedStyle(measureEl);
    const trailingBottomPadding = parseFloat(computed.paddingBottom || "0") || 0;
    const contentHeight = Math.max(
      0,
      (measureEl.scrollHeight || 0) - trailingBottomPadding
    );
    setPreviewContentHeight(contentHeight);
    const rawPages = Math.max(1, Math.ceil(contentHeight / PREVIEW_CONTENT_HEIGHT_PX));
    setPreviewPageCount(rawPages);
  };

  updatePageCount();
  const timer = setTimeout(updatePageCount, 0);
  window.addEventListener("resize", updatePageCount);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", updatePageCount);
  };
}, [
  previewHtml,
  showPreviewPane,
]);

useEffect(() => {
  if (!showPreviewPane) return;
  const measureEl = previewMeasureRef.current;
  const paneEl = previewPaneRef.current;
  if (!measureEl || !paneEl) return;

  const updateScale = () => {
    const pageWidth = measureEl.getBoundingClientRect().width || 0;
    const availableWidth = Math.max(0, paneEl.clientWidth - 26); // pane padding + border safety
    if (!pageWidth || !availableWidth) return;
    const nextScale = Math.min(1, Math.max(0.2, availableWidth / pageWidth));
    setPreviewScale(nextScale);
  };

  updateScale();
  const timer = setTimeout(updateScale, 0);
  window.addEventListener("resize", updateScale);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("resize", updateScale);
  };
}, [previewHtml, showPreviewPane]);

  /* ===========================
        Load report and prefill
     ========================== */
 useEffect(() => {
  if (!studyUID) return;

  const loadStudyAndReport = async () => {
    try {
      // 1️⃣ Load study info
      const studyRes = await fetch(`${api.defaults.baseURL}/api/studies/${encodeURIComponent(studyUID)}`);
      const studyData = (await studyRes.json()) || {};

      // 2️⃣ Load report (draft/final)
      const reportRes = await fetch(`${api.defaults.baseURL}/api/reports/by-study/${studyUID}`);
      let reportData = null;
      if (reportRes.ok) {
        try {
          reportData = await reportRes.json();
        } catch {
          reportData = null;
        }
      }

      const reportContent = reportData?.report_content || {};
      // ✅ ALWAYS set parentReportId from backend report
if (reportData?.id) {
  setParentReportId(reportData.id);
}

// 3️⃣ Check if opening as Addendum from location.state
if (location.state?.isAddendum && location.state?.parentReportData) {
  const parent = location.state.parentReportData;

  setHistory(parent.history || "");
  setFindings(parent.findings || "");
  setConclusion(parent.conclusion || "");
  setStudy((prev) => ({
    ...prev,
    BodyPartExamined: parent.body_part || prev.BodyPartExamined,
    Modality: parent.modality || prev.Modality,
    ReferringPhysicianName: parent.referring_doctor || prev.ReferringPhysicianName,
  }));
  setParentReportId(parent.id);
  setIsAddendum(true);
  setNoteInput(location.state.addendumReason || "");
} else if (reportData?.status === "Addendum" && reportData?.addendum_reason) {
  // <-- NEW: populate noteInput from database
  setIsAddendum(true);
  setNoteInput(reportData.addendum_reason);
}
 else {
        // normal report
        setStudy({
          PatientName: studyData.PatientName || studyData.patient_name || "",
          PatientAge: studyData.PatientAge || studyData.patient_age || "",
          PatientSex: studyData.PatientSex || studyData.patient_sex || "",
          PatientID: studyData.PatientID || studyData.patient_id || "",
          AccessionNumber: studyData.AccessionNumber || studyData.accession_number || "",
          Modality: studyData.Modality || studyData.modality || "",
          StudyDate: studyData.StudyDate || studyData.study_date || "",
          StudyTime: studyData.StudyTime || studyData.study_time || "",
          ReferringPhysicianName: reportData?.referring_doctor || studyData.ReferringPhysicianName || studyData.referring_physician || "",
          BodyPartExamined: reportData?.body_part || studyData.BodyPartExamined || studyData.body_part || "",
          ReportedBy: reportData?.reported_by_signature || null,
          ApprovedBy: reportData?.approved_by_signature || null,
          ReportStatus: reportData?.status || "",
        });

        setHistory(reportContent.history || "");
        setFindings(reportContent.findings || "");
        setConclusion(reportContent.conclusion || "");
      }

      // 4️⃣ Load key images if present (check report_content.snapshots, reportData.images, and local key_images)
      let loadedImages = [];
      const rawSnapshots = reportData?.report_content?.snapshots || reportData?.snapshots;
      if (Array.isArray(rawSnapshots) && rawSnapshots.length > 0) {
        loadedImages = rawSnapshots.map(s => typeof s === "string" ? s : (s.preview_url || s.url || s.previewUrl)).filter(Boolean);
      } else if (Array.isArray(reportData?.images) && reportData.images.length > 0) {
        loadedImages = reportData.images.map(img =>
          typeof img === "string" ? img : (img.image_path || img.path || img.url || "")
        ).filter(Boolean);
      }

      // Merge local key images captured from mobile/desktop viewer
      try {
        const localStr = localStorage.getItem(`key_images_${studyUID}`) || localStorage.getItem("key_images");
        if (localStr) {
          const parsed = JSON.parse(localStr);
          if (Array.isArray(parsed)) {
            const localUrls = parsed.map(img => typeof img === "string" ? img : (img.previewUrl || img.preview_url || img.url)).filter(Boolean);
            loadedImages = Array.from(new Set([...loadedImages, ...localUrls]));
          }
        }
      } catch (e) {
        console.warn("Failed to parse local key images:", e);
      }

      setKeyImages(loadedImages);
      setShowKeyImages(loadedImages.length > 0);

    } catch (err) {
      console.error("Failed to load study/report", err);

      // fallback to empty/defaults
      setStudy(prev => ({
        ...prev,
        ReportStatus: "Draft",
        ReportedBy: prev.ReportedBy || "",
        ApprovedBy: prev.ApprovedBy || "",
      }));
      setReportTitle("CT REPORT");
      setHistory("");
      setFindings("");
      setConclusion("");
      setKeyImages([]);
      setShowKeyImages(false);
    } finally {
      setLoading(false);
    }
  };

  loadStudyAndReport();
}, [studyUID, location.state]);


  /* ===========================
        Handle file uploads
     ========================== */
 const handleFiles = async (files) => {
  const imageFiles = [...files].filter((f) => f.type.startsWith("image/"));
  if (!imageFiles.length) return;

  const formData = new FormData();

  // 🔑 REQUIRED
  formData.append("studyUID", studyUID);

  imageFiles.forEach((f) => formData.append("images", f));

  try {
    const res = await fetch(`${api.defaults.baseURL}/api/reports/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (data.success) {
      setKeyImages((prev) => [
        ...prev,
        ...data.paths,
      ]);
       
    }
  } catch (err) {
    console.error("Image upload failed", err);
    alert("Failed to upload images");
  }
};


  /* ===========================
        Save report (Draft / Final)
     ========================== */
const handleSaveReport = async (status) => {
  setStudy((prev) => ({ ...prev, ReportStatus: status })); // update immediately

  const payload = {
    study_uid: studyUID,
    accession_number: study.AccessionNumber,
    patient_id: study.PatientID,
    patient_name: study.PatientName,
    modality: study.Modality,
    reported_by_signature: study.ReportedBy,
approved_by_signature: study.ApprovedBy,
    status, // <- send current status to backend
    history,
    findings,
    conclusion,
    reportTitle,
    referring_doctor: study.ReferringPhysicianName,
    body_part: study.BodyPartExamined,
    image_paths: keyImages,
    parent_report_id: isAddendum ? parentReportId : null, // reference to original report
  addendum_reason: isAddendum ? noteInput : null,      // reason for addendum
  };

  try {
    const res = await fetch(`${api.defaults.baseURL}/api/reports/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      alert(`Report saved as ${status}`);
    }
  } catch (err) {
    console.error("Save report error", err);
    alert("Failed to save report");
  }
};

useEffect(() => {
  if (location.state?.isAddendum) {
    setIsAddendum(true);
  }
}, [location.state]);
// ✅ SYNC FINAL REPORT CONTENT (IMPORTANT)
useEffect(() => {
  if (!studyUID) return;

  const syncFinalReport = async () => {
    try {
      const res = await fetch(`${api.defaults.baseURL}/api/reports/by-study/${studyUID}`);
      if (!res.ok) return;

      const data = await res.json();
      if (!data) return;

      // ✅ USE FLATTENED DATA (FINAL FIX)
      if (data.history !== undefined) setHistory(data.history);
      if (data.findings !== undefined) setFindings(data.findings);
      if (data.conclusion !== undefined) setConclusion(data.conclusion);

      // ✅ IMAGES
      if (Array.isArray(data.images)) {
        const imgs = data.images
          .map((img) => {
            if (typeof img === "string") return img;
            if (img && typeof img === "object") {
              return img.image_path || img.path || img.url || "";
            }
            return "";
          })
          .filter(Boolean);
        setKeyImages(imgs);
        setShowKeyImages(imgs.length > 0);
      }

      // ✅ STATUS + ADDENDUM
      if (data.status) {
        setStudy(prev => ({ ...prev, ReportStatus: data.status }));
      }

      if (data.addendum_reason) {
        setIsAddendum(true);
        setNoteInput(data.addendum_reason);
        setAddendumConfirmed(true);
      }

    } catch (err) {
      console.error("Final report sync failed", err);
    }
  };

  syncFinalReport();
}, [studyUID]);


  /* ===========================
        PDF export
     ========================== */
  const _savePDF = async () => {
    if (!reportRef.current) return;
    const el = reportRef.current;
    const origHeight = el.style.height;
    const origOverflow = el.style.overflow;
    el.style.height = "auto";
    el.style.overflow = "visible";

    const imgs = [...el.querySelectorAll("img")];
    await Promise.all(
      imgs.map((i) => (i.complete ? Promise.resolve() : new Promise((r) => (i.onload = i.onerror = r))))
    );

    const canvas = await html2canvas(el, { scale: 2, useCORS: true });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const w = pdf.internal.pageSize.getWidth();
    const h = (canvas.height * w) / canvas.width;
    pdf.addImage(img, "PNG", 0, 0, w, h);

    const pageHeight = pdf.internal.pageSize.getHeight();
    if (h > pageHeight) {
      let remaining = h;
      let offset = 0;
      pdf.deletePage(1);
      while (remaining > 0) {
        pdf.addPage();
        pdf.addImage(img, "PNG", 0, -offset, w, h);
        offset += pageHeight;
        remaining -= pageHeight;
      }
    }

    pdf.save(`${study?.PatientName || "Report"}.pdf`);

    el.style.height = origHeight;
    el.style.overflow = origOverflow;
  };

  /* ============
     Selection utilities
     ... (Selection utility functions remain unchanged) ...
     ============ */
  const saveSelection = () => {
    const sel = window.getSelection();
    if (!sel) return;
    if (sel.rangeCount > 0) {
      try {
        savedRangeRef.current = sel.getRangeAt(0).cloneRange();
      } catch (e) {
        savedRangeRef.current = null;
      }
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    if (savedRangeRef.current) {
      try {
        sel.addRange(savedRangeRef.current);
      } catch {
        // ignore
      }
    }
  };

  const syncActiveEditorContent = () => {
    if (!activeEditorRef.current) return;
    const editorType = activeEditorRef.current.dataset.editor;
    if (editorType === "history") setHistory(activeEditorRef.current.innerHTML);
    if (editorType === "findings") setFindings(activeEditorRef.current.innerHTML);
    if (editorType === "conclusion") setConclusion(activeEditorRef.current.innerHTML);
  };

  const applyJustifyFullFallback = () => {
    const refreshPreviewFromDom = () => {
      setPreviewHtml(reportSheetRef.current?.innerHTML || "");
    };

    restoreSelection();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const anchorEl =
      selection.anchorNode?.nodeType === 1
        ? selection.anchorNode
        : selection.anchorNode?.parentElement;
    const editor = anchorEl?.closest?.("[data-editor]") || activeEditorRef.current;
    if (!editor) return;

    const isBlock = (el) =>
      !!el &&
      el.nodeType === 1 &&
      [
        "P",
        "DIV",
        "LI",
        "UL",
        "OL",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "BLOCKQUOTE",
        "PRE",
      ].includes(el.tagName);

    if (range.collapsed) {
      let target = anchorEl;
      while (target && target !== editor && !isBlock(target)) {
        target = target.parentElement;
      }
      (target && target !== editor ? target : editor).style.textAlign = "justify";
      saveSelection();
      syncActiveEditorContent();
      refreshPreviewFromDom();
      return;
    }

    const blocks = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();
    while (node) {
      if (isBlock(node) && range.intersectsNode(node)) {
        blocks.push(node);
      }
      node = walker.nextNode();
    }

    if (blocks.length === 0) {
      editor.style.textAlign = "justify";
    } else {
      blocks.forEach((block) => {
        block.style.textAlign = "justify";
      });
    }

    saveSelection();
    syncActiveEditorContent();
    refreshPreviewFromDom();
  };

  // exec with selection restore (works for foreColor etc)
  const exec = (cmd, val = null) => {
    if (cmd === "justifyFull") {
      applyJustifyFullFallback();
      return;
    }
    // try to restore selection first
    restoreSelection();
    // ensure styleWithCSS so color uses inline style
    try {
      document.execCommand("styleWithCSS", false, true);
    } catch {
      // Ignored styleWithCSS error
    }
    try {
      document.execCommand(cmd, false, val);
    } catch (e) {
      console.warn("exec failed", cmd, val, e);
    }
    // after exec, update savedRangeRef (so future ops keep correct range)
    saveSelection();
  };

  // toolbar definition
  const _toolbar = [
    { type: "bold", icon: "B" },
    { type: "italic", icon: "I" },
    { type: "underline", icon: "U" },
    { type: "insertOrderedList", icon: "OL" },
    { type: "insertUnorderedList", icon: "UL" },
  ];

  /* ================
     Active editor handlers passed to RichEditor
     ================ */
 const handleEditorFocus = (domNode) => {
  activeEditorRef.current = domNode; // store actual DOM node
  saveSelection();                   // save cursor
};


  const handleEditorSelectionChange = () => {
    // whenever selection inside an editor changes, capture it
    saveSelection();
  };
const _insertTextAtCursor = (text) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);

  // Remove selected text (if any)
  range.deleteContents();

  // Insert text node
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  // Move cursor AFTER inserted text
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  sel.removeAllRanges();
  sel.addRange(range);

  // Save updated selection
  saveSelection();
};

  /* ====================
     Color picker apply handler
     ==================== */
  const applyColor = (color) => {
    // restore selection and apply
    restoreSelection();
    try {
      document.execCommand("styleWithCSS", false, true);
    } catch {
      // Ignored styleWithCSS error
    }
    try {
      document.execCommand("foreColor", false, color);
    } catch (e) {
      console.warn("foreColor failed:", e);
    }
    setShowColorPalette(false);
    // update saved selection
    saveSelection();
  };

  if (loading) return <p style={{ padding: 12 }}>Loading…</p>;

  const { name: patientName, age, gender } = extractAgeGender(
    study.PatientName,
    study.PatientAge,
    study.PatientSex
  );

  const applyPixelFontSize = (size) => {
  restoreSelection();
  // 1. Force the browser to use CSS instead of <font> tags
  document.execCommand("styleWithCSS", false, true);
  
  // 2. We use a temporary size to "mark" the selection
  document.execCommand("fontSize", false, "1");
  
  // 3. Find the elements we just created and change '1' to our actual pixel size
  const fontElements = document.getElementsByTagName("font");
  for (let i = 0; i < fontElements.length; i++) {
    if (fontElements[i].size === "1") {
      fontElements[i].removeAttribute("size");
      fontElements[i].style.fontSize = size + "px";
    }
  }
  
  // Alternative for modern browsers: find spans with size 1
  const spanElements = document.getElementsByTagName("span");
  for (let i = 0; i < spanElements.length; i++) {
    if (spanElements[i].style.fontSize === "x-small" || spanElements[i].getAttribute("size") === "1") {
       spanElements[i].style.fontSize = size + "px";
    }
  }
  saveSelection();
};

const renderPreviewSheet = (attachRef = false) => (
  <div
    className={`preview-sheet preview-sheet-clone ${attachRef ? "preview-sheet-measure" : ""}`}
    ref={attachRef ? previewMeasureRef : null}
    dangerouslySetInnerHTML={{ __html: previewHtml }}
  />
);
const getViewerWidth = () => {
  if (viewerMinimized) return "10%";
  if (reportMinimized) return "90%";
  return "50%";
};

const getReportWidth = () => {
  if (reportMinimized) return "10%";
  if (viewerMinimized) return "90%";
  return "50%";
};
const isSplitMode = !viewerMinimized && !reportMinimized;

  return (
  <div
    className={`create-report-layout ${showPreviewPane ? "" : "preview-hidden"}`}
    style={{ display: "flex", height: "100vh", position: "relative" }}
  >
    {showPreviewPane && (
    <aside className="left-preview-pane" ref={previewPaneRef}>
      <div className="preview-header">Print Preview</div>

      {/* Hidden measurement copy */}
      <div className="preview-hidden-measure">
        {renderPreviewSheet(true)}
      </div>

      {Array.from({ length: previewPageCount })
        .map((_, pageIndex) => pageIndex)
        .filter((pageIndex) => {
          const remainingHeight =
            previewContentHeight -
            pageIndex * PREVIEW_CONTENT_HEIGHT_PX;

          if (pageIndex === 0) return true;
          return remainingHeight > 2;
        })
        .map((pageIndex) => (
          <div
            className="preview-page-card"
            key={`p-${pageIndex}`}
          >
            <div className="preview-page-label">
              Page {pageIndex + 1}
            </div>

            <div
              className="preview-page-box"
              style={{
                height: PREVIEW_SCALED_PAGE_HEIGHT_PX,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
              }}
            >
              {/* HEADER RESERVED SPACE */}
              <div
                className="preview-page-header"
                style={{
                  height: PREVIEW_SCALED_HEADER_HEIGHT_PX,
                  flexShrink: 0
                }}
              />
              {/* CONTENT WINDOW */}
              <div
                className="preview-page-content-window"
                style={{
                  height: PREVIEW_SCALED_CONTENT_HEIGHT_PX,
                  overflow: "hidden",
                  position: "relative"
                }}
              >
                <div
                  className="preview-page-shift"
                  style={{
                    transform: `scale(${previewScale})`,
                    transformOrigin: "top left"
                  }}
                >
                  <div
                    className="preview-page-translate"
                    style={{
                      transform: `translateY(-${
                        pageIndex * PREVIEW_CONTENT_HEIGHT_PX
                      }px)`,
                      transformOrigin: "top left"
                    }}
                  >
                    {renderPreviewSheet(false)}
                  </div>
                </div>
              </div>

              {/* FOOTER */}
              {PREVIEW_SCALED_FOOTER_HEIGHT_PX > 0 && (
                <div
                  className="preview-page-footer"
                  style={{
                    height: PREVIEW_SCALED_FOOTER_HEIGHT_PX,
                    flexShrink: 0
                  }}
                />
              )}
            </div>
          </div>
        ))}
    </aside>
    )}
    <div
  id="createViewerPanel"
  ref={viewerRef}
  style={{
    width: getViewerWidth(),
    flex: `0 0 ${getViewerWidth()}`,
    transition: "width 0.3s ease",
    height: "100%",
    borderRight: "2px solid #ccc",
    overflow: "hidden",      // ✅ ADD
    position: "relative",    // ✅ ADD
  }}
>
 <iframe
          title="OHIF Viewer"
          src={
            studyUID
              ? `/viewer/?StudyInstanceUIDs=${encodeURIComponent(studyUID)}`
              : ""
          }
          style={{ width: "100%", height: "100%", border: "none" }}
        />
      </div>
      {/* Middle controls (arrows) - left here but you told you moved focus to KeyImages so can hide or keep */}
     <div
  className="create-report-arrows no-print"

  ref={arrowsRef}
  style={{
    position: "absolute",
    top: "50%",
    left: viewerMinimized ? "10%" : reportMinimized ? "90%" : "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 10,
    display: "flex",
    gap: 4
  }}
>


        <button className="arrow" onClick={() => { setReportMinimized(false); setViewerMinimized(true); }} style={{ fontSize: 12, padding: "4px 6px" }}>&lt;&lt;</button>
        <button className="arrow" onClick={() => { setReportMinimized(false); setViewerMinimized(false); }} style={{ fontSize: 12, padding: "4px 6px", margin: 4 }}>&lt; &gt;</button>
        <button className="arrow" onClick={() => { setReportMinimized(true); setViewerMinimized(false); }} style={{ fontSize: 12, padding: "4px 6px" }}>&gt;&gt;</button>
      </div>
{/* Report Panel */}

<div
  ref={reportRef}
  id="createReportPanel"
  className="report-work-area"
  style={{
    width: getReportWidth(),
    flex: `0 0 ${getReportWidth()}`,
    padding: 0,
    boxSizing: "border-box",
    height: "100%",
    overflowY: "auto",
    overflowX: "hidden",
    position: "relative", // needed for overlay
  }}
>
  {/* ====================== */}
  {/* PRINT HEADER */}
  {/* ====================== */}
  <div className="print-header" style={{ display: "none", textAlign: "center", fontWeight: "bold", fontSize: 18, marginBottom: 12 }}>
    Hospital Name
  </div>

  

  
{/* Addendum Section */}
{/* ====================== */}
{isAddendum && (
  <>
    {addendumConfirmed && (
      <div
        style={{
          padding: "6px 8px",
          background: "#f1f3f5",
          borderLeft: "4px solid #0d6efd",
          fontSize: 13,
          marginBottom: 12,
          zIndex: 600,
          position: "relative",
        }}
      >
        <strong>Addendum Reason:</strong> {noteInput}
      </div>
    )}

    {!addendumConfirmed && (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "rgba(15, 23, 42, 0.25)",
          backdropFilter: "blur(3px)",
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "all",
        }}
      >
        <div
          style={{
            width: "min(520px, 92vw)",
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #cfd8e3",
            boxShadow: "0 16px 36px rgba(0,0,0,0.22)",
            padding: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
            Addendum Reason Required
          </div>
          <input
            type="text"
            placeholder="Enter addendum reason"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!noteInput.trim()) {
                  alert("Please enter a reason");
                  return;
                }
                setAddendumConfirmed(true);
              }
            }}
            autoFocus
            style={{
              width: "100%",
              height: 38,
              padding: "0 10px",
              border: "1px solid #b8c0cc",
              borderRadius: 6,
              marginBottom: 10,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                if (!noteInput.trim()) {
                  alert("Please enter a reason");
                  return;
                }
                setAddendumConfirmed(true);
              }}
              style={{
                height: 36,
                padding: "0 14px",
                border: "none",
                borderRadius: 6,
                background: "#0d6efd",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    )}
  </>
)}
       {/* Refined Professional Toolbar - Rounded Rectangle Style */}
<div 
  className="report-toolbar-wrapper" 
  style={{
    display: "flex", 
    flexDirection: isSplitMode ? "column" : "row",
    alignItems: isSplitMode ? "stretch" : "center",
    justifyContent: isSplitMode ? "flex-start" : "space-between",
    gap: isSplitMode ? "4px" : "8px",
    padding: isSplitMode ? "4px 12px 8px 12px" : "3px 12px",
    marginBottom: "10px", 
    backgroundColor: "#587dbc", 
    borderRadius: "25px", // Professional round-shape rectangle
    border: "1px solid #d1d9e0", // Subtle highlight border
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)", // Fit-to-text shadow
    height: "auto",
    minHeight: isSplitMode ? "78px" : "42px",
    width: "100%",
    boxSizing: "border-box",
    overflow: "visible"
  }}
>
  {/* LEFT: EDITING TOOLS */}
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "6px",
      flexShrink: 1,
      flexWrap: isSplitMode ? "wrap" : "nowrap",
      flex: "0 0 auto",
      minWidth: 0,
      width: isSplitMode ? "100%" : "auto",
      overflowX: "visible",
      rowGap: isSplitMode ? "6px" : 0
    }}
  >
    
   {/* 🔢 Font Size: 8-72px (Word Style) */}
<div style={{ display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
  <select
    title="Font Size"
    onChange={(e) => applyPixelFontSize(e.target.value)}
    defaultValue="14"
    style={{
      height: "28px",
      width: "50px",
      borderRadius: "15px",
      border: "1px solid #ccc",
      paddingLeft: "4px",
      cursor: "pointer"
    }}
  >
    {[8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72].map(size => (
      <option key={size} value={size}>{size}</option>
    ))}
  </select>
</div>

    {/* 🔤 Small Font Family */}
    <select 
      title="Font Family" 
      onChange={(e) => exec("fontName", e.target.value)} 
      defaultValue="Arial"
      style={{ height: "28px", width: "70px", borderRadius: "15px", border: "1px solid #ccc", fontSize: "11px", cursor: "pointer" }}
    >
      <option value="Arial">Arial</option>
      <option value="Times New Roman">TNR</option>
      <option value="Calibri">Calibri</option>
      <option value="Georgia">Georgia</option>
      <option value="Verdana">Verdana</option>
      <option value="Courier New">Courier</option>
      <option value="Tahoma">Tahoma</option>
      <option value="Trebuchet MS">Trebuchet</option>
      <option value="Impact">Impact</option>
      <option value="Segoe UI">Segoe</option>
    </select>

    {/* 🅱 Format Dropdown */}
    <select 
      title="Format" 
      onChange={(e) => { if(e.target.value) exec(e.target.value); e.target.value = ""; }} 
      style={{ height: "28px", width: "75px", borderRadius: "15px", border: "1px solid #ccc", cursor: "pointer" }}
    >
      <option value="">Format</option>
      <option value="bold">Bold</option>
      <option value="italic">Italic</option>
      <option value="underline">Underline</option>
      <option value="insertUnorderedList">Bullets</option>
      <option value="insertOrderedList">Numbers</option>
    </select>

    {/* 📐 Align Dropdown */}
    <select 
      title="Align" 
      onChange={(e) => { if(e.target.value) exec(e.target.value); e.target.value = ""; }} 
      style={{ height: "28px", width: "65px", borderRadius: "15px", border: "1px solid #ccc", cursor: "pointer" }}
    >
      <option value="">Align</option>
      <option value="justifyLeft">Left</option>
      <option value="justifyCenter">Center</option>
      <option value="justifyRight">Right</option>
      <option value="justifyFull">Justify</option>
    </select>

<select
  title="Change Case"
  onChange={(e) => {
    const val = e.target.value;
    if (!val) return;
    changeCase(val); // ✅ call your working function
    e.target.value = "";
  }}
  style={{ height: "28px", width: "90px", borderRadius: "15px", border: "1px solid #ccc", cursor: "pointer", fontSize: "11px" }}
>
  <option value="">Case</option>
  <option value="uppercase">UPPERCASE</option>
  <option value="lowercase">lowercase</option>
  <option value="capitalize">Capitalize</option>
</select>
<select
  title="Line Spacing"
  onChange={(e) => {
    const spacing = e.target.value;
    if (!spacing) return;
    setLineSpacing(spacing); // ✅ call your working function
    e.target.value = "";
  }}
  style={{ height: "28px", width: "90px", borderRadius: "15px", border: "1px solid #ccc", cursor: "pointer", fontSize: "11px" }}
>
  <option value="">Line Spacing</option>
  <option value="1">1.0</option>
  <option value="1.15">1.15</option>
  <option value="1.5">1.5</option>
  <option value="2">2.0</option>
</select>

    {/* 🎨 Color Palette */}
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => { saveSelection(); setShowColorPalette(!showColorPalette); }}
        style={{ height: "28px", width: "32px", borderRadius: "50%", border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
      >
        🎨
      </button>
      {showColorPalette && (
        <div style={{ position: "absolute", top: "32px", left: 0, zIndex: 3000 }}>
          <WordColorPicker onSelect={(color) => { applyColor(color); setShowColorPalette(false); }} />
        </div>
      )}
    </div>

    {/* 📂 Templates (Fixed Dropdown Logic) */}
    <div style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setShowTemplateMenu(!showTemplateMenu)}
          style={{ height: "28px", padding: "0 10px", borderRadius: "15px", border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: "11px" }}
        >
          Templates ▼
        </button>
        {showTemplateMenu && (
            <div style={{ position: "absolute", top: "32px", left: 0, background: "#fff", border: "1px solid #ccc", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", borderRadius: "8px", width: "220px", zIndex: 3000, maxHeight: "200px", overflowY: "auto" }}>
                {templates.length === 0 ? (
                  <div style={{ padding: "10px", fontSize: "11px", color: "#888" }}>No templates available</div>
                ) : (
                  templates.map(t => (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f0f0f0" }}>
                        <span style={{ fontSize: "11px", fontWeight: "500" }}>{t.template_name}</span>
                        <button onClick={() => { applyTemplate(t); setShowTemplateMenu(false); }} style={{ background: "#198754", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 6px", cursor: "pointer" }}>+</button>
                    </div>
                  ))
                )}
            </div>
        )}
    </div>

    {/* 🖼 RESTORED: Key Images */}
    <button
      type="button"
      onClick={() => {
        if (!showKeyImages) {
          setShowKeyImages(true);
          setTimeout(() => fileInputRef.current?.click(), 50);
        } else {
          fileInputRef.current?.click();
        }
      }}
      style={{ height: "28px", padding: "0 10px", borderRadius: "15px", border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: "11px" }}
    >
      Key Images
    </button>
    <button
      type="button"
      onClick={() => navigate("/pacspage")}
      style={{ display: isSplitMode ? "inline-flex" : "none", height: "28px", width: "28px", borderRadius: "50%", border: "none", background: "#343a40", color: "#fff", cursor: "pointer", fontWeight: "bold", alignItems: "center", justifyContent: "center" }}
    >
      X
    </button>
  </div>

  {/* RIGHT: VOICE & ACTIONS */}
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: "10px",
      flexShrink: 0,
      flex: "0 0 auto",
      width: isSplitMode ? "100%" : "auto",
      justifyContent: "flex-start",
      backgroundColor: "transparent",
      borderTop: "none",
      borderRadius: 0,
      padding: isSplitMode ? "2px 0 0 0" : 0
    }}
  >
    
    {/* 🎙 Dictation (Icon Only) */}
    <button
      type="button"
      onClick={() => {
        if (isUploadingDictation) return;
        if (dictationMode === "fallback") {
          if (recognitionRunningRef.current || listening) stopFallbackDictation();
          else startFallbackDictation();
          return;
        }
        const rec = recognitionRef.current;
        if (!rec) return;
        if (recognitionRunningRef.current || listening) {
          try {
            rec.stop();
          } catch (err) {
            console.warn("SpeechRecognition stop ignored:", err);
          }
          return;
        }
        try {
          rec.start();
        } catch (err) {
          console.warn("SpeechRecognition start ignored:", err);
        }
      }}
      disabled={isUploadingDictation}
      style={{
        height: "30px", width: "30px", borderRadius: "50%", border: "none",
        background: listening ? "#dc3545" : isUploadingDictation ? "#6c757d" : "#f1f3f5",
        color: listening ? "#fff" : "#444",
        cursor: isUploadingDictation ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        marginLeft: isSplitMode ? "2px" : 0
      }}
    >
      {isUploadingDictation ? "..." : listening ? "⏹" : "🎙️"}
    </button>

    <div style={{ display: "flex", gap: "6px", flexWrap: "nowrap", marginLeft: "6px" }}>
      <button
        type="button"
        onClick={() => setShowPreviewPane((prev) => !prev)}
        style={{
          padding: "4px 12px",
          borderRadius: "15px",
          border: "none",
          cursor: "pointer",
          background: "#6c757d",
          color: "#fff",
          fontWeight: "bold",
          fontSize: "11px",
        }}
      >
        {showPreviewPane ? "PREVIEW OFF" : "PREVIEW ON"}
      </button>
      <button
        onClick={() => window.print()}
        style={{
          padding: "4px 12px",
          borderRadius: "15px",
          border: "none",
          cursor: "pointer",
          background: "#0d6efd",
          color: "#fff",
          fontWeight: "bold",
          fontSize: "11px",
        }}
      >
        PRINT
      </button>
      {!isAddendum ? (
        <>
          {/* 🟡 Highlighted Draft */}
          <button
            onClick={() => handleSaveReport("Draft")}
            style={{
              padding: "4px 12px", borderRadius: "15px", border: "none", cursor: "pointer",
              background: "#ffc107", color: "#000", fontWeight: "bold", fontSize: "11px"
            }}
          >
            DRAFT
          </button>

          {/* 🟢 Highlighted Final */}
          <button
            onClick={() => handleSaveReport("Final")}
            disabled={!study.ApprovedBy}
            style={{
              padding: "4px 12px", borderRadius: "15px", border: "none",
              cursor: study.ApprovedBy ? "pointer" : "not-allowed",
              background: study.ApprovedBy ? "#198754" : "#adb5bd",
              color: "#fff", fontWeight: "bold", fontSize: "11px"
            }}
          >
            FINAL
          </button>
        </>
      ) : (
        <button
          onClick={() => handleSaveReport("Addendum")}
          style={{ padding: "4px 12px", borderRadius: "15px", border: "none", background: "#0d6efd", color: "#fff", fontWeight: "bold", fontSize: "11px" }}
        >
          ADDENDUM
        </button>
      )}

      <button
        type="button"
        onClick={fetchDicomMeasurements}
        disabled={isSyncingDicom}
        style={{
          background: "#16a34a",
          color: "#fff",
          border: "none",
          borderRadius: "15px",
          padding: "4px 10px",
          fontSize: "11px",
          fontWeight: "bold",
          cursor: "pointer"
        }}
      >
        {isSyncingDicom ? "Syncing..." : "📊 Sync DICOM"}
      </button>

      <select
        onChange={(e) => {
          if (e.target.value) insertStructuredTable(e.target.value);
          e.target.value = "";
        }}
        style={{
          background: "#fff",
          border: "1px solid #ccc",
          borderRadius: "15px",
          padding: "3px 8px",
          fontSize: "11px",
          fontWeight: "bold",
          cursor: "pointer",
          color: "#1e40af"
        }}
      >
        <option value="">➕ Tables</option>
        <option value="CT">CT Organometry</option>
        <option value="US_ANOMALY">USG Anomaly Scan</option>
        <option value="US_DOPPLER">USG Doppler Table</option>
      </select>

      {/* ✕ Close */}
      <button 
        onClick={() => navigate("/pacspage")} 
        style={{ display: isSplitMode ? "none" : "inline-flex", height: "28px", width: "28px", borderRadius: "50%", border: "none", background: "#343a40", color: "#fff", cursor: "pointer", fontWeight: "bold", alignItems: "center", justifyContent: "center" }}
      >
        ✕
      </button>
    </div>
  </div>
</div>


        <div
          className="report-sheet"
          ref={reportSheetRef}
          style={{
            width: "210mm",
            minHeight: "297mm",
            height: "auto",
            background: "#fff",
            border: "1px solid #c7d0dc",
            padding: "30mm 15mm 20mm 15mm",
            boxSizing: "border-box",
            display: "flow-root",
          }}
        >
        {/* Patient table */}
        <table className="data-table print-keep-together" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <tbody>
            <tr>
              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Patient Name:</strong> {cleanPatientName(patientName)}
              </td>
              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Age/Gender:</strong> {age}/{gender}
              </td>
              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Patient ID:</strong> {study.PatientID}
              </td>
            </tr>

            <tr>
              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Study Date/Time:</strong>{" "}
                {formatDicomDateTime(study.StudyDate, study.StudyTime)}
              </td>
      <td style={{ padding: 6, border: "1px solid #000" }}>
  <strong>Ref. Doctor:</strong>{" "}
  {editRefDoctor ? (
    <input
      autoFocus
      value={study.ReferringPhysicianName || ""}
      onChange={(e) =>
        setStudy((p) => ({ ...p, ReferringPhysicianName: e.target.value }))
      }
      onBlur={() => setEditRefDoctor(false)}
      onKeyDown={(e) => e.key === "Enter" && setEditRefDoctor(false)}
      style={{ width: "70%" }}
    />
  ) : (
    <span
      onClick={() => setEditRefDoctor(true)}
      
    >
      {study.ReferringPhysicianName || "—"}
    </span>
  )}
</td>


              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Accession No:</strong>{" "}
                {editAccession ? (
                  <input
                    autoFocus
                    value={study.AccessionNumber || ""}
                    onChange={(e) =>
                      setStudy((p) => ({ ...p, AccessionNumber: e.target.value }))
                    }
                    onBlur={() => setEditAccession(false)}
                    onKeyDown={(e) => e.key === "Enter" && setEditAccession(false)}
                    style={{ width: "70%" }}
                  />
                ) : (
                  <span onClick={() => setEditAccession(true)}>
                    {study.AccessionNumber || "-"}
                  </span>
                )}
              </td>
            </tr>

            <tr>
              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Reported Date/Time:</strong> {formatDateTime(new Date())}
              </td>
              <td style={{ padding: 6, border: "1px solid #000" }}>
                <strong>Modality:</strong> {study.Modality}
              </td>
             <td style={{ padding: 6, border: "1px solid #000" }}>
  <strong>Body Part:</strong>{" "}
  {editBodyPart ? (
    <input
      autoFocus
      value={study.BodyPartExamined || ""}
      onChange={(e) =>
        setStudy((p) => ({ ...p, BodyPartExamined: e.target.value }))
      }
      onBlur={() => setEditBodyPart(false)}
      onKeyDown={(e) => e.key === "Enter" && setEditBodyPart(false)}
      style={{ width: "70%" }}
    />
  ) : (
    <span
      onClick={() => setEditBodyPart(true)}
      
    >
      {study.BodyPartExamined || "—"}
    </span>
  )}
</td>
            </tr>
          </tbody>
        </table>

       <div
         className="report-title-inline"
         contentEditable
         suppressContentEditableWarning
         onBlur={(e) => {
           setReportTitle(e.currentTarget.innerText);
           setIsManualTitle(true);
         }}
       >
         {reportTitle}
       </div>




        {/* History */}
        <section className="section" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, marginBottom: 8 }}>History</h3>
         <RichEditor
  value={history}
  onChange={setHistory}
  onFocus={handleEditorFocus}
  onSelectionChange={handleEditorSelectionChange}
  placeholder="Enter history..."
  disabled={isAddendum && !addendumConfirmed}
  editorKey="history" 
/>

        </section>

        {/* Findings */}
       <section className="section" style={{ marginBottom: 20 }}>
  <h3 style={{ fontSize: 12, marginBottom: 8 }}>Findings</h3>
  <RichEditor
    value={findings}
    onChange={setFindings}
    onFocus={handleEditorFocus}
    onSelectionChange={handleEditorSelectionChange}
    placeholder="Enter findings..."
    disabled={isAddendum && !addendumConfirmed}
   editorKey="findings"
  />
</section>


        {/* Key Images */}
        {showKeyImages && (
          <section className="section section-key-images" style={{ marginBottom: 20 }}>
            <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              Key Images
              <button
                style={{ background: "transparent", border: "none", fontSize: 12, cursor: "pointer", color: "#555" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowKeyImages(false);
                  // keep current images or clear them depending on desired behaviour
                }}
              >
                ✕
              </button>
            </h3>

            {/* hidden input (will open when container clicked or "Key Images" clicked) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleFiles(e.target.files)}
            />

            <div
              className="key-images"
              onClick={() => fileInputRef.current?.click()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
              onDragOver={(e) => e.preventDefault()}
              style={{
                border: "none",
                minHeight: 120,
                padding: 10,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              {keyImages.length === 0 && <div style={{ color: "#666" }}>Click to add images or drag & drop</div>}
           {keyImages.map((src, i) => (
  <div
    key={i}
    className="key-image-item"
    style={{ position: "relative", width: 120, height: 120 }}
  >
   <img
  src={apiUrl(src)}
  alt={`ki-${i}`}
  style={{
    width: "100%",
    height: "100%",
    objectFit: "contain",
    border: "none",
    borderRadius: 6,
  }}
/>

    <button
      className="remove-btn"
      onClick={(e) => {
        e.stopPropagation();
        setKeyImages((prev) => prev.filter((_, idx) => idx !== i));
      }}
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        background: "rgba(0,0,0,0.6)",
        color: "#fff",
        border: "none",
        borderRadius: "50%",
        width: 22,
        height: 22,
        cursor: "pointer",
      }}
    >
      ✕
    </button>
  </div>
))}

            </div>
          </section>
        )}

        {/* Conclusion */}
        <section className="section" style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 12, marginBottom: 8 }}>Conclusion</h3>
          <RichEditor
  value={conclusion}
  onChange={setConclusion}
  onFocus={handleEditorFocus}
  onSelectionChange={handleEditorSelectionChange}
  placeholder="Enter conclusion..."
  disabled={isAddendum && !addendumConfirmed}
 editorKey="conclusion"
/>
        </section>

   {/* ====================== */}
{/* Footer */}
{/* ====================== */}
<footer
  className="footer-row print-keep-together"
  style={{ display: "flex", justifyContent: "space-between", marginTop: 30 }}
>
  <div style={{ fontWeight: "bold", fontSize: 11 }}>
    Reported By:
    <DigitalSignatureField
  type="reported"
  value={study.ReportedBy}
  onSelect={(data) =>
    setStudy((prev) => ({ ...prev, ReportedBy: data }))
  }
/>
  </div>

  <div style={{ fontWeight: "bold", fontSize: 11 }}>
    Approved By:
    <DigitalSignatureField
  type="approved"
  value={study.ApprovedBy}
  onSelect={(data) =>
    setStudy((prev) => ({ ...prev, ApprovedBy: data }))
  }
/>
  </div>
</footer>
        </div>
      </div>
  {/* ====================== */}
  {/* PRINT FOOTER */}
  {/* ====================== */}
  <div className="print-footer" style={{ display: "none", textAlign: "center", fontSize: 12, marginTop: 20 }}>
    123 Main Street, City, State, ZIP | Phone: 123-456-7890
  </div>
  <div className="print-page-number" style={{ display: "none" }} />
    </div>
    
  );
}


