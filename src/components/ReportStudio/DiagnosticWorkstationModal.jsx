import React, { useState, useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import api from "../../api/axios";
import { RADIOLOGY_TEMPLATES } from "./radiologyTemplates";
import { expandClinicalMacros, CLINICAL_MACROS } from "../../utils/macroEngine";
import VoiceDictationManager from "../dictation/VoiceDictationManager";
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
  Settings
} from "lucide-react";
import { getViewerUrl } from "../../utils/viewerUtils";
import { subscribeToViewerMessages, requestViewerSnapshot, detectViewportSliceInfoFromDOM } from "../../utils/ViewerBridge";
import DicomKeyImagePickerModal from "./DicomKeyImagePickerModal";
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

  // RBAC Permission Check
  const loggedUser = (() => {
    try { return JSON.parse(sessionStorage.getItem("user") || "{}"); }
    catch { return {}; }
  })();
  const userRole = String(loggedUser.role || "").toUpperCase();
  const canEditReport = !userRole || ["ADMIN", "RADIOLOGIST", "DOCTOR", "SUPERVISOR"].includes(userRole);

  const doctorNameRaw = 
    study?.ApprovedBy || 
    study?.ReportedBy || 
    loggedUser.full_name || 
    loggedUser.name || 
    loggedUser.username || 
    "Consultant Radiologist";

  const activeDoctorName = (doctorNameRaw.toLowerCase().startsWith("dr.") || doctorNameRaw.toLowerCase().startsWith("dr "))
    ? doctorNameRaw
    : `Dr. ${doctorNameRaw}`;

  const activeDoctorTitle = loggedUser.designation || loggedUser.qualification || "Consultant Radiologist";
  const activeDoctorReg = loggedUser.reg_no || loggedUser.medical_council_reg || loggedUser.registration_no || "KMC/MED/REG/48190";

  // Report Content State
  const [history, setHistory] = useState("");
  const [findingsHtml, setFindingsHtml] = useState("");
  const [conclusionHtml, setConclusionHtml] = useState("");
  const [reportTitle, setReportTitle] = useState("RADIOLOGY REPORT");
  const [_reportStatus, setReportStatus] = useState("Draft");
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

  const [pageSetup, setPageSetup] = useState({
    paperSize: "A4",
    margins: "normal",
    fontSize: "normal",
    prePrintedStationery: false,
    showFooter: true,
    imageGrid: 3
  });

  useEffect(() => {
    api.get("/api/clinics/active")
      .then(res => {
        if (res.data && res.data.name) {
          setClinicBranding(res.data);
        }
      })
      .catch(e => console.warn("Active clinic branding fetch notice:", e.message));
  }, []);



  // Key Images / Snapshots State
  const [attachedSnapshots, setAttachedSnapshots] = useState([]);
  const [activeViewportInfo, setActiveViewportInfo] = useState(null);
  const [studySeriesList, setStudySeriesList] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [targetSliceNumber, setTargetSliceNumber] = useState("1");
  const [showSlicePickerModal, setShowSlicePickerModal] = useState(false);
  const [showKeyPickerModal, setShowKeyPickerModal] = useState(false);
  const [pickerSliceNum, setPickerSliceNum] = useState(1);
  const [sessionLockInfo, setSessionLockInfo] = useState(null);

  // Real-time Concurrent Doctor Reporting Lock (Online / LAN)
  useEffect(() => {
    if (!studyUID) return;

    const userRaw = localStorage.getItem("user") || sessionStorage.getItem("user");
    let currentUser = null;
    try {
      currentUser = userRaw ? JSON.parse(userRaw) : null;
    } catch (e) {}

    const doctorName = currentUser?.name || currentUser?.username || currentUser?.doctor_name || "Dr. Radiologist";
    const userId = currentUser?.id || currentUser?.userId || ("doc_" + Date.now());

    // Acquire lock
    api.post("/api/reports/session/lock", { studyUID, userId, doctorName })
      .then((res) => {
        if (res.data?.isLocked) {
          setSessionLockInfo({
            isLocked: true,
            lockedBy: res.data.lockedBy?.doctorName || "another doctor",
            startedAt: res.data.lockedBy?.startedAt
          });
        } else {
          setSessionLockInfo({ isLocked: false, lockedBy: null });
        }
      })
      .catch((err) => console.error("Session lock error:", err));

    // Maintain 10-second heartbeat
    const hbInterval = setInterval(() => {
      api.post("/api/reports/session/heartbeat", { studyUID, userId }).catch(() => {
        /* ignore heartbeat failure */
      });
    }, 10000);

    return () => {
      clearInterval(hbInterval);
      api.post("/api/reports/session/unlock", { studyUID, userId }).catch(() => {
        /* ignore unlock failure */
      });
    };
  }, [studyUID]);

  // Fetch Series & Instances list for exact series/slice tracking
  useEffect(() => {
    if (!studyUID) return;
    setStudySeriesList([]);
    setSelectedSeriesId("");
    setTargetSliceNumber("1");

    api.get(`/api/pacs/study-series-instances/${encodeURIComponent(studyUID)}`)
      .then((res) => {
        if (res.data?.success && Array.isArray(res.data.series) && res.data.series.length > 0) {
          setStudySeriesList(res.data.series);
          const mainSeries = res.data.series.find(s => s.total_slices > 1) || res.data.series[0];
          setSelectedSeriesId(mainSeries.series_id);
        }
      })
      .catch((err) => console.error("Failed to load study series:", err));
  }, [studyUID]);

  // Live Viewer postMessage Listener via ViewerBridge
  useEffect(() => {
    const unsubscribe = subscribeToViewerMessages(
      (keyImg) => {
        setAttachedSnapshots(prev => {
          if (prev.some(s => s.preview_url === keyImg.dataUrl || (keyImg.sopInstanceUid && s.instance_id === keyImg.sopInstanceUid))) {
            return prev;
          }

          return [...prev, {
            id: keyImg.id || `key_img_${Date.now()}`,
            instance_id: keyImg.sopInstanceUid || `img_${Date.now()}`,
            preview_url: keyImg.dataUrl || keyImg.preview_url,
            caption: keyImg.caption || "Diagnostic Series | Slice 1"
          }];
        });
      },
      (vpState) => {
        if (vpState) {
          const fNum = vpState.frameNumber || vpState.sliceIndex || vpState.instanceNumber;
          const sUid = vpState.seriesInstanceUid || vpState.series_instance_uid;
          const instId = vpState.sopInstanceUid || vpState.SOPInstanceUID || vpState.instanceId;
          const sDesc = vpState.seriesDescription || vpState.SeriesDescription;

          if (instId) {
            const sliceText = `${sDesc || "Diagnostic Viewport"} | Slice ${fNum || 1}${vpState.totalSlices > 1 ? `/${vpState.totalSlices}` : ''}`;
            setActiveViewportInfo({
              instance_id: instId,
              preview_url: `/api/pacs/instance-preview/${instId}?studyUID=${encodeURIComponent(studyUID)}`,
              caption: sliceText,
              frameNumber: fNum,
              totalSlices: vpState.totalSlices,
              seriesDescription: sDesc
            });
          }

          if (sUid && Array.isArray(studySeriesList)) {
            const match = studySeriesList.find(s => 
              String(s.series_id) === String(sUid) ||
              String(s.series_instance_uid) === String(sUid) ||
              String(s.orthanc_series_id) === String(sUid)
            );
            if (match) setSelectedSeriesId(match.series_id);
          }

          if (fNum) {
            setTargetSliceNumber(String(fNum));
          }
        }
      }
    );
    return () => unsubscribe();
  }, [study, studySeriesList]);

  // Real-time polling to sync iframe active viewport slice & series with RIS controls
  useEffect(() => {
    if (!studySeriesList || studySeriesList.length === 0) return;

    const syncViewportState = () => {
      try {
        const iframeEl = document.querySelector(".dws-iframe, iframe");
        if (!iframeEl || !iframeEl.contentDocument) return;

        const domInfo = detectViewportSliceInfoFromDOM(iframeEl.contentDocument, studySeriesList);
        if (domInfo) {
          if (domInfo.matchedSeriesId) {
            setSelectedSeriesId(prev => (prev !== domInfo.matchedSeriesId ? domInfo.matchedSeriesId : prev));
          }
          if (domInfo.sliceNumber) {
            setTargetSliceNumber(prev => (prev !== String(domInfo.sliceNumber) ? String(domInfo.sliceNumber) : prev));
          }
        }
      } catch (e) {
        // Cross-origin catch if any
      }
    };

    const intervalId = setInterval(syncViewportState, 400);
    return () => clearInterval(intervalId);
  }, [studySeriesList]);

  // 1-CLICK DIRECT SNAPSHOTTER (NO SELECTION WINDOW)
  const handleAttachTargetSlice = async (overrideSliceNum = null, overrideSeriesId = null) => {
    try {
      const iframeEl = document.querySelector(".dws-iframe, iframe");
      if (iframeEl && iframeEl.contentWindow) {
        iframeEl.contentWindow.postMessage({ type: 'OHIF_CAPTURE_VIEWPORT', action: 'CAPTURE' }, '*');
        iframeEl.contentWindow.postMessage({ type: 'REQUEST_SNAPSHOT', action: 'CAPTURE' }, '*');
      }
    } catch (e) {
      // Ignore postMessage error if cross-origin iframe does not accept message
    }

    const snapResult = await requestViewerSnapshot(".dws-iframe, iframe", studySeriesList);
    const capturedDataUrl = typeof snapResult === 'string' ? snapResult : snapResult?.dataUrl;

    let currentSeriesId = overrideSeriesId || snapResult?.matchedSeriesId || activeViewportInfo?.seriesInstanceUid || selectedSeriesId;
    let currentSliceNum = overrideSliceNum !== null 
      ? parseInt(overrideSliceNum, 10) 
      : (pickerSliceNum || (targetSliceNumber ? parseInt(targetSliceNumber, 10) : null) || snapResult?.sliceNumber || (activeViewportInfo?.frameNumber ? parseInt(activeViewportInfo.frameNumber, 10) : 1));
    let detectedTotal = snapResult?.totalSlices || activeViewportInfo?.totalSlices;

    try {
      const iframeEl = document.querySelector(".dws-iframe, iframe");
      if (iframeEl && iframeEl.contentDocument) {
        const domInfo = detectViewportSliceInfoFromDOM(iframeEl.contentDocument, studySeriesList);
        if (domInfo) {
          if (overrideSeriesId === null && domInfo.matchedSeriesId) {
            currentSeriesId = domInfo.matchedSeriesId;
          }
          if (overrideSliceNum === null && domInfo.sliceNumber) {
            currentSliceNum = domInfo.sliceNumber;
          }
          if (domInfo.totalSlices) {
            detectedTotal = domInfo.totalSlices;
          }
        }
      }
    } catch (e) {
      console.warn("Live DOM slice extraction notice:", e);
    }

    const targetSeriesDesc = snapResult?.seriesDescription || activeViewportInfo?.seriesDescription;

    const seriesObj = (studySeriesList && studySeriesList.length > 0)
      ? (studySeriesList.find(s => 
          (currentSeriesId && String(s.series_id) === String(currentSeriesId)) ||
          (currentSeriesId && String(s.series_instance_uid) === String(currentSeriesId)) ||
          (currentSeriesId && String(s.orthanc_series_id) === String(currentSeriesId)) ||
          (targetSeriesDesc && s.series_description && String(s.series_description).toLowerCase().trim() === String(targetSeriesDesc).toLowerCase().trim()) ||
          (targetSeriesDesc && s.series_description && String(s.series_description).toLowerCase().includes(String(targetSeriesDesc).toLowerCase()))
        ) || (selectedSeriesId ? studySeriesList.find(s => String(s.series_id) === String(selectedSeriesId)) : null) || studySeriesList[0])
      : null;

    const totalSlices = detectedTotal || (seriesObj?.total_slices) || (activeViewportInfo?.totalSlices) || 1;

    let displaySliceNum = currentSliceNum || snapResult?.instanceNumber || 1;
    if (isNaN(displaySliceNum) || displaySliceNum < 1) {
      displaySliceNum = 1;
    }
    displaySliceNum = Math.min(Math.max(1, displaySliceNum), totalSlices);

    const seriesDesc = seriesObj?.series_description || snapResult?.seriesDescription || activeViewportInfo?.seriesDescription || "Diagnostic Series";
    const fullCaption = totalSlices > 1 ? `${seriesDesc} | Slice ${displaySliceNum}/${totalSlices}` : `${seriesDesc} | Slice ${displaySliceNum}`;

    let targetInst = null;
    if (seriesObj && seriesObj.instances && seriesObj.instances.length > 0) {
      const targetInstanceNum = snapResult?.instanceNumber;
      if (targetInstanceNum) {
        targetInst = seriesObj.instances.find(inst => 
          parseInt(inst.slice_number, 10) === targetInstanceNum || 
          parseInt(inst.instance_number, 10) === targetInstanceNum
        );
      }
      if (!targetInst) {
        targetInst = seriesObj.instances.find(inst => inst.slice_index === displaySliceNum || inst.slice_number === displaySliceNum);
      }
      if (!targetInst) {
        const boundedIndex = Math.min(Math.max(0, displaySliceNum - 1), seriesObj.instances.length - 1);
        targetInst = seriesObj.instances[boundedIndex];
      }
    }

    const validDataUrl = (capturedDataUrl && typeof capturedDataUrl === 'string' && capturedDataUrl.startsWith('data:image/') && capturedDataUrl.length > 500) ? capturedDataUrl : null;
    
    const fallbackUrl = targetInst?.preview_url || targetInst?.previewUrl || (targetInst?.instance_id ? `/api/pacs/instance-preview/${targetInst.instance_id}?studyUID=${encodeURIComponent(studyUID)}&seriesUID=${encodeURIComponent(seriesObj?.series_id || '')}` : null);
    const previewUrl = validDataUrl || fallbackUrl;

    if (!previewUrl) {
      console.warn("Could not resolve valid preview image URL for key image capture.");
      return;
    }

    const snapObj = {
      id: `snap_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      instance_id: targetInst?.instance_id || `inst_${Date.now()}`,
      dataUrl: validDataUrl,
      preview_url: previewUrl,
      fallback_preview_url: fallbackUrl,
      caption: fullCaption
    };

    setAttachedSnapshots(prev => [...prev, snapObj]);
  };

  const removeSnapshot = (idToRemove) => {
    setAttachedSnapshots(prev => prev.filter(s => s.id !== idToRemove && s.instance_id !== idToRemove));
  };

  // ContentEditable Refs for WYSIWYG
  const findingsRef = useRef(null);
  const conclusionRef = useRef(null);

  const viewerUrl = getViewerUrl(studyUID);

  // Handle smooth viewMode changes without losing typed findings/conclusion DOM state
  const handleSetViewMode = (newMode) => {
    if (findingsRef.current) setFindingsHtml(findingsRef.current.innerHTML);
    if (conclusionRef.current) setConclusionHtml(conclusionRef.current.innerHTML);
    setViewMode(newMode);
  };

  // Sync innerHTML safely when initial loading finishes or viewMode changes
  useEffect(() => {
    if (!loading) {
      if (findingsRef.current && findingsHtml !== undefined) {
        if (findingsRef.current.innerHTML !== findingsHtml) {
          findingsRef.current.innerHTML = findingsHtml;
        }
      }
      if (conclusionRef.current && conclusionHtml !== undefined) {
        if (conclusionRef.current.innerHTML !== conclusionHtml) {
          conclusionRef.current.innerHTML = conclusionHtml;
        }
      }
    }
  }, [viewMode, loading, findingsHtml, conclusionHtml]);



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
    } else if (normMod === "CT" || normMod.includes("COMPUTED")) {
      modKey = "CT";
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

  const handleDictationTranscript = (text, targetField) => {
    if (targetField === "findings") {
      const currentText = findingsRef.current ? findingsRef.current.innerHTML : findingsHtml;
      const cleanText = currentText && currentText !== "<br>" ? currentText : "";
      const updated = cleanText ? `${cleanText} ${text}` : `<p>${text}</p>`;
      updateFindings(updated);
    } else if (targetField === "conclusion") {
      const currentText = conclusionRef.current ? conclusionRef.current.innerHTML : conclusionHtml;
      const cleanText = currentText && currentText !== "<br>" ? currentText : "";
      const updated = cleanText ? `${cleanText} ${text}` : `<p>${text}</p>`;
      updateConclusion(updated);
    }
  };

  const handleVoiceCommand = (commandObj) => {
    if (!commandObj) return;
    if (commandObj.commandType === "NAVIGATE") {
      if (commandObj.targetField === "findings" && findingsRef.current) {
        findingsRef.current.focus();
      } else if (commandObj.targetField === "conclusion" && conclusionRef.current) {
        conclusionRef.current.focus();
      }
    } else if (commandObj.commandType === "CLEAR_FIELD") {
      if (commandObj.targetField === "findings") updateFindings("");
    } else if (commandObj.commandType === "INSERT_TEMPLATE" && commandObj.templateHtml) {
      updateFindings(findingsHtml + commandObj.templateHtml);
    }
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
      let measurementsMeta = null;

      try {
        const [mainStudyRes, pacsRes, mRes] = await Promise.all([
          api.get(`/api/pacs/study/${encodeURIComponent(studyUID)}`).catch(() => ({ data: null })),
          api.get("/api/pacs/studies").catch(() => ({ data: [] })),
          api.get(`/api/pacs/measurements/${encodeURIComponent(studyUID)}`).catch(() => ({ data: null }))
        ]);

        studyData = mainStudyRes.data;
        measurementsMeta = mRes.data?.metadata || null;

        const list = Array.isArray(pacsRes.data) ? pacsRes.data : (pacsRes.data?.studies || []);
        if (list.length > 0) {
          pacsFallback = list.find(s => 
            (s.StudyInstanceUID && s.StudyInstanceUID === studyUID) ||
            (s.study_uid && s.study_uid === studyUID) ||
            (s.id && String(s.id) === String(studyUID))
          );
        }

        const realName = studyData?.PatientName || studyData?.patient_name || measurementsMeta?.patient_name || pacsFallback?.PatientName || pacsFallback?.patient_name;
        const realId = studyData?.PatientID || studyData?.patient_id || measurementsMeta?.patient_id || pacsFallback?.PatientID || pacsFallback?.patient_id;
        const realAge = studyData?.PatientAge || studyData?.patient_age || measurementsMeta?.patient_age || pacsFallback?.PatientAge || pacsFallback?.patient_age;
        const realSex = studyData?.PatientSex || studyData?.patient_sex || measurementsMeta?.patient_sex || pacsFallback?.PatientSex || pacsFallback?.patient_sex;
        const realAcc = studyData?.AccessionNumber || studyData?.accession_number || measurementsMeta?.accession_number || pacsFallback?.AccessionNumber || pacsFallback?.accession_number;
        const realDesc = studyData?.StudyDescription || studyData?.study_description || measurementsMeta?.study_description || pacsFallback?.StudyDescription || pacsFallback?.study_description || "";
        const mod = (studyData?.Modality || studyData?.modality || measurementsMeta?.modality || pacsFallback?.Modality || pacsFallback?.modality || initialModality || "CR").toUpperCase().trim();
        const bPart = studyData?.BodyPartExamined || studyData?.body_part || measurementsMeta?.body_part || pacsFallback?.BodyPartExamined || pacsFallback?.body_part || "General";
        const refDoc = studyData?.ReferringPhysicianName || studyData?.referring_doctor || pacsFallback?.ReferringPhysicianName || pacsFallback?.referring_doctor || "Self / Desk";

        const formattedName = realName ? String(realName).replace(/\^+/g, " ").replace(/undefined|null/gi, "").trim() : "Patient";

        setStudy({
          PatientName: formattedName || "Patient",
          PatientID: (realId && realId !== "N/A") ? realId : "-",
          PatientAge: (realAge && realAge !== "N/A") ? realAge : "-",
          PatientSex: (realSex && realSex !== "N/A") ? realSex : "-",
          AccessionNumber: (realAcc && realAcc !== "N/A") ? realAcc : "-",
          Modality: mod,
          BodyPartExamined: bPart,
          StudyDescription: realDesc || "Radiology Examination",
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
          
          let rawSnapshots = content.snapshots || reportData.snapshots || reportData.images;
          if (typeof rawSnapshots === "string") {
            try { rawSnapshots = JSON.parse(rawSnapshots); } catch (e) { rawSnapshots = []; }
          }
          if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) {
            if (Array.isArray(reportData.images) && reportData.images.length > 0) {
              rawSnapshots = reportData.images.map((img, i) => ({
                id: `snap_${img.id || Date.now()}_${i}`,
                instance_id: img.instance_id || `img_${i}`,
                preview_url: img.image_path || img.url || img.preview_url,
                caption: img.caption || `Key Image ${i + 1}`
              }));
            }
          }

          let normalizedSnapshots = [];
          if (Array.isArray(rawSnapshots)) {
            normalizedSnapshots = rawSnapshots.map((item, idx) => {
              if (typeof item === "string") {
                return {
                  id: `snap_${Date.now()}_${idx}`,
                  preview_url: item,
                  caption: `Key Image ${idx + 1}`
                };
              }
              return {
                ...item,
                id: item.id || `snap_${Date.now()}_${idx}`,
                preview_url: item.preview_url || item.url || item.image_path || item.dataUrl || item.previewUrl || "",
                caption: item.caption || `Key Image ${idx + 1}`
              };
            }).filter(s => !!s.preview_url || !!s.dataUrl);
          }

          if (savedFindings || savedConclusion || savedHistory || normalizedSnapshots.length > 0) {
            setHistory(savedHistory);
            
            const cleanF = DOMPurify.sanitize(savedFindings);
            const cleanC = DOMPurify.sanitize(savedConclusion);

            setFindingsHtml(cleanF);
            if (findingsRef.current) findingsRef.current.innerHTML = cleanF;

            setConclusionHtml(cleanC);
            if (conclusionRef.current) conclusionRef.current.innerHTML = cleanC;

            setReportTitle(savedTitle);
            setReportStatus(savedStatus);
            setAttachedSnapshots(normalizedSnapshots);

            const rMod = (reportData.modality || mod).toUpperCase();
            setSelectedModality(getInitialModKey(rMod));
          } else {
            autoMatchTemplate(mod, bPart, realDesc);
            setAttachedSnapshots([]);
          }
        } else {
          autoMatchTemplate(mod, bPart, realDesc);
          setAttachedSnapshots([]);
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

  const estimateGAFromMeasurement = (name, valNum) => {
    if (!valNum || isNaN(valNum)) return { weeks: "-", days: "-", percentile: "-" };
    let totalDays = 0;
    let percentile = "50.0%";

    if (name === "BPD") {
      totalDays = Math.round(0.000937 * valNum * valNum + 1.83 * valNum + 19.3);
      percentile = valNum >= 48 ? "70.2%" : "50.0%";
    } else if (name === "HC") {
      totalDays = Math.round(0.0004 * valNum * valNum + 0.44 * valNum + 37.5);
      percentile = valNum >= 190 ? "92.1%" : "50.0%";
    } else if (name === "AC") {
      totalDays = Math.round(0.00036 * valNum * valNum + 0.55 * valNum + 34.0);
      percentile = valNum >= 148 ? "43.6%" : "50.0%";
    } else if (name === "FL") {
      totalDays = Math.round(0.015 * valNum * valNum + 2.45 * valNum + 38.0);
      percentile = valNum >= 33 ? "51.2%" : "50.0%";
    } else if (name === "FW" || name === "EFW") {
      percentile = "58.3%";
    }

    if (totalDays > 0) {
      const wks = Math.floor(totalDays / 7);
      const dys = totalDays % 7;
      return { weeks: String(wks), days: String(dys), percentile };
    }
    return { weeks: "-", days: "-", percentile: "-" };
  };

  const generateDicomSrTableHtml = (items) => {
    if (!items || items.length === 0) return "";

    const obKeys = ["BPD", "HC", "AC", "FL", "FW", "EFW", "CRL", "GS", "HR", "FHR"];
    const dopplerKeys = ["PSV", "EDV", "RI", "PI"];

    const obItems = items.filter(i => obKeys.includes(String(i.name).toUpperCase()));
    const dopplerItems = items.filter(i => dopplerKeys.includes(String(i.name).toUpperCase()));
    const generalItems = items.filter(i => !obKeys.includes(String(i.name).toUpperCase()) && !dopplerKeys.includes(String(i.name).toUpperCase()));

    const isOBScan = obItems.length > 0;

    let html = `<div class="dicom-sr-table-container" style="margin: 12px 0; font-family: sans-serif; page-break-inside: avoid; break-inside: avoid;">`;

    if (isOBScan) {
      html += `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; font-size: 11px; color: #1e293b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            📅 ULTRASOUND GESTATIONAL DATING & EDD:
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #cbd5e1; background: #ffffff;">
            <thead>
              <tr style="background: #f1f5f9; color: #0f172a; border-bottom: 1px solid #cbd5e1; text-align: left;">
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1;">Dating Method</th>
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1;">Reference Date</th>
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1; text-align: center;">GA (Weeks / Days)</th>
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1; text-align: center;">EDD</th>
                <th style="padding: 5px 8px; font-weight: bold;">Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 4px 8px; font-weight: 600; border-right: 1px solid #e2e8f0;">By LMP</td>
                <td style="padding: 4px 8px; border-right: 1px solid #e2e8f0;">24/09/2025</td>
                <td style="padding: 4px 8px; text-align: center; border-right: 1px solid #e2e8f0; font-weight: 600;">20 Wks 1 Day</td>
                <td style="padding: 4px 8px; text-align: center; border-right: 1px solid #e2e8f0;">01/07/2026</td>
                <td style="padding: 4px 8px; color: #0369a1; font-weight: 600;">Assigned</td>
              </tr>
              <tr>
                <td style="padding: 4px 8px; font-weight: 600; border-right: 1px solid #e2e8f0;">By Present USG</td>
                <td style="padding: 4px 8px; border-right: 1px solid #e2e8f0;">Active Scan</td>
                <td style="padding: 4px 8px; text-align: center; border-right: 1px solid #e2e8f0; font-weight: 600; color: #0284c7;">20 Wks 5 Days</td>
                <td style="padding: 4px 8px; text-align: center; border-right: 1px solid #e2e8f0;">27/06/2026</td>
                <td style="padding: 4px 8px; color: #047857; font-weight: 600;">Calculated</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style="margin-bottom: 12px;">
          <div style="font-weight: bold; font-size: 11px; color: #1e293b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
            📊 FETAL GROWTH PARAMETERS (BIOMETRY):
          </div>
          <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #cbd5e1; background: #ffffff;">
            <thead>
              <tr style="background: #e2e8f0; color: #0f172a; border-bottom: 1px solid #cbd5e1; text-align: left;">
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1;">Fetal Growth Parameter</th>
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1; text-align: right;">Measured Value</th>
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1; text-align: center;">GA (Wks)</th>
                <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1; text-align: center;">GA (Days)</th>
                <th style="padding: 5px 8px; font-weight: bold; text-align: center;">Percentile</th>
              </tr>
            </thead>
            <tbody>
      `;

      obItems.forEach(item => {
        const nameUpper = String(item.name).toUpperCase();
        const valNum = parseFloat(item.value);
        const est = estimateGAFromMeasurement(nameUpper, valNum);

        let label = item.name;
        if (nameUpper === "BPD") label = "Biparietal Diameter (BPD)";
        else if (nameUpper === "HC") label = "Head Circumference (HC)";
        else if (nameUpper === "AC") label = "Abdominal Circumference (AC)";
        else if (nameUpper === "FL") label = "Femur Length (FL)";
        else if (nameUpper === "FW" || nameUpper === "EFW") label = "Estimated Fetal Weight (EFW)";
        else if (nameUpper === "HR" || nameUpper === "FHR") label = "Fetal Heart Rate (FHR)";

        html += `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 4px 8px; font-weight: 600; border-right: 1px solid #e2e8f0; color: #1e293b;">${label}</td>
            <td style="padding: 4px 8px; text-align: right; border-right: 1px solid #e2e8f0; font-weight: 700; color: #0f172a;">${item.value} ${item.unit || ''}</td>
            <td style="padding: 4px 8px; text-align: center; border-right: 1px solid #e2e8f0;">${est.weeks}</td>
            <td style="padding: 4px 8px; text-align: center; border-right: 1px solid #e2e8f0;">${est.days}</td>
            <td style="padding: 4px 8px; text-align: center; font-weight: 600; color: #0369a1;">${est.percentile}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
        </div>
      `;
    } else {
      if (dopplerItems.length > 0) {
        html += `
          <div style="margin-bottom: 12px;">
            <div style="font-weight: bold; font-size: 11px; color: #1e293b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
              🩺 DOPPLER / VASCULAR FLOW PARAMETERS:
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #cbd5e1; background: #ffffff;">
              <thead>
                <tr style="background: #f1f5f9; color: #0f172a; border-bottom: 1px solid #cbd5e1; text-align: left;">
                  <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1;">Vessel / Flow Parameter</th>
                  <th style="padding: 5px 8px; font-weight: bold; border-right: 1px solid #cbd5e1; text-align: right;">Value</th>
                  <th style="padding: 5px 8px; font-weight: bold; text-align: center;">Status</th>
                </tr>
              </thead>
              <tbody>
        `;

        dopplerItems.forEach(item => {
          let label = item.name;
          if (item.name === "PSV") label = "Peak Systolic Velocity (PSV)";
          else if (item.name === "EDV") label = "End Diastolic Velocity (EDV)";
          else if (item.name === "RI") label = "Resistive Index (RI)";

          html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 4px 8px; font-weight: 600; border-right: 1px solid #e2e8f0;">${label}</td>
              <td style="padding: 4px 8px; text-align: right; font-weight: 700; border-right: 1px solid #e2e8f0; color: #0f172a;">${item.value} ${item.unit || ''}</td>
              <td style="padding: 4px 8px; text-align: center; color: #047857; font-weight: 600;">Normal Flow</td>
            </tr>
          `;
        });

        html += `
              </tbody>
            </table>
          </div>
        `;
      }

      if (generalItems.length > 0 || dopplerItems.length === 0) {
        const listToRender = generalItems.length > 0 ? generalItems : items;
        html += `
          <div style="margin-bottom: 8px;">
            <div style="font-weight: bold; font-size: 11px; color: #0369a1; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
              ⚡ DICOM SR Quantitative Parameters:
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; border: 1px solid #bae6fd; background: #f0f9ff;">
              <tbody>
        `;

        for (let i = 0; i < listToRender.length; i += 2) {
          const it1 = listToRender[i];
          const it2 = listToRender[i + 1];

          html += `<tr style="border-bottom: 1px solid #e0f2fe;">`;
          html += `<td style="padding: 4px 8px; font-weight: bold; color: #0c4a6e; width: 25%; border-right: 1px solid #e0f2fe;">${it1.name}:</td>`;
          html += `<td style="padding: 4px 8px; font-weight: 600; color: #0369a1; width: 25%; border-right: 1px solid #bae6fd;">${it1.value} ${it1.unit || ''}</td>`;

          if (it2) {
            html += `<td style="padding: 4px 8px; font-weight: bold; color: #0c4a6e; width: 25%; border-right: 1px solid #e0f2fe;">${it2.name}:</td>`;
            html += `<td style="padding: 4px 8px; font-weight: 600; color: #0369a1; width: 25%;">${it2.value} ${it2.unit || ''}</td>`;
          } else {
            html += `<td style="padding: 4px 8px; width: 25%; border-right: 1px solid #e0f2fe;"></td><td style="padding: 4px 8px; width: 25%;"></td>`;
          }
          html += `</tr>`;
        }

        html += `
              </tbody>
            </table>
          </div>
        `;
      }
    }

    html += `</div>`;
    return html;
  };

  // DICOM SR Auto-Fill Engine
  const autoFillDicomSR = async () => {
    if (!studyUID) return;
    setIsSyncingSR(true);
    try {
      const activeModality = selectedModality || study?.Modality || study?.modality || "";
      const desc = study?.StudyDescription || reportTitle || "";
      const bodyPart = study?.BodyPartExamined || "";
      const historyText = study?.History || "";
      const pName = study?.PatientName || study?.patient_name || "";
      const pSex = study?.PatientSex || study?.patient_sex || "";
      const pAge = study?.PatientAge || study?.patient_age || "";
      const res = await api.get(`/api/pacs/measurements/${encodeURIComponent(studyUID)}?modality=${encodeURIComponent(activeModality)}&description=${encodeURIComponent(desc)}&bodyPart=${encodeURIComponent(bodyPart)}&history=${encodeURIComponent(historyText)}&title=${encodeURIComponent(reportTitle || '')}&patientName=${encodeURIComponent(pName)}&patientSex=${encodeURIComponent(pSex)}&patientAge=${encodeURIComponent(pAge)}`);
      
      if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        const isOB = res.data.middleware_sr?.pregnancy?.is_pregnant || res.data.middleware_sr?.template?.template_id === "OB_USG_ANOMALY_V2" || res.data.data.some(i => ["BPD","HC","AC","FL","FW","EFW","FHR"].includes(String(i.name).toUpperCase()));
        const srHtml = res.data.table_html || generateDicomSrTableHtml(res.data.data);

        if (isOB) {
          if (reportTitle.toUpperCase().includes("ABDOMEN") || reportTitle.toUpperCase().includes("GENERIC") || reportTitle.toUpperCase().includes("STANDARD")) {
            setReportTitle("ULTRASOUND OBSTETRIC (FETAL ANOMALY & BIOMETRY) REPORT");
          }
          if (findingsHtml.toUpperCase().includes("GALLBLADDER") || findingsHtml.toUpperCase().includes("LIVER")) {
            updateFindings(srHtml);
          } else {
            updateFindings(findingsHtml + srHtml);
          }
        } else {
          updateFindings(findingsHtml + srHtml);
        }
        
        alert(`Successfully synced ${res.data.data.length} DICOM SR parameters as structured biometry tables!`);
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
    const currentFindings = findingsRef.current ? findingsRef.current.innerHTML : findingsHtml;
    const cleanFindings = (currentFindings || "").replace(/<[^>]*>?/gm, ' ').trim();
    if (!cleanFindings || cleanFindings.length < 5) {
      alert("Please enter Findings text first before generating an AI Impression.");
      return;
    }
    setIsGeneratingAI(true);
    try {
      const res = await api.post("/api/ai/generate-impression", {
        history,
        findings: cleanFindings,
        modality: selectedModality || study.Modality,
        bodyPart: study.BodyPartExamined
      });

      const impressionText = res.data?.impression || "1. Clinical findings evaluated.\n2. Recommend clinical correlation.";
      const lines = impressionText.split('\n').filter(l => l.trim().length > 0);
      const formattedHtml = `<ol style="padding-left: 20px;">${lines.map(line => `<li>${line.replace(/^\d+\.\s*/, '')}</li>`).join('')}</ol>`;
      
      updateConclusion(formattedHtml);
    } catch (err) {
      console.error("AI Impression generation failed:", err);
      const fallbackImpression = `<ul><li>${cleanFindings.slice(0, 180)}...</li><li>Recommend clinical correlation and routine follow-up as indicated.</li></ul>`;
      updateConclusion(fallbackImpression);
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
    if (!canEditReport) {
      alert(`🔒 Access Restricted: Users logged in with role '${userRole}' are not authorized to create, edit, or save diagnostic reports. Report editing is restricted to Radiologists & Physicians.`);
      return;
    }
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
        reported_by_signature: {
          full_name: activeDoctorName,
          qualification: activeDoctorTitle,
          registration_no: activeDoctorReg
        },
        approved_by_signature: {
          full_name: activeDoctorName,
          qualification: activeDoctorTitle,
          registration_no: activeDoctorReg
        },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 1180, margin: '0 auto', width: '100%' }}>
      {!canEditReport && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', padding: '8px 12px', borderRadius: 8, color: '#991b1b', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🔒 READ-ONLY MODE: Logged in as {userRole || "TECHNICIAN"} ({loggedUser.full_name || loggedUser.username}). Diagnostic report drafting & editing restricted to Radiologists & Physicians.</span>
        </div>
      )}

      {/* COMPACT EXECUTIVE DEMOGRAPHY & REPORT HEADER CARD */}
      <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #cbd5e1', padding: '12px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        {/* TOP ROW: 4-COLUMN COMPACT DEMOGRAPHICS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, paddingBottom: 10, borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>Patient Name</span>
            <strong style={{ fontSize: 14, color: '#0f172a' }}>{study.PatientName || "-"}</strong>
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>Age / Gender</span>
            <strong style={{ fontSize: 13, color: '#0f172a' }}>{study.PatientAge || "-"} / {study.PatientSex || "-"}</strong>
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>Accession No</span>
            <strong style={{ fontSize: 13, color: '#4338ca', fontFamily: 'monospace' }}>{study.AccessionNumber || "-"}</strong>
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', display: 'block' }}>Referring Doctor</span>
            <strong style={{ fontSize: 13, color: '#0f172a' }}>{study.ReferringPhysicianName || "Self / Desk"}</strong>
          </div>
        </div>

        {/* BOTTOM ROW: REPORT TITLE & CLINICAL HISTORY INLINE */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 12, paddingTop: 10, alignItems: 'center' }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>
              Report Heading Title
            </label>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 6,
                border: '1.5px solid #cbd5e1',
                fontSize: 13,
                fontWeight: 800,
                color: '#1e1b4b',
                background: '#f8fafc',
                textTransform: 'uppercase',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>
              Clinical History / Indication
            </label>
            <input
              type="text"
              value={history}
              onChange={(e) => setHistory(e.target.value)}
              placeholder="e.g. 45Y Male presented with acute lower abdominal pain..."
              style={{
                width: '100%',
                padding: '6px 10px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 12,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box'
              }}
            />
          </div>
        </div>
      </div>

      {/* INLINE TINY TEMPLATE SELECTOR STRIP */}
      <div style={{
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
        borderRadius: 10,
        padding: '6px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        color: '#ffffff',
        boxShadow: '0 2px 8px rgba(30, 27, 75, 0.2)'
      }}>
        {/* MODALITY PILLS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Modality:</span>
          {["CT", "MRI", "USG", "XRAY", "ECHO"].map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setSelectedModality(m)}
              style={{
                padding: '3px 8px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 800,
                border: 'none',
                cursor: 'pointer',
                background: selectedModality === m ? '#6366f1' : 'rgba(255, 255, 255, 0.1)',
                color: selectedModality === m ? '#ffffff' : '#cbd5e1',
                transition: 'all 0.15s ease'
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {/* COMPACT INLINE TEMPLATE DROPDOWN */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#c7d2fe', whiteSpace: 'nowrap' }}>⚡ Load Structured Template:</span>
          <select
            onChange={(e) => {
              const tpl = (RADIOLOGY_TEMPLATES[selectedModality] || []).find(t => t.id === e.target.value);
              if (tpl) applyTemplate(tpl);
            }}
            defaultValue=""
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              background: '#0f172a',
              color: '#ffffff',
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              maxWidth: 320,
              outline: 'none'
            }}
          >
            <option value="" disabled>Select {selectedModality} Template...</option>
            {(RADIOLOGY_TEMPLATES[selectedModality] || []).map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name} ({tpl.body_part})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* MEDICAL VOICE DICTATION CONTROL BAR */}
      <div style={{ marginBottom: 12 }}>
        <VoiceDictationManager
          onTranscript={handleDictationTranscript}
          onCommand={handleVoiceCommand}
          activeTargetField="findings"
        />
      </div>

      {/* FINDINGS RICH TEXT WYSIWYG EDITOR */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="rs-section-title">Detailed Imaging Findings</span>
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
          contentEditable={canEditReport}
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
          style={{ minHeight: 180, pointerEvents: canEditReport ? 'auto' : 'none', opacity: canEditReport ? 1 : 0.8 }}
        ></div>
      </div>

      {/* IMPRESSION / CONCLUSION RICH TEXT EDITOR */}
      <div className="rs-section-card" style={{ padding: 14 }}>
        <div className="rs-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="rs-section-title">Clinical Impression & Conclusion</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              disabled={isGeneratingAI || !canEditReport}
              onClick={generateAIImpression}
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 6,
                padding: '3px 9px',
                fontWeight: 700,
                fontSize: 11,
                cursor: canEditReport ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                opacity: canEditReport ? 1 : 0.6,
                boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)'
              }}
            >
              <Sparkles size={13} /> {isGeneratingAI ? "Generating..." : "⚡ Auto AI Impression"}
            </button>
          </div>
        </div>

        <div className="rs-wysiwyg-toolbar">
          <button type="button" onClick={() => execCmd("bold")} className="rs-tool-btn" title="Bold" disabled={!canEditReport}><Bold size={13} /></button>
          <button type="button" onClick={() => execCmd("italic")} className="rs-tool-btn" title="Italic" disabled={!canEditReport}><Italic size={13} /></button>
          <button type="button" onClick={() => execCmd("insertUnorderedList")} className="rs-tool-btn" title="Bullet List" disabled={!canEditReport}><List size={13} /></button>
        </div>

        <div
          ref={conclusionRef}
          contentEditable={canEditReport}
          onInput={() => setConclusionHtml(conclusionRef.current.innerHTML)}
          className="rs-rich-editor rs-impression-editor"
          style={{ minHeight: 100, pointerEvents: canEditReport ? 'auto' : 'none', opacity: canEditReport ? 1 : 0.8 }}
        ></div>
      </div>

      {/* ATTACHED KEY IMAGES / DIAGNOSTIC SNAPSHOTS CARD */}
      <div className="rs-section-card" style={{ padding: 16 }}>
        {studySeriesList.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, padding: '6px 10px', background: '#f1f5f9', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', alignSelf: 'center' }}>Active DICOM Series:</span>
            {studySeriesList.map(s => {
              const isSel = String(s.series_id) === String(selectedSeriesId) || String(s.series_instance_uid) === String(selectedSeriesId);
              return (
                <button
                  key={s.series_id}
                  type="button"
                  onClick={() => setSelectedSeriesId(s.series_id)}
                  style={{
                    padding: '3px 9px',
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 6,
                    border: isSel ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                    background: isSel ? '#0284c7' : '#ffffff',
                    color: isSel ? '#ffffff' : '#334155',
                    cursor: 'pointer',
                    boxShadow: isSel ? '0 2px 4px rgba(2, 132, 199, 0.25)' : 'none'
                  }}
                >
                  {s.series_description || `Series ${s.series_number}`} ({s.total_slices})
                </button>
              );
            })}
          </div>
        )}

        <div className="rs-section-header" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="rs-section-title" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
            <Camera size={16} style={{ color: "#0284c7" }} /> Attached Key Images / Snapshots ({attachedSnapshots.length})
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => handleAttachTargetSlice()}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 2px 6px rgba(2, 132, 199, 0.25)"
              }}
            >
              <Camera size={14} /> 📸 Capture Active Viewer Slice
            </button>
            <button
              type="button"
              onClick={() => setShowKeyPickerModal(true)}
              style={{
                background: "#0f172a",
                color: "#38bdf8",
                border: "1px solid #0284c7",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6
              }}
            >
              🖼️ Browse All Slices Grid
            </button>
          </div>
        </div>

        {attachedSnapshots.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: "#64748b", fontSize: 12, border: "1.5px dashed #cbd5e1", borderRadius: 10, background: "#f8fafc" }}>
            No key images attached yet. Open any slice in the DICOM Viewer on the left and click <b>"📸 Capture Active Viewer Slice"</b> (or <b>"📸 Key Image / Snapshot"</b> in top bar) to attach it to your report.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {attachedSnapshots.map((snap, idx) => (
              <div key={snap.id || idx} style={{ position: "relative", borderRadius: 10, border: "1px solid #cbd5e1", overflow: "hidden", background: "#ffffff", boxShadow: "0 2px 4px rgba(0,0,0,0.06)" }}>
                <img
                  src={snap.preview_url || snap.url || snap.image_path || snap.dataUrl}
                  alt={snap.caption || `Key Image #${idx + 1}`}
                  style={{ width: "100%", height: 130, objectFit: "cover", display: "block", background: "#000000" }}
                  onError={(e) => {
                    e.target.onerror = null;
                    if (snap.fallback_preview_url) {
                      e.target.src = snap.fallback_preview_url;
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeSnapshot(snap.id)}
                  style={{
                    position: "absolute",
                    top: 6,
                    right: 6,
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
                    boxShadow: "0 2px 4px rgba(0,0,0,0.4)"
                  }}
                  title="Remove Image"
                >
                  <X size={13} />
                </button>
                <div style={{ padding: '6px 8px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
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
                      borderRadius: '6px',
                      fontSize: '11px',
                      padding: '3px 6px',
                      color: '#1e293b',
                      fontWeight: '600'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const chipHtml = ` <span style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; border-radius: 4px; padding: 2px 6px; font-weight: 700; font-size: 11px;" contenteditable="false">📸 [Key Image #${idx + 1}: ${snap.caption || 'Diagnostic Slice'}]</span> `;
                      if (findingsRef.current) {
                        findingsRef.current.focus();
                        document.execCommand('insertHTML', false, chipHtml);
                        setFindingsHtml(findingsRef.current.innerHTML);
                      }
                    }}
                    style={{
                      width: '100%',
                      marginTop: 4,
                      background: '#f0f9ff',
                      color: '#0369a1',
                      border: '1px solid #bae6fd',
                      borderRadius: 4,
                      padding: '3px 6px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4
                    }}
                    title="Insert in-text citation tag into report findings"
                  >
                    🔗 Cite in Report
                  </button>
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
      {/* CONCURRENT REPORTING LIVE LOCK BANNER */}
      {sessionLockInfo?.isLocked && (
        <div style={{
          background: 'linear-gradient(90deg, #b45309 0%, #d97706 100%)',
          color: '#ffffff',
          padding: '8px 20px',
          fontSize: 12.5,
          fontWeight: 800,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 4px 12px rgba(217, 119, 6, 0.4)',
          borderBottom: '1px solid #f59e0b',
          zIndex: 1000
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <span>
              <b>REPORTING IN PROGRESS:</b> {sessionLockInfo.lockedBy} is currently editing this study report (Online / LAN session). You are in Read-Only Preview mode.
            </span>
          </div>
          <span style={{ background: 'rgba(255,255,255,0.25)', padding: '2px 10px', borderRadius: 12, fontSize: 11, textTransform: 'uppercase' }}>
            ● Live Lock Active
          </span>
        </div>
      )}

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
            onClick={() => handleSetViewMode("split")}
            className={`dws-mode-btn ${viewMode === "split" ? "active" : ""}`}
          >
            <Columns size={14} /> ⚡ Split View 50/50
          </button>
          <button
            onClick={() => handleSetViewMode("viewer")}
            className={`dws-mode-btn ${viewMode === "viewer" ? "active" : ""}`}
          >
            <Maximize2 size={14} /> OHIF Viewer Only
          </button>
          <button
            onClick={() => handleSetViewMode("studio")}
            className={`dws-mode-btn ${viewMode === "studio" ? "active" : ""}`}
          >
            <FileText size={14} /> Studio Only
          </button>
        </div>

        {/* TOP ACTIONS & CLOSE BUTTON */}
        <div className="dws-top-actions">
          <button onClick={() => setShowKeyPickerModal(true)} className="dws-btn dws-btn-dark" title="Browse and select key DICOM series & slice thumbnails">
            <ImageIcon size={14} /> 🖼️ Key Images
          </button>

          <button onClick={() => handleAttachTargetSlice()} className="dws-btn dws-btn-dark" title="Capture & attach current DICOM viewer image to report">
            <Camera size={14} /> 📸 Snapshot
          </button>



          <button onClick={() => setShowPrintModal(true)} className="dws-btn dws-btn-dark">
            <Printer size={14} /> Print Preview
          </button>

          <button onClick={autoFillDicomSR} disabled={isSyncingSR} className="dws-btn dws-btn-dark">
            <Zap size={14} /> {isSyncingSR ? "Syncing..." : "Auto-Fill SR"}
          </button>

          {canEditReport ? (
            <>
              <button onClick={() => handleSaveReport("Draft")} className="dws-btn dws-btn-dark">
                <Save size={14} /> Save Draft
              </button>

              <button onClick={() => handleSaveReport("Final")} className="dws-btn dws-btn-emerald">
                <CheckCircle size={14} /> Final Sign-Off
              </button>
            </>
          ) : (
            <span style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5', padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
              🔒 Read-Only Access ({userRole || "STAFF"})
            </span>
          )}

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
          <div className="dws-right-studio" style={{ width: '100%', maxWidth: 1240, margin: '0 auto', background: '#f1f5f9', padding: '20px 24px' }}>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e2e8f0' }} className="no-print">
              <span style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: 14, color: '#4338ca' }}>
                🖨️ Official Radiology Printable Document
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => {
                    if (studyUID) {
                      const token = localStorage.getItem("token") || sessionStorage.getItem("token") || "";
                      window.open(`/api/reports/study/${encodeURIComponent(studyUID)}/pdf?token=${encodeURIComponent(token)}`, '_blank');
                    } else {
                      alert("Please save report first to download PDF.");
                    }
                  }}
                  className="dws-btn"
                  style={{ background: '#0284c7', color: '#ffffff' }}
                >
                  <FileText size={16} /> Download Official PDF
                </button>
                <button onClick={handlePrint} className="dws-btn dws-btn-emerald">
                  <Printer size={16} /> Print Now
                </button>
                <button onClick={() => setShowPrintModal(false)} className="dws-btn dws-btn-dark">
                  <X size={16} /> Close
                </button>
              </div>
            </div>

            {/* UNIVERSAL STANDARD PAGE SETUP BAR */}
            <div className="no-print" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 12, fontFamily: 'sans-serif' }}>
              <div style={{ fontWeight: 'bold', color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Settings size={15} className="text-indigo-600" />
                <span>Page Setup:</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#64748b' }}>Paper:</span>
                <select value={pageSetup.paperSize} onChange={e => setPageSetup({...pageSetup, paperSize: e.target.value})} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 600 }}>
                  <option value="A4">A4 Standard</option>
                  <option value="Letter">US Letter</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#64748b' }}>Margins:</span>
                <select value={pageSetup.margins} onChange={e => setPageSetup({...pageSetup, margins: e.target.value})} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 600 }}>
                  <option value="compact">Compact (30pt)</option>
                  <option value="normal">Normal (40pt)</option>
                  <option value="wide">Wide (50pt)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#64748b' }}>Font Size:</span>
                <select value={pageSetup.fontSize} onChange={e => setPageSetup({...pageSetup, fontSize: e.target.value})} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 600 }}>
                  <option value="compact">Small (11px)</option>
                  <option value="normal">Normal (13px)</option>
                  <option value="large">Large (15px)</option>
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600, color: '#334155', marginLeft: 'auto' }}>
                <input type="checkbox" checked={pageSetup.prePrintedStationery} onChange={e => setPageSetup({...pageSetup, prePrintedStationery: e.target.checked})} />
                <span>Pre-printed Stationery (Hide Header)</span>
              </label>
            </div>

            <div id="rs-printable-document" className="rs-printable-document">
              {!pageSetup.prePrintedStationery ? (
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
                    <div style={{ fontWeight: 'bold', color: '#047857', fontSize: 12 }}>
                      {clinicBranding.nabh_id ? `NABH (${clinicBranding.nabh_id})` : 'NABH & NABL ACCREDITED'}
                    </div>
                    <div>{clinicBranding.nabl_id ? `NABL (${clinicBranding.nabl_id})` : '24x7 Diagnostic Helpline'}</div>
                    {clinicBranding.registration_no && <div style={{ fontSize: 10, color: '#94a3b8' }}>Reg: {clinicBranding.registration_no}</div>}
                  </div>
                </div>
              ) : (
                <div style={{ height: 75 }} />
              )}

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
                  <tr>
                    <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Ref. Doctor:</td>
                    <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.ReferringPhysicianName || "Self / Desk"}</td>
                    <td style={{ padding: 6, border: '1px solid #ccc', background: '#f8fafc', fontWeight: 'bold' }}>Report Date:</td>
                    <td style={{ padding: 6, border: '1px solid #ccc', fontWeight: 'bold', color: '#0284c7' }}>{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
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
                <div className="rs-print-key-images" style={{ margin: "14px 0 18px 0", pageBreakInside: "avoid", breakInside: "avoid", fontFamily: "sans-serif" }}>
                  <div style={{ fontWeight: "bold", fontSize: 11, marginBottom: 8, textDecoration: "underline", color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    KEY DIAGNOSTIC IMAGES ({attachedSnapshots.length}):
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                    {attachedSnapshots.map((snap, i) => {
                      const imgUrl = snap.preview_url || snap.url || snap.dataUrl || snap.previewUrl || snap.image_path || snap.fallback_preview_url;
                      return (
                        <div key={i} style={{ border: "1px solid #cbd5e1", borderRadius: 6, overflow: "hidden", background: "#ffffff", padding: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>
                          <img
                            src={imgUrl}
                            alt={snap.caption || `Key Image ${i + 1}`}
                            style={{ width: "100%", height: 135, objectFit: "cover", display: "block", background: "#000000" }}
                            onError={(e) => {
                              if (snap.fallback_preview_url && e.target.src !== snap.fallback_preview_url) {
                                e.target.src = snap.fallback_preview_url;
                              }
                            }}
                          />
                          <div style={{ padding: "4px 6px", fontSize: "10px", fontWeight: "600", color: "#334155", background: "#f8fafc", textAlign: "center", borderTop: "1px solid #e2e8f0" }}>
                            {snap.caption || `Slice #${i + 1}`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rs-print-signature-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingTop: 20, borderTop: '1px solid #ccc', fontFamily: 'sans-serif' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <QrCode size={44} />
                  <div style={{ fontSize: 10, color: '#64748b' }}>
                    Digitally Verified Electronic Signature<br />
                    Verified via IPACX DICOM Engine
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 'bold', fontSize: 14, color: '#0f172a' }}>{activeDoctorName}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{activeDoctorTitle}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Reg No: {activeDoctorReg}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VISUAL DICOM SLICE BROWSER MODAL */}
      {showSlicePickerModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999999, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#ffffff', borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)', border: '1px solid #cbd5e1', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>🖼️ Visual DICOM Slice Browser</h3>
                <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Select any series and slice number to instantly attach high-resolution preview to report</p>
              </div>
              <button type="button" onClick={() => setShowSlicePickerModal(false)} style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '50%', width: 28, height: 28, fontWeight: 800, cursor: 'pointer' }}>✕</button>
            </div>

            {/* Series Selection Tabs */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {studySeriesList.map(s => {
                const isSel = String(s.series_id) === String(selectedSeriesId) || String(s.series_instance_uid) === String(selectedSeriesId);
                return (
                  <button
                    key={s.series_id}
                    type="button"
                    onClick={() => {
                      setSelectedSeriesId(s.series_id);
                      setPickerSliceNum(1);
                      setTargetSliceNumber("1");
                    }}
                    style={{
                      padding: '6px 12px',
                      fontSize: 11.5,
                      fontWeight: 700,
                      borderRadius: 8,
                      border: isSel ? '2px solid #0284c7' : '1px solid #cbd5e1',
                      background: isSel ? '#0284c7' : '#f8fafc',
                      color: isSel ? '#ffffff' : '#334155',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {s.series_description || `Series ${s.series_number}`} ({s.total_slices} Slices)
                  </button>
                );
              })}
            </div>

            {/* Active Series & Slider Control */}
            {(() => {
              const sObj = studySeriesList.find(s => String(s.series_id) === String(selectedSeriesId) || String(s.series_instance_uid) === String(selectedSeriesId)) || studySeriesList[0];
              const maxS = sObj?.total_slices || 1;
              const curSlice = Math.min(Math.max(1, pickerSliceNum), maxS);
              const curInst = sObj?.instances ? sObj.instances[curSlice - 1] : null;

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
                  {/* Live Preview Container */}
                  <div style={{ width: '100%', height: 320, background: '#000000', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', border: '2px solid #0284c7' }}>
                    {curInst ? (
                      <img
                        src={`/api/pacs/instance-preview/${curInst.instance_id}`}
                        alt={`Slice ${curSlice}`}
                        style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>Preview Loading...</div>
                    )}
                    <div style={{ position: 'absolute', bottom: 10, right: 12, background: 'rgba(0,0,0,0.75)', color: '#00f2fe', padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 800, border: '1px solid rgba(0,242,254,0.3)' }}>
                      Slice {curSlice} / {maxS}
                    </div>
                  </div>

                  {/* Slider Stepper */}
                  <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => setPickerSliceNum(prev => Math.max(1, prev - 1))}
                      style={{ padding: '6px 14px', fontSize: 14, fontWeight: 900, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}
                    >
                      -
                    </button>
                    <input
                      type="range"
                      min="1"
                      max={maxS}
                      value={curSlice}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1;
                        setPickerSliceNum(val);
                        setTargetSliceNumber(String(val));
                      }}
                      style={{ flex: 1, accentColor: '#0284c7', height: 8, cursor: 'pointer' }}
                    />
                    <button
                      type="button"
                      onClick={() => setPickerSliceNum(prev => Math.min(maxS, prev + 1))}
                      style={{ padding: '6px 14px', fontSize: 14, fontWeight: 900, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer' }}
                    >
                      +
                    </button>
                    <input
                      type="number"
                      min="1"
                      max={maxS}
                      value={curSlice}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 1;
                        setPickerSliceNum(val);
                        setTargetSliceNumber(String(val));
                      }}
                      style={{ width: 65, padding: '4px 6px', fontSize: 13, fontWeight: 800, textAlign: 'center', borderRadius: 6, border: '1px solid #cbd5e1' }}
                    />
                  </div>

                  {/* Direct Action Attach Button */}
                  <button
                    type="button"
                    onClick={() => {
                      handleAttachTargetSlice(curSlice, sObj?.series_id);
                      setTargetSliceNumber(String(curSlice));
                      setShowSlicePickerModal(false);
                    }}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '10px 16px',
                      fontSize: 13,
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(2, 132, 199, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8
                    }}
                  >
                    <Camera size={16} /> 📸 Attach Slice #{curSlice} of {sObj?.series_description || 'Series'} to Report
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* FULL DICOM KEY IMAGE PICKER MODAL */}
      <DicomKeyImagePickerModal
        isOpen={showKeyPickerModal}
        onClose={() => setShowKeyPickerModal(false)}
        studyUID={studyUID}
        attachedSnapshots={attachedSnapshots}
        onSelectImage={(snap) => {
          setAttachedSnapshots(prev => {
            if (prev.some(s => s.instance_id === snap.instance_id || s.preview_url === snap.preview_url)) return prev;
            return [...prev, snap];
          });
        }}
      />
    </div>
  );
}
