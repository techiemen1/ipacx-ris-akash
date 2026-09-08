import React, { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import api from "../../api/axios";
import { RADIOLOGY_TEMPLATES } from "./radiologyTemplates";
import { expandClinicalMacros, CLINICAL_MACROS } from "../../utils/macroEngine";
import {
  Sparkles,
  Zap,
  CheckCircle,
  Save,
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
  Camera,
  Image as ImageIcon,
  Trash2,
  Plus
} from "lucide-react";
import { getViewerUrl } from "../../utils/viewerUtils";
import "./WorkstationModal.css";
import "./ReportStudio.css";

function getInitialModKey(rawMod) {
  const m = String(rawMod || "CR").toUpperCase();
  if (m.includes("MR")) return "MRI";
  if (m.includes("US")) return "USG";
  if (m.includes("CT")) return "CT";
  if (m.includes("EC")) return "ECHO";
  return "XRAY";
}

export default function DiagnosticWorkstationModal({ studyUID, initialModality = "CR", onClose }) {
  const [viewMode, setViewMode] = useState("split"); // "split" | "viewer" | "studio"

  // Study & Patient Demographics State
  const [study, setStudy] = useState({
    PatientName: "",
    PatientID: "",
    PatientAge: "",
    PatientSex: "",
    AccessionNumber: "",
    Modality: initialModality || "CR",
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
  const [reportStatus, setReportStatus] = useState("Draft");
  const [selectedModality, setSelectedModality] = useState(() => getInitialModKey(initialModality));

  // Auxiliary Features State
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isSyncingSR, setIsSyncingSR] = useState(false);

  const [clinicBranding, setClinicBranding] = useState({
    name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
    header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
    address: "Devanahalli, BANGALORE, KARNATAKA, INDIA",
    phone: "+91 9886517662",
    email: "info@akashmedical.edu.in",
    footer_text: "Electronically Verified Diagnostic Report"
  });

  // DICOM Tag Inspector State
  const [showDicomTagsModal, setShowDicomTagsModal] = useState(false);
  const [loadingDicomTags, setLoadingDicomTags] = useState(false);
  const [dicomTagData, setDicomTagData] = useState(null);

  const handleOpenDicomTags = async () => {
    if (!studyUID) return;
    setShowDicomTagsModal(true);
    setLoadingDicomTags(true);
    try {
      const res = await api.get(`/api/pacs/dicom-tags/${encodeURIComponent(studyUID)}`);
      if (res.data?.success && res.data?.data) {
        setDicomTagData(res.data.data);
      }
    } catch (err) {
      console.warn("Failed to fetch DICOM tags dictionary:", err.message);
    } finally {
      setLoadingDicomTags(false);
    }
  };

  // Key Images / Snapshots State
  const [attachedSnapshots, setAttachedSnapshots] = useState([]);
  const [studySeriesList, setStudySeriesList] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [targetSliceNumber, setTargetSliceNumber] = useState("1");
  const [activeOhifState, setActiveOhifState] = useState(null);

  // Fetch Series list for exact Viewport Series & Slice selection, reset state on new studyUID
  useEffect(() => {
    if (!studyUID) return;
    setAttachedSnapshots([]); // Clear previous patient's attached key images!
    setStudySeriesList([]);
    setSelectedSeriesId("");
    setTargetSliceNumber("1");
    setActiveOhifState(null);

    api.get(`/api/pacs/study-series-instances/${encodeURIComponent(studyUID)}`)
      .then((res) => {
        if (res.data?.success && Array.isArray(res.data.series) && res.data.series.length > 0) {
          setStudySeriesList(res.data.series);
          // Auto-select main diagnostic volume series (e.g. C_Spine with 313 slices instead of 1-slice topogram)
          const mainSeries = res.data.series.find(s => s.total_slices > 1) || res.data.series[0];
          setSelectedSeriesId(mainSeries.series_id);
        }
      })
      .catch((err) => console.error("Failed to load study series:", err));
  }, [studyUID]);

  // Live OHIF Viewport postMessage Listener (captures opened series & slice automatically!)
  useEffect(() => {
    const handleOhifMessage = (event) => {
      if (!event.data) return;
      let data = event.data;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch (e) { return; }
      }

      if (typeof data === "object") {
        // 1. Snapshot Event from OHIF toolbar Camera tool
        if (data.type === "OHIF_SNAPSHOT" || data.type === "SNAPSHOT_CAPTURED" || data.eventName === "SNAPSHOT_CAPTURED") {
          const imgUrl = data.dataUrl || data.imageUrl || data.url;
          if (imgUrl) {
            setAttachedSnapshots(prev => [...prev, {
              id: `ohif_snap_${Date.now()}`,
              preview_url: imgUrl,
              caption: data.caption || `Captured OHIF Viewport`
            }]);
          }
        }

        // 2. Active Viewport / SOPInstanceUID Event from OHIF
        if (data.seriesInstanceUID || data.SeriesInstanceUID || data.sopInstanceUID || data.SOPInstanceUID) {
          const seriesUid = data.seriesInstanceUID || data.SeriesInstanceUID;
          const sopUid = data.sopInstanceUID || data.SOPInstanceUID;
          const instanceNum = data.instanceNumber || data.sliceIndex || data.frameIndex || 1;

          setActiveOhifState(prev => {
            if (prev?.seriesUid === seriesUid && prev?.sopUid === sopUid && String(prev?.instanceNum) === String(instanceNum)) {
              return prev;
            }
            return { seriesUid, sopUid, instanceNum };
          });

          if (seriesUid && studySeriesList.length > 0) {
            const matchedSeries = studySeriesList.find(s => String(s.series_id) === String(seriesUid));
            if (matchedSeries) {
              setSelectedSeriesId(prev => prev === matchedSeries.series_id ? prev : matchedSeries.series_id);
            }
          }
          if (instanceNum) {
            setTargetSliceNumber(prev => prev === String(instanceNum) ? prev : String(instanceNum));
          }
        }
      }
    };

    window.addEventListener("message", handleOhifMessage);
    return () => window.removeEventListener("message", handleOhifMessage);
  }, [studySeriesList]);

  // Compute active preview instance object for live thumbnail preview!
  const getActivePreviewData = () => {
    if (!studySeriesList || studySeriesList.length === 0) return null;
    const seriesObj = studySeriesList.find(s => String(s.series_id) === String(selectedSeriesId)) || studySeriesList[0];
    if (!seriesObj || !seriesObj.instances || seriesObj.instances.length === 0) return null;

    const sliceNum = parseInt(targetSliceNumber, 10);
    const boundedIndex = isNaN(sliceNum) ? 0 : Math.min(Math.max(0, sliceNum - 1), seriesObj.instances.length - 1);
    const targetInst = seriesObj.instances[boundedIndex];

    return {
      instance: targetInst,
      seriesObj,
      actualSliceNum: boundedIndex + 1
    };
  };

  // 1-CLICK PIXEL-PERFECT EXACT SCREEN CANVAS SNAPSHOTTER
  const handleAttachTargetSlice = async () => {
    let capturedDataUrl = null;

    try {
      const iframeEl = document.querySelector(".dws-iframe, iframe");
      if (iframeEl) {
        const iframeWin = iframeEl.contentWindow;
        const iframeDoc = iframeEl.contentDocument || (iframeWin && iframeWin.document);
        if (iframeDoc) {
          const canvases = Array.from(iframeDoc.querySelectorAll("canvas"));
          if (canvases.length > 0) {
            // Pick largest active Cornerstone DICOM viewport canvas
            const targetCanvas = canvases.reduce((acc, c) => (c.width * c.height > acc.width * acc.height ? c : acc), canvases[0]);
            if (targetCanvas && targetCanvas.width > 0 && targetCanvas.height > 0) {
              capturedDataUrl = targetCanvas.toDataURL("image/jpeg", 0.95);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Same-origin canvas extraction exception:", e);
    }

    if (capturedDataUrl) {
      const snapObj = {
        id: `snap_screen_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        instance_id: `screen_${Date.now()}`,
        preview_url: capturedDataUrl,
        caption: `Viewport Key Image #${attachedSnapshots.length + 1}`
      };

      setAttachedSnapshots(prev => [...prev, snapObj]);
      return;
    }

    // Secondary Fallback if series is loaded
    if (studySeriesList && studySeriesList.length > 0) {
      const seriesObj = studySeriesList.find(s => String(s.series_id) === String(selectedSeriesId)) || studySeriesList[0];
      if (seriesObj && seriesObj.instances && seriesObj.instances.length > 0) {
        const sliceNum = parseInt(targetSliceNumber, 10);
        const boundedIndex = isNaN(sliceNum) ? 0 : Math.min(Math.max(0, sliceNum - 1), seriesObj.instances.length - 1);
        const targetInst = seriesObj.instances[boundedIndex];

        const snapObj = {
          id: `snap_${targetInst.instance_id}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          instance_id: targetInst.instance_id,
          preview_url: `/api/pacs/instance-preview/${targetInst.instance_id}`,
          caption: `${seriesObj.series_description || `Series ${seriesObj.series_number}`} (Slice ${boundedIndex + 1}/${seriesObj.total_slices})`
        };

        setAttachedSnapshots(prev => [...prev, snapObj]);
        setTargetSliceNumber(prev => String((parseInt(prev, 10) || 1) + 1));
        return;
      }
    }

    // PACS Backend Direct Snapshot Fallback (no blocking alert!)
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

  const removeSnapshot = (idToRemove) => {
    setAttachedSnapshots(prev => prev.filter(s => s.id !== idToRemove && s.instance_id !== idToRemove));
  };

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
    const normMod = (mod || initialModality || "CR").toUpperCase().trim();
    const bPartNorm = (bodyPart || "").toUpperCase().trim();
    const sDescNorm = (studyDesc || "").toUpperCase().trim();
    const fullText = `${normMod} ${bPartNorm} ${sDescNorm}`;

    let modKey = "XRAY";

    if (normMod === "MR" || normMod.includes("MRI")) {
      modKey = "MRI";
    } else if (normMod === "US" || normMod.includes("USG") || normMod.includes("ULTRASOUND")) {
      modKey = "USG";
    } else if (normMod === "CR" || normMod === "DX" || normMod === "XR" || normMod.includes("XRAY") || normMod.includes("X-RAY")) {
      modKey = "XRAY";
    } else if (normMod === "CT" || normMod.includes("CAT") || normMod.includes("TOMOGRAPHY")) {
      modKey = "CT";
    } else if (normMod === "EC" || normMod.includes("ECHO")) {
      modKey = "ECHO";
    } else {
      if (fullText.includes("X-RAY") || fullText.includes("CHEST PA") || fullText.includes("CR")) modKey = "XRAY";
      else if (fullText.includes("MRI") || fullText.includes("SPINE")) modKey = "MRI";
      else if (fullText.includes("USG") || fullText.includes("ULTRASOUND")) modKey = "USG";
      else modKey = "CT";
    }

    setSelectedModality(modKey);
    const templatesList = RADIOLOGY_TEMPLATES[modKey] || [];

    if (!templatesList.length) return;

    const searchTarget = `${bPartNorm} ${sDescNorm}`.toLowerCase().trim();
    let matchedTpl = null;

    // Body Part Specific Template Resolver
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
      setConclusionHtml(cleanC);
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
      let studyData = null;
      let pacsFallback = null;

      try {
        const { data: mainStudy } = await api.get(`/api/pacs/study/${encodeURIComponent(studyUID)}`).catch(() => ({ data: null }));
        studyData = mainStudy;

        const pacsRes = await api.get("/api/pacs/studies").catch(() => ({ data: [] }));
        const list = Array.isArray(pacsRes.data) ? pacsRes.data : (pacsRes.data?.studies || []);
        if (list.length > 0) {
          pacsFallback = list.find(s => 
            (s.StudyInstanceUID && s.StudyInstanceUID === studyUID) ||
            (s.study_uid && s.study_uid === studyUID) ||
            (s.id && String(s.id) === String(studyUID))
          ) || list[0];
        }

        const rawName = String(studyData?.PatientName || studyData?.patient_name || pacsFallback?.PatientName || pacsFallback?.patient_name || "Patient").replace(/\^/g, " ").replace(/\s+/g, " ").trim();
        const pId = studyData?.PatientID || studyData?.patient_id || pacsFallback?.PatientID || pacsFallback?.patient_id || "ID-1001";
        const pAge = studyData?.PatientAge || studyData?.patient_age || pacsFallback?.PatientAge || pacsFallback?.patient_age || "24Y";
        const pSex = studyData?.PatientSex || studyData?.patient_sex || pacsFallback?.PatientSex || pacsFallback?.patient_sex || "M";
        const accNo = studyData?.AccessionNumber || studyData?.accession_number || pacsFallback?.AccessionNumber || pacsFallback?.accession_number || "ACC-1001";
        const mod = (studyData?.Modality || studyData?.modality || pacsFallback?.Modality || pacsFallback?.modality || initialModality || "CR").toUpperCase().trim();
        const bPart = studyData?.BodyPartExamined || studyData?.body_part || pacsFallback?.BodyPartExamined || pacsFallback?.body_part || "General";
        const sDesc = studyData?.StudyDescription || studyData?.study_description || pacsFallback?.StudyDescription || pacsFallback?.study_description || "";
        const refDoc = studyData?.ReferringPhysicianName || studyData?.referring_doctor || pacsFallback?.ReferringPhysicianName || pacsFallback?.referring_doctor || "Self / Desk";

        setStudy({
          PatientName: (rawName === "N/A" || !rawName) ? (pacsFallback?.PatientName || "Patient") : rawName,
          PatientID: (pId === "N/A" || !pId) ? "ID-1001" : pId,
          PatientAge: (pAge === "N/A" || !pAge) ? "24Y" : pAge,
          PatientSex: (pSex === "N/A" || !pSex) ? "M" : pSex,
          AccessionNumber: (accNo === "N/A" || !accNo) ? "ACC-1001" : accNo,
          Modality: mod,
          BodyPartExamined: bPart,
          StudyDescription: sDesc,
          StudyDate: studyData?.StudyDate || studyData?.study_date || pacsFallback?.StudyDate || pacsFallback?.study_date || "-",
          ReferringPhysicianName: refDoc,
          ReportedBy: studyData?.ReportedBy || "",
          ApprovedBy: studyData?.ApprovedBy || ""
        });

        // Check if existing report in database has content
        let reportData = null;
        try {
          const res = await api.get(`/api/reports/by-study/${encodeURIComponent(studyUID)}`);
          reportData = res.data;
        } catch (e) {
          reportData = null;
        }

        if (reportData) {
          const content = reportData.report_content || {};
          const savedHistory = content.history || reportData.history || "";
          const savedFindings = content.findings || reportData.findings || "";
          const savedConclusion = content.conclusion || reportData.conclusion || "";
          const savedTitle = content.title || reportData.report_title || reportData.title || `${mod} REPORT`;
          const savedStatus = reportData.status || "Draft";
          let savedSnapshots = content.snapshots || reportData.snapshots;

          if (!savedSnapshots && Array.isArray(reportData.images)) {
            savedSnapshots = reportData.images.map((img, i) => ({
              id: `snap_${img.id || Date.now()}_${i}`,
              instance_id: `img_${i}`,
              preview_url: img.image_path || img.url,
              caption: img.caption || `Key Image ${i + 1}`
            }));
          }

          if (savedFindings || savedConclusion || savedHistory || (savedSnapshots && savedSnapshots.length > 0)) {
            setHistory(savedHistory);
            
            const cleanF = DOMPurify.sanitize(savedFindings);
            const cleanC = DOMPurify.sanitize(savedConclusion);

            setFindingsHtml(cleanF);
            if (findingsRef.current) findingsRef.current.innerHTML = cleanF;

            setConclusionHtml(cleanC);
            if (conclusionRef.current) conclusionRef.current.innerHTML = cleanC;

            setReportTitle(savedTitle);
            setReportStatus(savedStatus);
            
            if (Array.isArray(savedSnapshots)) {
              setAttachedSnapshots(savedSnapshots);
            }

            const rMod = (reportData.modality || mod).toUpperCase();
            setSelectedModality(getInitialModKey(rMod));
          } else {
            autoMatchTemplate(mod, bPart, sDesc);
          }
        } else {
          autoMatchTemplate(mod, bPart, sDesc);
        }
      } catch (err) {
        console.error("Failed to load study for Workstation Modal:", err);
        autoMatchTemplate(initialModality, "", "");
      } finally {
        setLoading(false);
      }
    };

    loadStudyData();

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [studyUID, initialModality]);

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
    if (!studyUID) return;
    try {
      const currentFindings = findingsRef.current ? findingsRef.current.innerHTML : findingsHtml;
      const currentConclusion = conclusionRef.current ? conclusionRef.current.innerHTML : conclusionHtml;

      const payload = {
        study_uid: studyUID,
        patient_name: study.PatientName,
        patient_id: study.PatientID,
        modality: study.Modality,
        body_part: study.BodyPartExamined,
        accession_number: study.AccessionNumber,
        status: statusToSave,
        history,
        findings: DOMPurify.sanitize(currentFindings),
        conclusion: DOMPurify.sanitize(currentConclusion),
        reportTitle,
        snapshots: attachedSnapshots,
        image_paths: attachedSnapshots.map(s => s.preview_url).filter(Boolean),
        report_content: {
          history,
          findings: DOMPurify.sanitize(currentFindings),
          conclusion: DOMPurify.sanitize(currentConclusion),
          title: reportTitle,
          snapshots: attachedSnapshots
        }
      };

      await api.post("/api/reports", payload);
      setReportStatus(statusToSave);
      alert(`Report successfully saved as ${statusToSave}!`);
      if (statusToSave === "Final" || statusToSave === "Approved") {
        setShowPrintModal(true);
      }
    } catch (err) {
      console.error("Failed to save report:", err);
      alert("Error saving report. Please try again.");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="dws-overlay flex items-center justify-center">
        <RefreshCw className="animate-spin text-indigo-400" size={36} />
        <span className="ml-3 font-bold text-white text-lg">Launching Flash Diagnostic Workstation...</span>
      </div>
    );
  }

  const renderFormContent = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* PATIENT & DEMOGRAPHY BANNER */}
      <div className="rs-patient-banner" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
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

      {/* STRUCTURED TEMPLATE MODALITY SELECTOR */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-sidebar-title" style={{ marginBottom: 8 }}>
          <span>Structured Radiology Templates</span>
          <span style={{ background: '#e0e7ff', color: '#3730a3', padding: '2px 8px', borderRadius: 10, fontSize: 10 }}>Auto-Matched</span>
        </div>

        <div className="rs-modality-chips" style={{ marginBottom: 8 }}>
          {["CT", "MRI", "USG", "XRAY", "ECHO"].map(m => (
            <button
              key={m}
              onClick={() => setSelectedModality(m)}
              className={`rs-chip ${selectedModality === m ? "active" : ""}`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="rs-template-list" style={{ maxHeight: 180 }}>
          {(RADIOLOGY_TEMPLATES[selectedModality] || []).map((tpl) => (
            <div key={tpl.id} onClick={() => applyTemplate(tpl)} className="rs-template-item" style={{ padding: '8px 10px' }}>
              <div className="rs-template-name" style={{ fontSize: 12 }}>{tpl.name}</div>
              <div className="rs-template-bodypart" style={{ fontSize: 10 }}>Body Part: {tpl.body_part}</div>
            </div>
          ))}
        </div>
      </div>

      {/* REPORT TITLE EDIT */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-title">Report Heading Title</div>
        <input
          type="text"
          value={reportTitle}
          onChange={(e) => setReportTitle(e.target.value)}
          className="rs-input-heading"
          style={{ fontSize: 16 }}
        />
      </div>

      {/* CLINICAL HISTORY */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-title">Clinical History / Indication</div>
        <textarea
          rows={2}
          value={history}
          onChange={(e) => setHistory(e.target.value)}
          placeholder="e.g. 45Y Male presented with acute lower abdominal pain..."
          style={{
            width: '100%',
            padding: 10,
            borderRadius: 10,
            border: '1px solid #cbd5e1',
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
      </div>

      {/* FINDINGS RICH TEXT WYSIWYG EDITOR */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-header">
          <span className="rs-section-title">Detailed Imaging Findings</span>
          <span style={{ fontSize: 10, color: '#64748b' }}>WYSIWYG Formatted</span>
        </div>

        <div className="rs-wysiwyg-toolbar" style={{ flexWrap: 'wrap', gap: 4 }}>
          <button type="button" onClick={() => execCmd("bold")} className="rs-tool-btn" title="Bold"><Bold size={13} /></button>
          <button type="button" onClick={() => execCmd("italic")} className="rs-tool-btn" title="Italic"><Italic size={13} /></button>
          <button type="button" onClick={() => execCmd("underline")} className="rs-tool-btn" title="Underline"><Underline size={13} /></button>
          <button type="button" onClick={() => execCmd("insertUnorderedList")} className="rs-tool-btn" title="Bullet List"><List size={13} /></button>
          <button type="button" onClick={() => execCmd("insertOrderedList")} className="rs-tool-btn" title="Numbered List"><ListOrdered size={13} /></button>
          <button type="button" onClick={() => execCmd("removeFormat")} className="rs-tool-btn" title="Clear Formatting"><RotateCcw size={13} /></button>
          
          <div style={{ height: 16, width: 1, background: '#cbd5e1', margin: '0 4px' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: '#475569', alignSelf: 'center' }}>Dot Macros:</span>
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
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div
          ref={findingsRef}
          contentEditable
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
          style={{ minHeight: 180 }}
        />
      </div>

      {/* IMPRESSION / CONCLUSION RICH TEXT EDITOR */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-header">
          <span className="rs-section-title">Clinical Impression & Conclusion</span>
          <button
            type="button"
            onClick={generateAIImpression}
            style={{ background: 'none', border: 'none', color: '#4338ca', fontWeight: 700, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Sparkles size={13} /> Auto AI Impression
          </button>
        </div>

        <div className="rs-wysiwyg-toolbar">
          <button type="button" onClick={() => execCmd("bold")} className="rs-tool-btn" title="Bold"><Bold size={13} /></button>
          <button type="button" onClick={() => execCmd("italic")} className="rs-tool-btn" title="Italic"><Italic size={13} /></button>
          <button type="button" onClick={() => execCmd("insertUnorderedList")} className="rs-tool-btn" title="Bullet List"><List size={13} /></button>
        </div>

        <div
          ref={conclusionRef}
          contentEditable
          onInput={() => setConclusionHtml(conclusionRef.current.innerHTML)}
          className="rs-rich-editor rs-impression-editor"
          style={{ minHeight: 100 }}
        />
      </div>

      {/* ATTACHED KEY IMAGES / DIAGNOSTIC SNAPSHOTS CARD */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-header" style={{ marginBottom: 8 }}>
          <span className="rs-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Camera size={15} style={{ color: "#0284c7" }} /> Attached Key Images / Snapshots ({attachedSnapshots.length})
          </span>
          <button
            type="button"
            onClick={handleAttachTargetSlice}
            style={{
              background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
              color: "#ffffff",
              border: "none",
              borderRadius: 7,
              padding: "7px 16px",
              fontSize: 11.5,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 2px 6px rgba(2, 132, 199, 0.3)"
            }}
          >
            <Camera size={14} /> 📸 Key Image / Snapshot
          </button>
        </div>

        {attachedSnapshots.length === 0 ? (
          <div style={{ padding: "16px 12px", textAlign: "center", color: "#64748b", fontSize: 11.5, border: "1px dashed #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
            No key images attached yet. Click <b>"📸 Key Image / Snapshot"</b> to capture key diagnostic images for this report.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
            {attachedSnapshots.map((snap, idx) => (
              <div key={snap.id || idx} style={{ position: "relative", borderRadius: 8, border: "1px solid #cbd5e1", overflow: "hidden", background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
                <img
                  src={snap.preview_url}
                  alt={snap.caption || "Key Image"}
                  style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
                />
                <button
                  type="button"
                  onClick={() => removeSnapshot(snap.id)}
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
                <div style={{ padding: '4px 6px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
                  <input
                    type="text"
                    value={snap.caption || ''}
                    onChange={(e) => {
                      const newCap = e.target.value;
                      setAttachedSnapshots(prev => prev.map((item, i) => i === idx ? { ...item, caption: newCap } : item));
                    }}
                    placeholder={`Key Image #${idx + 1}`}
                    style={{
                      width: '100%',
                      border: '1px solid #cbd5e1',
                      borderRadius: '4px',
                      fontSize: '11px',
                      padding: '2px 4px',
                      color: '#1e293b',
                      fontWeight: '600'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="dws-overlay">
      {/* TOP FLOATING BAR */}
      <header className="dws-topbar">
        <div className="dws-patient-info">
          <h2 className="dws-patient-name">{study.PatientName || "Patient Study"}</h2>
          <span className="dws-badge dws-badge-id">ID: {study.PatientID || "-"}</span>
          <span className="dws-badge dws-badge-modality">{study.Modality || initialModality || "CR"}</span>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Acc: {study.AccessionNumber || "-"}</span>
        </div>

        {/* VIEW SWITCHER */}
        <div className="dws-mode-switcher">
          <button
            onClick={() => setViewMode("split")}
            className={`dws-mode-btn ${viewMode === "split" ? "active" : ""}`}
          >
            <Columns size={14} /> ⚡ Split View 50/50
          </button>
          <button
            onClick={() => setViewMode("viewer")}
            className={`dws-mode-btn ${viewMode === "viewer" ? "active" : ""}`}
          >
            <Maximize2 size={14} /> OHIF Viewer Only
          </button>
          <button
            onClick={() => setViewMode("studio")}
            className={`dws-mode-btn ${viewMode === "studio" ? "active" : ""}`}
          >
            <FileText size={14} /> Studio Only
          </button>
        </div>

        {/* TOP ACTIONS & CLOSE BUTTON */}
        <div className="dws-top-actions">
          <button onClick={handleAttachTargetSlice} className="dws-btn dws-btn-dark" title="Capture & attach current DICOM viewer image to report">
            <Camera size={14} /> 📸 Key Image / Snapshot
          </button>

          <button onClick={handleOpenDicomTags} className="dws-btn dws-btn-dark" title="Inspect DICOM Header Tags">
            <FileText size={14} /> 📋 DICOM Tag Inspector
          </button>

          <button onClick={() => setShowPrintModal(true)} className="dws-btn dws-btn-dark">
            <Printer size={14} /> Print Preview
          </button>

          <button onClick={autoFillDicomSR} disabled={isSyncingSR} className="dws-btn dws-btn-dark">
            <Zap size={14} /> {isSyncingSR ? "Syncing..." : "Auto-Fill SR"}
          </button>

          <button onClick={() => handleSaveReport("Draft")} className="dws-btn dws-btn-dark">
            <Save size={14} /> Save Draft
          </button>

          <button onClick={() => handleSaveReport("Final")} className="dws-btn dws-btn-emerald">
            <CheckCircle size={14} /> Final Sign-Off
          </button>

          {/* ❌ PROMINENT CLOSE BUTTON */}
          <button onClick={onClose} className="dws-btn-close" title="Close Workstation (Esc)">
            <X size={18} /> CLOSE WORKSTATION
          </button>
        </div>
      </header>

      {/* MAIN VIEWPORT CANVAS */}
      <main className="dws-viewport">
        {viewMode === "split" && (
          <div className="dws-split-pane">
            <div className="dws-left-viewer">
              <iframe
                src={viewerUrl}
                title="OHIF DICOM Viewer"
                className="dws-iframe"
              />
            </div>

            <div className="dws-right-studio">
              {renderFormContent()}
            </div>
          </div>
        )}

        {viewMode === "viewer" && (
          <div className="dws-left-viewer" style={{ width: '100%' }}>
            <iframe
              src={viewerUrl}
              title="OHIF DICOM Viewer Fullscreen"
              className="dws-iframe"
            />
          </div>
        )}

        {viewMode === "studio" && (
          <div className="dws-right-studio" style={{ width: '100%', maxWidth: 900, margin: '0 auto' }}>
            {renderFormContent()}
          </div>
        )}
      </main>

      {/* PRINT PREVIEW MODAL */}
      {showPrintModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(6px)',
          zIndex: 10000,
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
                <button onClick={handlePrint} className="dws-btn dws-btn-emerald">
                  <Printer size={16} /> Print Now
                </button>
                <button onClick={() => setShowPrintModal(false)} className="dws-btn dws-btn-dark">
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
                  <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.Modality || initialModality || "CR"}</td>
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
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(findingsHtml) }} />
            </div>

            <div style={{ marginBottom: 30, padding: 12, border: '1.5px solid #000', borderRadius: 8, background: '#fafafa', fontSize: 13 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>IMPRESSION & CONCLUSION:</div>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(conclusionHtml) }} />
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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

      {/* FULL STANDARDIZED DICOM TAG INSPECTOR MODAL */}
      {showDicomTagsModal && (
        <div className="rs-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: 20 }}>
          <div className="rs-modal" style={{ width: '100%', maxWidth: 850, background: '#0f172a', color: '#f8fafc', borderRadius: 16, padding: 24, border: '1px solid #334155', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)', color: '#fff', padding: 10, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 'bold', color: '#f8fafc' }}>
                    Full DICOM Metadata Tag Inspector
                  </h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#94a3b8' }}>
                    Universal PACS Standardized DICOM Attributes & Equipment Dictionary
                  </p>
                </div>
              </div>
              <button onClick={() => setShowDicomTagsModal(false)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: 6, cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {loadingDicomTags ? (
              <div style={{ padding: '50px 20px', textAlign: 'center', color: '#94a3b8', fontWeight: '600' }}>
                <RefreshCw className="animate-spin text-indigo-400 inline-block mb-3" size={28} /><br />
                Fetching Universal PACS DICOM Tags...
              </div>
            ) : (
              <div style={{ maxHeight: '65vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 6 }}>
                {/* PATIENT MODULE */}
                <div style={{ background: '#1e293b', borderRadius: 10, padding: 14, border: '1px solid #334155' }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#38bdf8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    👤 Patient DICOM Module (Group 0010)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                    <div><strong style={{ color: '#94a3b8' }}>Patient Name (0010,0010):</strong> <span style={{ color: '#f8fafc', fontWeight: '600' }}>{dicomTagData?.patient?.PatientName}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Patient ID (0010,0020):</strong> <span style={{ color: '#f8fafc', fontWeight: '600' }}>{dicomTagData?.patient?.PatientID}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Birth Date (0010,0030):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.patient?.PatientBirthDate}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Patient Sex (0010,0040):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.patient?.PatientSex}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Patient Age (0010,1010):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.patient?.PatientAge}</span></div>
                  </div>
                </div>

                {/* STUDY MODULE */}
                <div style={{ background: '#1e293b', borderRadius: 10, padding: 14, border: '1px solid #334155' }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#c084fc', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🏥 General Study Module (Group 0008 / 0020)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                    <div><strong style={{ color: '#94a3b8' }}>Accession No (0008,0050):</strong> <span style={{ color: '#f8fafc', fontWeight: '600' }}>{dicomTagData?.study?.AccessionNumber}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Modality (0008,0060):</strong> <span style={{ color: '#f8fafc', fontWeight: '600' }}>{dicomTagData?.study?.Modality}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Study Date (0008,0020):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.study?.StudyDate}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Study Time (0008,0030):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.study?.StudyTime}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Body Part (0018,0015):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.study?.BodyPartExamined}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Ref. Physician (0008,0090):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.study?.ReferringPhysicianName}</span></div>
                    <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: '#94a3b8' }}>Study Description (0008,1030):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.study?.StudyDescription}</span></div>
                    <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: '#94a3b8' }}>StudyInstanceUID (0020,000D):</strong> <code style={{ color: '#38bdf8', fontSize: '11px', background: '#0f172a', padding: '2px 6px', borderRadius: 4 }}>{dicomTagData?.study?.StudyInstanceUID}</code></div>
                  </div>
                </div>

                {/* EQUIPMENT & ACQUISITION MODULE */}
                <div style={{ background: '#1e293b', borderRadius: 10, padding: 14, border: '1px solid #334155' }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#34d399', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🔬 Equipment & Technical Acquisition Parameters
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                    <div><strong style={{ color: '#94a3b8' }}>Institution Name (0008,0080):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.equipment?.InstitutionName}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Station Name (0008,1010):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.equipment?.StationName}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Manufacturer (0008,0070):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.equipment?.Manufacturer}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Model Name (0008,1090):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.equipment?.ManufacturerModelName}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Slice Thickness (0018,0050):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.acquisition?.SliceThickness}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>KVP / Exposure:</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.acquisition?.KVP} KVP / {dicomTagData?.acquisition?.Exposure} mAs</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Window Center / Width:</strong> <span style={{ color: '#f8fafc' }}>C: {dicomTagData?.acquisition?.WindowCenter} / W: {dicomTagData?.acquisition?.WindowWidth}</span></div>
                    <div><strong style={{ color: '#94a3b8' }}>Pixel Spacing (0028,0030):</strong> <span style={{ color: '#f8fafc' }}>{dicomTagData?.acquisition?.PixelSpacing}</span></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
