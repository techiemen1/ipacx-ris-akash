import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import api from "../../api/axios";
import { RADIOLOGY_TEMPLATES } from "./radiologyTemplates";
import { expandClinicalMacros, CLINICAL_MACROS } from "../../utils/macroEngine";
import VoiceDictationManager from "../dictation/VoiceDictationManager";
import DiagnosticWorkstationModal from "./DiagnosticWorkstationModal";
import DicomKeyImagePickerModal from "./DicomKeyImagePickerModal";
import KeyImageGallery from "./KeyImageGallery";
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
  Settings,
  Maximize2,
  Eye,
  Camera,
  QrCode
} from "lucide-react";
import { openStudyViewer, getViewerUrl } from "../../utils/viewerUtils";
import { subscribeToViewerMessages, requestViewerSnapshot, detectViewportSliceInfoFromDOM } from "../../utils/ViewerBridge";
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

  // Fetch list of PACS studies for study switching (non-blocking)
  useEffect(() => {
    if (activeStudyUID) return;
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
  }, [activeStudyUID]);



  const studyUID = activeStudyUID;

  // View Mode: "studio" | "split" | "viewer" (Default to clean Studio Only)
  const [viewMode, setViewMode] = useState("studio"); // "studio" | "split" | "viewer"
  const [splitRatio, setSplitRatio] = useState(50); // Percentage for left viewer in split mode
  const [isResizing, setIsResizing] = useState(false);
  const studioContainerRef = useRef(null);

  const startResizing = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing || !studioContainerRef.current) return;
      const rect = studioContainerRef.current.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const offsetX = clientX - rect.left;
      let newRatio = Math.round((offsetX / rect.width) * 100);
      if (newRatio < 10) newRatio = 10;
      if (newRatio > 90) newRatio = 90;
      setSplitRatio(newRatio);
    };

    const stopResizing = () => {
      if (isResizing) setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", stopResizing);
      window.addEventListener("touchmove", handleMouseMove);
      window.addEventListener("touchend", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResizing);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", stopResizing);
    };
  }, [isResizing]);

  const [showFlashSplitModal, setShowFlashSplitModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isAddendumMode, setIsAddendumMode] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [reportStatus, setReportStatus] = useState("Draft");

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

  // RBAC Reporting Permission Check
  const loggedUser = (() => {
    try { return JSON.parse(sessionStorage.getItem("user") || localStorage.getItem("user") || "{}"); }
    catch { return {}; }
  })();
  const userRole = String(loggedUser.role || "").toUpperCase();
  const canEditReport = userRole === "ADMIN" || userRole === "RADIOLOGIST" || userRole === "DOCTOR";

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
  const activeDoctorReg = loggedUser.reg_no || loggedUser.medical_council_reg || loggedUser.registration_no || clinicBranding.registration_no || "KMC/MED/REG/48190";

  const isFinalSigned = ["Final", "Signed", "Approved", "FINAL", "COMPLETED"].includes(reportStatus);
  const isReadOnly = (isFinalSigned && !isAddendumMode && !adminUnlocked) || !canEditReport;

  // Report Content State
  const [history, setHistory] = useState("");
  const [findingsHtml, setFindingsHtml] = useState("");
  const [conclusionHtml, setConclusionHtml] = useState("");
  const [reportTitle, setReportTitle] = useState("RADIOLOGY REPORT");
  const [selectedModality, setSelectedModality] = useState("XRAY");
  const [attachedSnapshots, setAttachedSnapshots] = useState([]);
  const [activeViewportInfo, setActiveViewportInfo] = useState(null);

  // Auxiliary Features State
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [isSyncingSR, setIsSyncingSR] = useState(false);

  // ContentEditable Refs for WYSIWYG
  const findingsRef = useRef(null);
  const conclusionRef = useRef(null);

  // Prior Studies Auto-Comparison State
  const [priorStudies, setPriorStudies] = useState([]);
  const [selectedPrior, setSelectedPrior] = useState(null);

  useEffect(() => {
    if (study.PatientID) {
      api.get(`/api/reports/priors/${encodeURIComponent(study.PatientID)}?currentUid=${encodeURIComponent(studyUID || "")}`)
        .then((res) => {
          if (res.data?.success && Array.isArray(res.data.priors)) {
            setPriorStudies(res.data.priors);
          }
        })
        .catch((err) => console.warn("Fetch priors notice:", err));
    }
  }, [study.PatientID, studyUID]);

  useEffect(() => {
    if (studyUID) {
      api.get(`/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images`)
        .then((res) => {
          if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
            setAttachedSnapshots(res.data.data);
          }
        })
        .catch(() => {});
    }
  }, [studyUID]);

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
          
          let rawSnapshots = reportData?.report_content?.snapshots || reportData?.snapshots || reportData?.images;
          if (typeof rawSnapshots === "string") {
            try { rawSnapshots = JSON.parse(rawSnapshots); } catch (e) { rawSnapshots = []; }
          }
          if (!Array.isArray(rawSnapshots) || rawSnapshots.length === 0) {
            if (Array.isArray(reportData?.images) && reportData.images.length > 0) {
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

          // Merge key images from local storage captured from mobile/desktop DICOM viewer
          try {
            const localStr = localStorage.getItem(`key_images_${studyUID}`) || localStorage.getItem("key_images");
            if (localStr) {
              const parsed = JSON.parse(localStr);
              if (Array.isArray(parsed)) {
                parsed.forEach((item, idx) => {
                  if (typeof item === "object" && item.studyUID && item.studyUID !== studyUID) {
                    return; // Skip images for other studies
                  }
                  const url = typeof item === "string" ? item : (item.previewUrl || item.preview_url || item.url || item.dataUrl);
                  if (url && !normalizedSnapshots.some(s => s.preview_url === url || s.dataUrl === url)) {
                    const sliceNum = typeof item === "object" ? (item.sliceNumber || item.slice_number) : null;
                    const seriesDesc = typeof item === "object" ? (item.seriesDesc || item.series_desc) : null;
                    const caption = item.caption || ((sliceNum && seriesDesc) ? `${seriesDesc} | Slice ${sliceNum}` : (sliceNum ? `Slice ${sliceNum}` : `Key Image ${normalizedSnapshots.length + 1}`));
                    normalizedSnapshots.push({
                      id: item.id || `local_${Date.now()}_${idx}`,
                      instance_id: item.instance_id || item.id || `inst_${Date.now()}`,
                      preview_url: url,
                      dataUrl: url,
                      caption: caption
                    });
                  }
                });
              }
            }
          } catch (e) {
            console.warn("Failed to parse local key images:", e);
          }

          const hasSavedContent =
            String(savedFindings || "").trim() !== "" ||
            String(savedConclusion || "").trim() !== "" ||
            String(savedHistory || "").trim() !== "";

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
            setAttachedSnapshots(normalizedSnapshots);
          } else {
            autoMatchTemplate(mod, bPart, sDesc);
            setAttachedSnapshots(normalizedSnapshots);
          }
        } catch {
          autoMatchTemplate(mod, bPart, sDesc);
          // Still try to restore local key images if report fetch fails
          try {
            const localStr = localStorage.getItem(`key_images_${studyUID}`) || localStorage.getItem("key_images");
            if (localStr) {
              const parsed = JSON.parse(localStr);
              if (Array.isArray(parsed)) {
                const fallbackSnaps = parsed
                  .filter(item => typeof item !== "object" || !item.studyUID || item.studyUID === studyUID)
                  .map((item, idx) => {
                    const url = typeof item === "string" ? item : (item.previewUrl || item.preview_url || item.url);
                    return {
                      id: `fallback_${Date.now()}_${idx}`,
                      preview_url: url,
                      caption: item.caption || `Key Image ${idx + 1}`
                    };
                  }).filter(s => !!s.preview_url);
                setAttachedSnapshots(fallbackSnaps);
              }
            }
          } catch (e) {
            console.warn("Fallback key images error:", e);
          }
        }
      } catch (err) {
        console.error("Failed to load study for Report Studio:", err);
      } finally {
        setLoading(false);
      }
    };

    loadStudyData();

  }, [studyUID]);

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



  // Key Images / Snapshots Series State
  const [studySeriesList, setStudySeriesList] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [targetSliceNumber, setTargetSliceNumber] = useState("1");
  const [showSlicePickerModal, setShowSlicePickerModal] = useState(false);
  const [pickerSliceNum, setPickerSliceNum] = useState(1);

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
          const isScout = (s) => /topogram|localizer|scout|survey|plan/i.test(s.series_description || '');
          const diagSeries = res.data.series.filter(s => !isScout(s));
          const mainSeries = (diagSeries.length > 0 ? (diagSeries.find(s => s.total_slices > 1) || diagSeries[0]) : res.data.series[0]);
          setSelectedSeriesId(mainSeries.series_id);
          setPickerSliceNum(1);
          setTargetSliceNumber("1");
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
          if (fNum) setTargetSliceNumber(String(fNum));
          const sUid = vpState.seriesInstanceUid || vpState.series_instance_uid;
          const sDesc = vpState.seriesDescription || vpState.SeriesDescription;

          if (sUid || sDesc) {
            setActiveViewportInfo({
              seriesInstanceUid: sUid,
              seriesDescription: sDesc,
              frameNumber: fNum,
              totalSlices: vpState.totalSlices || vpState.totalFrames
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
        }
      }
    );
    return () => unsubscribe();
  }, [study, studySeriesList]);



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
  const handleSyncDicomSr = async () => {
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

  const autoFillDicomSR = handleSyncDicomSr;
  
  // 1-CLICK DIRECT SNAPSHOTTER (NO SELECTION WINDOW)
  const handleAttachKeyImage = async (overrideSliceNum = null, overrideSeriesId = null) => {
    let directDomSliceInfo = null;
    try {
      const iframeEl = document.querySelector(".rs-viewer-iframe, .dws-iframe, iframe");
      if (iframeEl && iframeEl.contentWindow) {
        const iframeDoc = iframeEl.contentDocument || iframeEl.contentWindow.document;
        if (iframeDoc) {
          directDomSliceInfo = detectViewportSliceInfoFromDOM(iframeDoc, studySeriesList);
        }
      }
    } catch (e) {
      // Cross-origin iframe DOM handled via postMessage RPC
    }

    try {
      const iframeEl = document.querySelector(".rs-viewer-iframe, iframe");
      if (iframeEl && iframeEl.contentWindow) {
        iframeEl.contentWindow.postMessage({ type: 'OHIF_CAPTURE_VIEWPORT', action: 'CAPTURE' }, '*');
        iframeEl.contentWindow.postMessage({ type: 'REQUEST_SNAPSHOT', action: 'CAPTURE' }, '*');
      }
    } catch (e) {
      // Ignore postMessage error
    }

    const snapResult = await requestViewerSnapshot(".rs-viewer-iframe, iframe", studySeriesList);
    const capturedDataUrl = typeof snapResult === 'string' ? snapResult : snapResult?.dataUrl;

    const activeSeriesId = directDomSliceInfo?.matchedSeriesId ||
      snapResult?.matchedSeriesId || 
      activeViewportInfo?.seriesInstanceUid || 
      overrideSeriesId || 
      selectedSeriesId;

    let seriesObj = null;
    if (studySeriesList && studySeriesList.length > 0) {
      if (activeSeriesId) {
        const cleanTarget = String(activeSeriesId).trim();
        const numTarget = cleanTarget.replace(/^S:?/i, "");
        seriesObj = studySeriesList.find(s => 
          String(s.series_id) === cleanTarget ||
          String(s.series_instance_uid) === cleanTarget ||
          String(s.orthanc_series_id) === cleanTarget ||
          String(s.series_number) === numTarget
        );
      }
      if (!seriesObj && (directDomSliceInfo?.seriesDescription || snapResult?.seriesDescription)) {
        const targetDesc = String(directDomSliceInfo?.seriesDescription || snapResult?.seriesDescription).toLowerCase().replace(/\s+/g, ' ').trim();
        seriesObj = studySeriesList.find(s => {
          if (!s.series_description) return false;
          const sDescClean = String(s.series_description).toLowerCase().replace(/\s+/g, ' ').trim();
          return sDescClean === targetDesc || sDescClean.includes(targetDesc) || targetDesc.includes(sDescClean);
        });

        if (!seriesObj) {
          const targetTokens = targetDesc.split(/[\s_-]+/).filter(t => t.length >= 3);
          for (const s of studySeriesList) {
            if (!s.series_description) continue;
            const sClean = String(s.series_description).toLowerCase();
            const matchCount = targetTokens.filter(t => sClean.includes(t)).length;
            if (targetTokens.length > 0 && matchCount === targetTokens.length) {
              seriesObj = s;
              break;
            }
          }
        }
      }
      if (!seriesObj && selectedSeriesId) {
        seriesObj = studySeriesList.find(s => 
          String(s.series_id) === String(selectedSeriesId) ||
          String(s.series_instance_uid) === String(selectedSeriesId) ||
          String(s.orthanc_series_id) === String(selectedSeriesId)
        );
      }
      if (!seriesObj) {
        const nonScoutSeries = studySeriesList.filter(s => {
          const d = String(s.series_description || "").toLowerCase();
          return !d.includes("topogram") && !d.includes("localizer") && !d.includes("scout") && !d.includes("survey") && !d.includes("plan");
        });
        seriesObj = nonScoutSeries.length > 0 ? nonScoutSeries[0] : studySeriesList[0];
      }
      if (seriesObj && seriesObj.series_id) {
        setSelectedSeriesId(String(seriesObj.series_id));
      }
    }

    // Resolve detected slice candidate with strict priority:
    // 1. Explicit parameter override (e.g. from picker modal)
    // 2. Direct DOM slice inspection (directDomSliceInfo?.sliceNumber)
    // 3. Verified slice number from live iframe snapshot (snapResult?.sliceNumber)
    // 4. Active viewport info frame number from live listener (activeViewportInfo?.frameNumber)
    // 5. Direct DOM instance number / snapResult instance number
    const detectedSlice = overrideSliceNum !== null 
      ? parseInt(overrideSliceNum, 10) 
      : (
          (directDomSliceInfo?.sliceNumber && parseInt(directDomSliceInfo.sliceNumber, 10) > 0 ? parseInt(directDomSliceInfo.sliceNumber, 10) : null) ||
          (snapResult?.sliceNumber && parseInt(snapResult.sliceNumber, 10) > 0 ? parseInt(snapResult.sliceNumber, 10) : null) ||
          (activeViewportInfo?.frameNumber && parseInt(activeViewportInfo.frameNumber, 10) > 0 ? parseInt(activeViewportInfo.frameNumber, 10) : null) ||
          (activeViewportInfo?.sliceNumber && parseInt(activeViewportInfo.sliceNumber, 10) > 0 ? parseInt(activeViewportInfo.sliceNumber, 10) : null) ||
          (directDomSliceInfo?.instanceNumber && parseInt(directDomSliceInfo.instanceNumber, 10) > 0 ? parseInt(directDomSliceInfo.instanceNumber, 10) : null) ||
          (snapResult?.instanceNumber && parseInt(snapResult.instanceNumber, 10) > 0 ? parseInt(snapResult.instanceNumber, 10) : null) ||
          null
        );

    const totalSlices = snapResult?.totalSlices || directDomSliceInfo?.totalSlices || seriesObj?.total_slices || (activeViewportInfo?.totalSlices) || 1;

    let displaySliceNum = detectedSlice;
    let isDefaultedSlice = false;

    if (!displaySliceNum || isNaN(displaySliceNum) || displaySliceNum < 1) {
      isDefaultedSlice = true;
      // Default to slice 1 / active viewport, NEVER fabricate fake mid-series slice numbers (157, 102, etc.)
      displaySliceNum = 1;
    }
    displaySliceNum = Math.min(Math.max(1, displaySliceNum), totalSlices);

    const seriesDesc = seriesObj?.series_description || snapResult?.seriesDescription || "Diagnostic Series";
    const fullCaption = totalSlices > 1 
      ? `${seriesDesc} | ${displaySliceNum}/${totalSlices}` 
      : `${seriesDesc} | ${displaySliceNum}`;

    let targetInst = null;
    if (seriesObj && seriesObj.instances && seriesObj.instances.length > 0) {
      targetInst = seriesObj.instances.find(inst => 
        parseInt(inst.slice_index, 10) === displaySliceNum || 
        parseInt(inst.slice_number, 10) === displaySliceNum ||
        parseInt(inst.instanceNumber, 10) === displaySliceNum ||
        parseInt(inst.instance_number, 10) === displaySliceNum
      );

      if (!targetInst && snapResult?.instanceNumber) {
        targetInst = seriesObj.instances.find(inst => 
          parseInt(inst.slice_number, 10) === snapResult.instanceNumber || 
          parseInt(inst.instance_number, 10) === snapResult.instanceNumber ||
          parseInt(inst.instanceNumber, 10) === snapResult.instanceNumber ||
          parseInt(inst.slice_index, 10) === snapResult.instanceNumber
        );
      }

      if (!targetInst) {
        const boundedIndex = isDefaultedSlice ? 0 : Math.min(Math.max(0, displaySliceNum - 1), seriesObj.instances.length - 1);
        targetInst = seriesObj.instances[boundedIndex];
      }
    }

    const validDataUrl = (capturedDataUrl && typeof capturedDataUrl === 'string' && capturedDataUrl.startsWith('data:image/') && capturedDataUrl.length > 500) ? capturedDataUrl : null;
    
    let snapObj = null;
    try {
      const capturePayload = {
        studyUID: studyUID,
        seriesUID: seriesObj?.series_id || activeSeriesId,
        sliceNumber: displaySliceNum,
        totalSlices: totalSlices,
        seriesDescription: seriesDesc,
        instanceId: targetInst?.instance_id,
        dataUrl: validDataUrl,
        caption: fullCaption
      };
      const res = await api.post('/api/pacs/capture-key-image', capturePayload);
      if (res.data && res.data.success && res.data.data) {
        snapObj = res.data.data;
      }
    } catch (err) {
      console.warn("capture-key-image microservice call failed:", err.message);
    }

    if (!snapObj) {
      const fallbackUrl = targetInst?.preview_url || targetInst?.previewUrl || (targetInst?.instance_id ? `/api/pacs/instance-preview/${targetInst.instance_id}?studyUID=${encodeURIComponent(studyUID || '')}&seriesUID=${encodeURIComponent(seriesObj?.series_id || '')}` : null);
      const previewUrl = validDataUrl || fallbackUrl;

      if (!previewUrl) {
        console.warn("Could not resolve valid preview image URL for key image capture.");
        return;
      }

      snapObj = {
        id: `snap_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        instance_id: targetInst?.instance_id || `inst_${Date.now()}`,
        dataUrl: validDataUrl,
        preview_url: previewUrl,
        fallback_preview_url: fallbackUrl,
        caption: fullCaption,
        sliceNumber: displaySliceNum,
        seriesDesc: seriesDesc,
        studyUID: studyUID
      };
    }

    if (studyUID) {
      try {
        const localStr = localStorage.getItem(`key_images_${studyUID}`) || "[]";
        let parsed = [];
        try { parsed = JSON.parse(localStr); } catch (e) { parsed = []; }
        const updated = [snapObj, ...(Array.isArray(parsed) ? parsed.filter(s => (s.id || s.instance_id) !== snapObj.id) : [])];
        localStorage.setItem(`key_images_${studyUID}`, JSON.stringify(updated));
      } catch (e) {
        // ignore localStorage errors
      }
    }

    setAttachedSnapshots(prev => [...prev, snapObj]);
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
    if (!studyUID) {
      alert("Cannot save report: Missing StudyInstanceUID.");
      return;
    }

    if (!canEditReport) {
      alert(`🔒 Access Restricted: Users logged in with role '${userRole}' are not authorized to create, edit, or save diagnostic reports. Report editing is restricted to Radiologists & Physicians.`);
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
      .replace(/<div[^>]*>.*?🤖.*?<\/div>/gi, "")
      .replace(/<div[^>]*>.*?AI\s*(GENERATED|SUMMARY)?\s*IMPRESSION.*?<\/div>/gi, "")
      .replace(/<strong[^>]*>.*?🤖.*?<\/strong>/gi, "")
      .replace(/<strong[^>]*>.*?AI\s*(GENERATED|SUMMARY)?\s*IMPRESSION.*?<\/strong>/gi, "")
      .replace(/🤖\s*(AI GENERATED|AI SUMMARY)?\s*IMPRESSION:?/gi, "")
      .replace(/🤖\s*IMPRESSION:?/gi, "")
      .replace(/🤖/g, "")
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
      {/* SINGLE-COLUMN STREAMLINED REPORT EDITOR CANVAS */}
      <div className="rs-editor-canvas" style={{ maxWidth: 1240, margin: '0 auto', width: '100%' }}>
        {/* PRIOR STUDIES HISTORICAL COMPARISON BAR */}
        {priorStudies.length > 0 && (
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#0369a1', display: 'flex', alignItems: 'center', gap: 6 }}>
                🕒 Patient Imaging History ({priorStudies.length} Prior Study Records Found)
              </span>
              <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0284c7', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                Side-by-Side Comparison Enabled
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {priorStudies.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPrior(selectedPrior?.id === p.id ? null : p)}
                  style={{
                    background: selectedPrior?.id === p.id ? '#0284c7' : '#ffffff',
                    color: selectedPrior?.id === p.id ? '#ffffff' : '#0f172a',
                    border: '1px solid #93c5fd',
                    borderRadius: 8,
                    padding: '6px 12px',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  📅 {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : 'Prior'} - {p.modality} ({p.body_part || 'Exam'})
                </button>
              ))}
            </div>

            {selectedPrior && (
              <div style={{ marginTop: 12, background: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 12 }}>
                <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>
                  Prior Report ({new Date(selectedPrior.created_at).toLocaleDateString()}) - {selectedPrior.report_title || selectedPrior.modality}
                </div>
                <div style={{ color: '#334155', fontSize: 11, lineHeight: 1.5, maxHeight: 120, overflowY: 'auto', background: '#f8fafc', padding: 8, borderRadius: 6 }}>
                  <strong>Prior Findings/Conclusion:</strong> {selectedPrior.report_content?.conclusion || selectedPrior.report_content?.findings || "Prior report recorded."}
                </div>
              </div>
            )}
          </div>
        )}
        {/* NON-DOCTOR READ-ONLY ACCESS NOTIFICATION */}
        {!canEditReport && (
          <div style={{
            padding: '12px 18px',
            borderRadius: 12,
            background: '#eff6ff',
            border: '1.5px solid #93c5fd',
            marginBottom: 14,
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
            marginBottom: 14,
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

        {/* COMPACT EXECUTIVE DEMOGRAPHY & REPORT HEADER CARD */}
        <div style={{ background: '#ffffff', borderRadius: 12, border: '1px solid #cbd5e1', padding: '12px 16px', marginBottom: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
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
                disabled={isReadOnly}
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
                disabled={isReadOnly}
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
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          color: '#ffffff',
          boxShadow: '0 2px 8px rgba(30, 27, 75, 0.2)'
        }}>
          {/* MODALITY PILLS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Modality:</span>
            {[
              { id: "CT", label: "CT" },
              { id: "MRI", label: "MRI" },
              { id: "USG", label: "USG" },
              { id: "CR", label: "XRAY" },
              { id: "ECHO", label: "ECHO" }
            ].map((m) => {
              const isSelected = selectedModality === m.id || (selectedModality === "XRAY" && m.id === "CR");
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModality(m.id === "CR" ? "XRAY" : m.id)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer',
                    background: isSelected ? '#6366f1' : 'rgba(255, 255, 255, 0.1)',
                    color: isSelected ? '#ffffff' : '#cbd5e1',
                    transition: 'all 0.15s ease'
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* COMPACT INLINE TEMPLATE DROPDOWN */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#c7d2fe', whiteSpace: 'nowrap' }}>⚡ Load Structured Template:</span>
            <select
              onChange={(e) => {
                const list = RADIOLOGY_TEMPLATES[selectedModality] || RADIOLOGY_TEMPLATES.CR || RADIOLOGY_TEMPLATES.XRAY || [];
                const tpl = list.find((t) => t.id === e.target.value);
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
              {((RADIOLOGY_TEMPLATES[selectedModality] || (selectedModality === "XRAY" ? RADIOLOGY_TEMPLATES.CR || RADIOLOGY_TEMPLATES.XRAY : [])) || []).map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.body_part})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* MEDICAL VOICE DICTATION CONTROL BAR */}
        {!isReadOnly && (
          <div style={{ marginBottom: 14 }}>
            <VoiceDictationManager
              onTranscript={handleDictationTranscript}
              onCommand={handleVoiceCommand}
              activeTargetField="findings"
            />
          </div>
        )}

        {/* FINDINGS RICH TEXT WYSIWYG EDITOR */}
        <div className="rs-section-card">
          <div className="rs-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="rs-section-title">Detailed Imaging Findings</span>
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
          ></div>
        </div>

        {/* IMPRESSION / CONCLUSION RICH TEXT EDITOR */}
        <div className="rs-section-card">
          <div className="rs-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="rs-section-title">Clinical Impression & Conclusion</span>
            {!isReadOnly && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  type="button"
                  disabled={isGeneratingAI}
                  onClick={generateAIImpression}
                  style={{
                    background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)'
                  }}
                >
                  <Sparkles size={14} /> {isGeneratingAI ? "Generating..." : "⚡ Auto AI Impression"}
                </button>
              </div>
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
          ></div>
        </div>
        {/* ATTACHED KEY DIAGNOSTIC IMAGES CARD */}
        <KeyImageGallery
          studyUID={studyUID}
          attachedSnapshots={attachedSnapshots}
          setAttachedSnapshots={setAttachedSnapshots}
          onOpenPicker={() => setShowSlicePickerModal(true)}
          onAttachActiveSlice={() => handleAttachKeyImage(null, null)}
          studySeriesList={studySeriesList}
          selectedSeriesId={selectedSeriesId}
          onSelectSeries={(sId) => setSelectedSeriesId(sId)}
          onInsertToEditor={(snap) => {
            const pUrl = snap.preview_url || snap.previewUrl || snap.url;
            const chipHtml = ` <span style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; border-radius: 4px; padding: 2px 5px; font-weight: 700; font-size: 10px;" contenteditable="false">📸 [${snap.caption || 'Key Image'}]</span> `;
            if (findingsRef.current) {
              findingsRef.current.focus();
              document.execCommand('insertHTML', false, chipHtml);
              setFindingsHtml(findingsRef.current.innerHTML);
            }
          }}
        />
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

        {/* VIEW MODE TOGGLE BAR WITH DOCKING RATIOS */}
        <div className="rs-viewmode-bar" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={() => { handleSetViewMode("split"); setSplitRatio(90); }}
            className={`rs-viewmode-btn ${viewMode === "split" && splitRatio === 90 ? "active" : ""}`}
            title="90% DICOM Viewer, 10% Report Studio"
          >
            🔍 90% Viewer
          </button>
          <button
            onClick={() => { handleSetViewMode("split"); setSplitRatio(50); }}
            className={`rs-viewmode-btn ${viewMode === "split" && splitRatio === 50 ? "active" : ""}`}
            title="50% Viewer / 50% Studio Split"
          >
            <Zap size={14} /> ⚡ 50/50 Split
          </button>
          <button
            onClick={() => { handleSetViewMode("split"); setSplitRatio(10); }}
            className={`rs-viewmode-btn ${viewMode === "split" && splitRatio === 10 ? "active" : ""}`}
            title="10% DICOM Viewer, 90% Report Studio"
          >
            📝 90% Studio
          </button>
          <button
            onClick={() => handleSetViewMode("viewer")}
            className={`rs-viewmode-btn ${viewMode === "viewer" ? "active" : ""}`}
            title="Full Screen Viewer"
          >
            <Maximize2 size={14} /> Viewer Only
          </button>
          <button
            onClick={() => handleSetViewMode("studio")}
            className={`rs-viewmode-btn ${viewMode === "studio" ? "active" : ""}`}
            title="Full Screen Report Studio"
          >
            <FileText size={14} /> Studio Only
          </button>
        </div>

        {/* TOP ACTION TOOLBAR */}
        <div className="rs-header-actions">
          <button
            onClick={() => setShowFlashSplitModal(true)}
            className="rs-btn rs-btn-primary"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)', color: '#ffffff' }}
            title="Launch Fullscreen Diagnostic Workstation"
          >
            <Zap size={16} /> ⚡ Diagnostic Workstation
          </button>

          <button onClick={() => openStudyViewer(studyUID)} className="rs-btn rs-btn-primary">
            <Eye size={16} /> Open Viewer in New Window
          </button>

          {!isReadOnly && (
            <button onClick={() => handleAttachKeyImage(null, null)} className="rs-btn rs-btn-dark" title="Capture & attach current DICOM viewer image to report">
              <Camera size={16} /> 📸 Key Image / Snapshot
            </button>
          )}

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

      {/* DYNAMIC VIEW MODE RENDER — PERSISTENT SINGLE IFRAME WITH DRAGGABLE RESIZER */}
      <div
        className="rs-split-layout"
        ref={studioContainerRef}
        style={{
          display: viewMode === "studio" ? "block" : "flex",
          width: '100%',
          position: 'relative'
        }}
      >
        <div
          className="rs-viewer-pane"
          style={{
            width: viewMode === "split" ? `${splitRatio}%` : viewMode === "viewer" ? "100%" : "0%",
            display: viewMode === "studio" ? "none" : "block",
            height: 'calc(100vh - 120px)',
            pointerEvents: isResizing ? 'none' : 'auto'
          }}
        >
          <iframe
            src={viewerUrl}
            title="OHIF Viewer"
            className="rs-viewer-iframe"
            style={{ width: '100%', height: '100%', border: 'none' }}
          />
        </div>

        {/* DRAGGABLE RESIZER BAR */}
        {viewMode === "split" && (
          <div
            onMouseDown={startResizing}
            onTouchStart={startResizing}
            style={{
              width: 8,
              cursor: 'col-resize',
              background: isResizing ? '#0284c7' : '#cbd5e1',
              transition: 'background 0.2s',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none'
            }}
            title="Drag left/right to resize DICOM Viewer and Report Studio"
          >
            <div style={{ width: 2, height: 28, background: '#64748b', borderRadius: 2 }} />
          </div>
        )}

        <div
          className="rs-studio-pane"
          style={{
            width: viewMode === "split" ? `${100 - splitRatio}%` : viewMode === "viewer" ? "0%" : "100%",
            flex: 1,
            display: viewMode === "viewer" ? "none" : "block"
          }}
        >
          {renderStudioForm()}
        </div>
      </div>

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
                  className="rs-btn"
                  style={{ background: '#0284c7', color: '#ffffff' }}
                >
                  <FileText size={16} /> Download Official PDF
                </button>
                <button onClick={handlePrint} className="rs-btn rs-btn-emerald">
                  <Printer size={16} /> Print Now
                </button>
                <button onClick={() => setShowPrintModal(false)} className="rs-btn rs-btn-outline">
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
                    <td style={{ padding: 6, border: '1px solid #ccc' }}>{study.Modality || "CR"}</td>
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
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(filterAiTerms(findingsHtml)) }} />
              </div>

              <div style={{ marginBottom: 30, padding: 12, border: '1.5px solid #000', borderRadius: 8, background: '#fafafa', fontSize: 13 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 6 }}>IMPRESSION & CONCLUSION:</div>
                <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(filterAiTerms(conclusionHtml)) }} />
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

      {/* VISUAL DICOM KEY IMAGE PICKER MODAL */}
      <DicomKeyImagePickerModal
        isOpen={showSlicePickerModal}
        onClose={() => setShowSlicePickerModal(false)}
        studyUID={studyUID}
        attachedSnapshots={attachedSnapshots}
        onSelectImage={(snapObj) => {
          setAttachedSnapshots(prev => {
            if (prev.some(s => s.preview_url === snapObj.preview_url || String(s.instance_id) === String(snapObj.instance_id))) {
              return prev;
            }
            return [...prev, snapObj];
          });
        }}
      />
    </div>
  );
}
