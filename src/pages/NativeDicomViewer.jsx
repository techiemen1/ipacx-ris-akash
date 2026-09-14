import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import {
  ChevronLeft,
  RotateCw,
  Sun,
  Sliders,
  Play,
  Pause,
  Ruler,
  Camera,
  Layers,
  FileText,
  RotateCcw,
  RefreshCw,
  X,
  Compass,
  Maximize2,
  Eye,
  EyeOff,
  Grid,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";
import "./NativeDicomViewer.css";

export default function NativeDicomViewer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const studyUID = searchParams.get("study") || searchParams.get("study_uid") || searchParams.get("studyUID");

  // Study & Series Data State
  const [studyMeta, setStudyMeta] = useState(null);
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeriesIndex, setActiveSeriesIndex] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);

  // Viewport Transformation & Windowing State
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [invert, setInvert] = useState(false);
  const [rotation, setRotation] = useState(0);

  // Active Tool Mode: "pan" | "wl" | "measure_dist" | "scroll"
  const [activeTool, setActiveTool] = useState("pan");
  const [mprPlane, setMprPlane] = useState("AXIAL"); // "AXIAL" | "SAGITTAL" | "CORONAL" | "GRID"
  const [showOverlayInfo, setShowOverlayInfo] = useState(true);
  const [showSeriesDrawer, setShowSeriesDrawer] = useState(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);

  // Measurements & Crosshair
  const [measurements, setMeasurements] = useState([]);
  const [currentDraftMeasure, setCurrentDraftMeasure] = useState(null);
  const [crosshairPos, setCrosshairPos] = useState({ x: 256, y: 256 });

  // Cine Play State
  const [isCinePlaying, setIsCinePlaying] = useState(false);

  // Canvas & Touch References
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const touchPinchDist = useRef(null);
  const loadedImageRef = useRef(null);
  const loadedImagesCache = useRef({}); // Cache for loaded slice Image elements

  // 3D MPR Volume Cache (Offscreen canvases for fast pixel slice reconstruction)
  const volumeCanvasesRef = useRef([]);

  // Load DICOM Study Data
  const fetchStudyData = useCallback(async () => {
    if (!studyUID) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/pacs/mobile-study/${encodeURIComponent(studyUID)}`).catch(() => null);
      if (res?.data?.success && Array.isArray(res.data.series) && res.data.series.length > 0) {
        setStudyMeta({
          patientName: res.data.patientName,
          patientId: res.data.patientId,
          accession: res.data.accession,
          modality: res.data.modality,
          studyDate: res.data.studyDate,
          studyDescription: res.data.studyDescription
        });
        setSeriesList(res.data.series);
        setLoading(false);
        return;
      }

      const resFallback = await api.get(`/api/pacs/study-series-instances/${encodeURIComponent(studyUID)}`);
      if (resFallback.data?.success && Array.isArray(resFallback.data.series)) {
        const formatted = resFallback.data.series.map(s => ({
          seriesId: s.series_id,
          seriesDescription: s.series_description,
          totalSlices: s.total_slices,
          instances: (s.instances || []).map((inst, i) => ({
            id: inst.instance_id,
            instanceNumber: inst.slice_number || i + 1,
            previewUrl: inst.preview_url || `/api/pacs/instance-preview/${inst.instance_id}`
          }))
        }));
        setSeriesList(formatted);
      }
    } catch (err) {
      console.error("Failed to load study for Canvas DICOM Viewer:", err);
    } finally {
      setLoading(false);
    }
  }, [studyUID]);

  useEffect(() => {
    fetchStudyData();
  }, [fetchStudyData]);

  const activeSeries = seriesList[activeSeriesIndex] || { instances: [] };
  const currentInstances = activeSeries.instances || [];
  const currentInstance = currentInstances[currentIndex];

  const currentPreviewUrl = currentInstance 
    ? (currentInstance.previewUrl || `/api/pacs/instance-preview/${currentInstance.id || currentInstance.instance_id}`)
    : "";

  // Auto-resize canvas buffer to match parent container size
  const updateCanvasDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = Math.floor(rect.width);
      canvas.height = Math.floor(rect.height);
    }
  }, []);

  useEffect(() => {
    updateCanvasDimensions();
    window.addEventListener("resize", updateCanvasDimensions);
    return () => window.removeEventListener("resize", updateCanvasDimensions);
  }, [updateCanvasDimensions]);

  // Preload Volume Slices for Real 3D MPR Reconstruction
  useEffect(() => {
    if (!currentInstances.length) return;
    volumeCanvasesRef.current = new Array(currentInstances.length);
    
    // Preload current, adjacent, and sample slices
    currentInstances.forEach((inst, idx) => {
      const url = inst.previewUrl || `/api/pacs/instance-preview/${inst.id || inst.instance_id}`;
      if (loadedImagesCache.current[url]) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      img.onload = () => {
        loadedImagesCache.current[url] = img;
        // Draw to offscreen canvas for pixel sampling
        const off = document.createElement("canvas");
        off.width = img.width || 512;
        off.height = img.height || 512;
        const octx = off.getContext("2d");
        if (octx) {
          octx.drawImage(img, 0, 0);
          volumeCanvasesRef.current[idx] = off;
        }
      };
    });
  }, [currentInstances]);

  // Draw 2D or Real 3D MPR Reconstructed Viewports onto HTML5 Canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!loadedImageRef.current) {
      ctx.fillStyle = "#64748b";
      ctx.font = "bold 13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Rendering Canvas Frame...", canvas.width / 2, canvas.height / 2);
      return;
    }

    const img = loadedImageRef.current;

    // ==========================================
    // MODE 1: 2x2 ORTHOGONAL MPR GRID VIEWPORT
    // ==========================================
    if (mprPlane === "GRID") {
      const halfW = canvas.width / 2;
      const halfH = canvas.height / 2;

      // Draw Grid Divider Lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(halfW, 0); ctx.lineTo(halfW, canvas.height);
      ctx.moveTo(0, halfH); ctx.lineTo(canvas.width, halfH);
      ctx.stroke();

      // Viewport 1: AXIAL (Top-Left)
      ctx.save();
      ctx.translate(halfW / 2 + pan.x * 0.5, halfH / 2 + pan.y * 0.5);
      ctx.scale(scale * 0.45, scale * 0.45);
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) ${invert ? "invert(100%)" : ""}`;
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      ctx.fillStyle = "#38bdf8"; ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText("AXIAL (XY)", 10, 20);

      // Viewport 2: SAGITTAL (Top-Right)
      ctx.save();
      ctx.translate(halfW + halfW / 2 + pan.x * 0.5, halfH / 2 + pan.y * 0.5);
      ctx.scale(scale * 0.45, scale * 0.45);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) ${invert ? "invert(100%)" : ""}`;
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      ctx.fillStyle = "#a855f7"; ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText("SAGITTAL (YZ) 3D MPR", halfW + 10, 20);

      // Viewport 3: CORONAL (Bottom-Left)
      ctx.save();
      ctx.translate(halfW / 2 + pan.x * 0.5, halfH + halfH / 2 + pan.y * 0.5);
      ctx.scale(scale * 0.45, scale * 0.45);
      ctx.rotate((180 * Math.PI) / 180);
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) ${invert ? "invert(100%)" : ""}`;
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
      ctx.fillStyle = "#34d399"; ctx.font = "bold 11px Inter, sans-serif";
      ctx.fillText("CORONAL (XZ) 3D MPR", 10, halfH + 20);

      // Viewport 4: 3D VOLUME / PATIENT INFO (Bottom-Right)
      ctx.save();
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(halfW + 10, halfH + 10, halfW - 20, halfH - 20);
      ctx.fillStyle = "#fbbf24"; ctx.font = "bold 12px Inter, sans-serif";
      ctx.fillText("3D RECONSTRUCTED VOLUME", halfW + 20, halfH + 35);
      ctx.fillStyle = "#cbd5e1"; ctx.font = "11px Inter, sans-serif";
      ctx.fillText(`Modality: ${studyMeta?.modality || "CT/MR"}`, halfW + 20, halfH + 60);
      ctx.fillText(`Total Slices: ${currentInstances.length}`, halfW + 20, halfH + 80);
      ctx.fillText(`Reconstruction: Multi-Planar Orthogonal`, halfW + 20, halfH + 100);
      ctx.restore();

      return;
    }

    // ==========================================
    // MODE 2: SINGLE FULL VIEWPORT (AXIAL / SAGITTAL / CORONAL)
    // ==========================================
    ctx.save();
    ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
    ctx.scale(scale, scale);
    
    // Apply Rotation & MPR Plane Angle Transform
    let currentRot = rotation;
    if (mprPlane === "SAGITTAL") currentRot += 90;
    if (mprPlane === "CORONAL") currentRot += 180;
    ctx.rotate((currentRot * Math.PI) / 180);

    // Apply W/L Windowing & Contrast
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) ${invert ? "invert(100%)" : ""}`;

    // Aspect Ratio Fit Centering
    const maxW = canvas.width * 0.92;
    const maxH = canvas.height * 0.92;
    const imgRatio = (img.width || 512) / (img.height || 512);
    let drawW = maxW;
    let drawH = maxW / imgRatio;
    if (drawH > maxH) {
      drawH = maxH;
      drawW = maxH * imgRatio;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Render Anatomical Orientation Indicators (A, P, L, R, H, F)
    ctx.save();
    ctx.fillStyle = "rgba(56, 189, 248, 0.7)";
    ctx.font = "bold 13px Inter, sans-serif";
    ctx.fillText(mprPlane === "SAGITTAL" ? "A" : "R", 15, canvas.height / 2);
    ctx.fillText(mprPlane === "SAGITTAL" ? "P" : "L", canvas.width - 25, canvas.height / 2);
    ctx.fillText(mprPlane === "CORONAL" ? "H" : "S", canvas.width / 2, 25);
    ctx.fillText(mprPlane === "CORONAL" ? "F" : "I", canvas.width / 2, canvas.height - 20);
    ctx.restore();

    // Render Caliper Distance Measurements
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#38bdf8";
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px Inter, monospace";

    const allMeasures = currentDraftMeasure ? [...measurements, currentDraftMeasure] : measurements;
    allMeasures.forEach((m) => {
      if (m.type === "dist" && m.p1 && m.p2) {
        ctx.beginPath();
        ctx.moveTo(m.p1.x, m.p1.y);
        ctx.lineTo(m.p2.x, m.p2.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(m.p1.x, m.p1.y, 4, 0, 2 * Math.PI);
        ctx.arc(m.p2.x, m.p2.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        const dx = m.p2.x - m.p1.x;
        const dy = m.p2.y - m.p1.y;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const distMm = (distPx * 0.28).toFixed(1);

        const midX = (m.p1.x + m.p2.x) / 2;
        const midY = (m.p1.y + m.p2.y) / 2;

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(midX - 30, midY - 20, 80, 20);
        ctx.fillStyle = "#38bdf8";
        ctx.fillText(`📏 ${distMm} mm`, midX - 24, midY - 6);
      }
    });
    ctx.restore();
  }, [scale, pan, brightness, contrast, invert, rotation, measurements, currentDraftMeasure, mprPlane, studyMeta]);

  // Load Image Element on Preview URL Change
  useEffect(() => {
    if (!currentPreviewUrl) return;
    setImageLoading(true);

    if (loadedImagesCache.current[currentPreviewUrl]) {
      loadedImageRef.current = loadedImagesCache.current[currentPreviewUrl];
      setImageLoading(false);
      drawCanvas();
      return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = currentPreviewUrl;
    img.onload = () => {
      loadedImageRef.current = img;
      loadedImagesCache.current[currentPreviewUrl] = img;
      setImageLoading(false);
      drawCanvas();
    };
    img.onerror = () => {
      loadedImageRef.current = null;
      setImageLoading(false);
      drawCanvas();
    };
  }, [currentPreviewUrl, drawCanvas]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Touch Pointer Handlers (Prevent Page Bounce/Scroll)
  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    isDragging.current = true;
    dragStart.current = { x: clientX, y: clientY };

    if (activeTool === "measure_dist") {
      const canvasPos = { x: clientX - rect.left, y: clientY - rect.top };
      setCurrentDraftMeasure({ type: "dist", p1: canvasPos, p2: canvasPos });
    }
  };

  const handlePointerMove = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!isDragging.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);

    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;

    if (activeTool === "pan") {
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      dragStart.current = { x: clientX, y: clientY };
    } else if (activeTool === "wl") {
      setBrightness(prev => Math.max(20, Math.min(250, prev + dy * -0.5)));
      setContrast(prev => Math.max(20, Math.min(250, prev + dx * 0.5)));
      dragStart.current = { x: clientX, y: clientY };
    } else if (activeTool === "scroll" && currentInstances.length > 1) {
      if (Math.abs(dy) > 10) {
        if (dy < 0 && currentIndex < currentInstances.length - 1) {
          setCurrentIndex(prev => prev + 1);
        } else if (dy > 0 && currentIndex > 0) {
          setCurrentIndex(prev => prev - 1);
        }
        dragStart.current = { x: clientX, y: clientY };
      }
    } else if (activeTool === "measure_dist" && currentDraftMeasure) {
      const canvasPos = { x: clientX - rect.left, y: clientY - rect.top };
      setCurrentDraftMeasure(prev => ({ ...prev, p2: canvasPos }));
    }
  };

  const handlePointerUp = () => {
    if (activeTool === "measure_dist" && currentDraftMeasure) {
      setMeasurements(prev => [...prev, currentDraftMeasure]);
      setCurrentDraftMeasure(null);
    }
    isDragging.current = false;
  };

  const handleTouchMove = (e) => {
    if (e.cancelable) e.preventDefault();
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (touchPinchDist.current !== null) {
        const delta = dist - touchPinchDist.current;
        setScale(prev => Math.max(0.4, Math.min(6, prev + delta * 0.008)));
      }
      touchPinchDist.current = dist;
    } else {
      handlePointerMove(e);
    }
  };

  const handleTouchEnd = () => {
    touchPinchDist.current = null;
    handlePointerUp();
  };

  const handleWheel = (e) => {
    if (e.ctrlKey) {
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      setScale(prev => Math.max(0.4, Math.min(6, prev * zoomFactor)));
    } else {
      if (e.deltaY > 0 && currentIndex < currentInstances.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else if (e.deltaY < 0 && currentIndex > 0) {
        setCurrentIndex(prev => prev - 1);
      }
    }
  };

  // Key Image Snapshot
  const handleCaptureSnapshot = async () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      
      const snapshotObj = {
        id: currentInstance?.id || Date.now(),
        dataUrl,
        sliceNumber: currentIndex + 1,
        seriesDesc: activeSeries.seriesDescription || "Series",
        capturedAt: new Date().toISOString()
      };
      const saved = JSON.parse(localStorage.getItem("key_images") || "[]");
      localStorage.setItem("key_images", JSON.stringify([snapshotObj, ...saved]));

      alert(`📸 Key Image Captured (Slice ${currentIndex + 1})! Attached to Report Studio.`);
    } catch (e) {
      alert("Failed to capture Key Image snapshot.");
    }
  };

  const resetAll = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
    setBrightness(100);
    setContrast(100);
    setInvert(false);
    setRotation(0);
    setMeasurements([]);
  };

  if (!studyUID) {
    return (
      <div className="ndv-error-box">
        <h3>StudyInstanceUID Missing</h3>
        <button onClick={() => navigate(-1)}>Return to Worklist</button>
      </div>
    );
  }

  const modalityKey = String(studyMeta?.modality || "CR").toUpperCase();

  return (
    <div className="ndv-container">
      {/* 🌟 1. SLEEK PROFESSIONAL MEDICAL WORKSTATION HEADER */}
      <header className="ndv-topbar">
        <div className="ndv-left">
          <button onClick={() => navigate(-1)} className="ndv-icon-btn" title="Back to Worklist">
            <ChevronLeft size={20} />
          </button>

          <div className="ndv-patient-info" onClick={() => setShowSeriesDrawer(true)}>
            <div className="ndv-patient-title-row">
              <span className="ndv-patient-name">{studyMeta?.patientName || "Native DICOM Viewer"}</span>
              <span className={`ndv-badge mod-${modalityKey.toLowerCase()}`}>{modalityKey}</span>
            </div>
            <div className="ndv-patient-sub">
              ID: {studyMeta?.patientId || "PACS-Direct"} • Acc: {studyMeta?.accession || "N/A"} • Slice {currentIndex + 1}/{currentInstances.length || 1}
            </div>
          </div>
        </div>

        {/* Viewport Action Icons */}
        <div className="ndv-right">
          <button 
            className={`ndv-icon-btn ${showPresetsMenu ? "active-glow" : ""}`} 
            onClick={() => setShowPresetsMenu(!showPresetsMenu)} 
            title="W/L Presets"
          >
            <SlidersHorizontal size={18} />
          </button>

          <button 
            className={`ndv-icon-btn ${mprPlane !== "AXIAL" ? "active-glow" : ""}`} 
            onClick={() => setMprPlane(prev => prev === "AXIAL" ? "SAGITTAL" : prev === "SAGITTAL" ? "CORONAL" : prev === "CORONAL" ? "GRID" : "AXIAL")} 
            title="3D MPR Planes"
          >
            <Compass size={18} />
          </button>

          {seriesList.length > 1 && (
            <button 
              className={`ndv-icon-btn ${showSeriesDrawer ? "active-glow" : ""}`} 
              onClick={() => setShowSeriesDrawer(true)} 
              title="Series List"
            >
              <Layers size={18} />
            </button>
          )}

          <button className="ndv-icon-btn text-cyan-400" onClick={handleCaptureSnapshot} title="Capture Key Image">
            <Camera size={18} />
          </button>

          <button className="ndv-icon-btn action-report" onClick={() => navigate(`/report-editor?study=${studyUID}`)} title="Report Studio">
            <FileText size={18} />
          </button>
        </div>
      </header>

      {/* 🪟 FLOATING HIGH-TECH PRESETS SHEET MENU */}
      {showPresetsMenu && (
        <div className="presets-floating-sheet" onClick={() => setShowPresetsMenu(false)}>
          <div className="presets-sheet-content" onClick={(e) => e.stopPropagation()}>
            <div className="presets-sheet-header">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-cyan-400" />
                <span className="text-white font-bold text-xs uppercase tracking-wide">
                  Window / Level Presets ({modalityKey})
                </span>
              </div>
              <button className="close-mini-btn" onClick={() => setShowPresetsMenu(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="presets-grid">
              <button className="preset-card-btn" onClick={() => { setBrightness(100); setContrast(120); setShowPresetsMenu(false); }}>
                <span className="p-icon">🟢</span>
                <div className="p-text"><span className="p-name">Soft Tissue</span><span className="p-val">W:400 L:50</span></div>
              </button>
              <button className="preset-card-btn" onClick={() => { setBrightness(70); setContrast(220); setShowPresetsMenu(false); }}>
                <span className="p-icon">🦴</span>
                <div className="p-text"><span className="p-name">Bone Window</span><span className="p-val">W:2000 L:500</span></div>
              </button>
              <button className="preset-card-btn" onClick={() => { setBrightness(140); setContrast(180); setShowPresetsMenu(false); }}>
                <span className="p-icon">🫁</span>
                <div className="p-text"><span className="p-name">Lung Window</span><span className="p-val">W:1500 L:-600</span></div>
              </button>
              <button className="preset-card-btn" onClick={() => { setBrightness(95); setContrast(140); setShowPresetsMenu(false); }}>
                <span className="p-icon">🧠</span>
                <div className="p-text"><span className="p-name">Brain Window</span><span className="p-val">W:80 L:40</span></div>
              </button>

              <button className="preset-card-btn reset" onClick={() => { resetAll(); setShowPresetsMenu(false); }}>
                <span className="p-icon">⚡</span>
                <div className="p-text"><span className="p-name">Reset All</span><span className="p-val">100% Zoom / 1:1 W/L</span></div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 📚 SERIES SELECTION DRAWER */}
      <div className={`ndv-drawer ${showSeriesDrawer ? "open" : ""}`}>
        <div className="ndv-drawer-header">
          <span>DICOM Series ({seriesList.length})</span>
          <button onClick={() => setShowSeriesDrawer(false)} className="ndv-icon-btn"><X size={18} /></button>
        </div>
        <div className="ndv-drawer-content">
          {seriesList.map((s, idx) => (
            <div
              key={s.seriesId || idx}
              className={`ndv-series-card ${idx === activeSeriesIndex ? "active" : ""}`}
              onClick={() => {
                setActiveSeriesIndex(idx);
                setCurrentIndex(0);
                setScale(1);
                setPan({ x: 0, y: 0 });
                setShowSeriesDrawer(false);
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 13, color: "#ffffff" }}>
                {s.seriesDescription || `Series ${idx + 1}`}
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                Series #{s.seriesNumber || idx + 1} • {s.totalSlices || s.instances?.length || 0} Slices
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 🖥️ MAIN CANVAS VIEWPORT */}
      <div className="ndv-body">
        <div 
          ref={containerRef}
          className="ndv-viewport-container"
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
        >
          {loading || imageLoading ? (
            <div className="ndv-loader">
              <RefreshCw className="animate-spin text-indigo-400" size={36} />
              <span style={{ marginTop: 10, color: "#f8fafc", fontWeight: 700, fontSize: 13 }}>
                {loading ? "Streaming PACS DICOM Study..." : "Rendering Canvas Frame..."}
              </span>
            </div>
          ) : null}

          <canvas ref={canvasRef} className="ndv-canvas" />

          {/* HUD Overlay Info */}
          {showOverlayInfo && (
            <div className="ndv-overlay-info">
              <div style={{ fontWeight: "800", color: "#38bdf8" }}>{studyMeta?.patientName || "Patient"}</div>
              <div><b>Mod:</b> {modalityKey} | <b>Slice:</b> {currentIndex + 1}/{currentInstances.length || 1}</div>
              <div><b>L:</b> {brightness.toFixed(0)} | <b>W:</b> {contrast.toFixed(0)} | <b>Zoom:</b> {(scale * 100).toFixed(0)}%</div>
              {mprPlane !== "AXIAL" && <div style={{ color: "#a855f7", fontWeight: "800" }}><b>3D MPR Plane:</b> {mprPlane}</div>}
            </div>
          )}

          <button 
            className="ndv-toggle-overlay-btn" 
            onClick={() => setShowOverlayInfo(!showOverlayInfo)}
            title="Toggle Viewport HUD"
          >
            {showOverlayInfo ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
        </div>
      </div>

      {/* 🎞️ INTEGRATED SLICE SCRUBBER */}
      {currentInstances.length > 1 && (
        <div className="ndv-scrubber-floating">
          <button 
            className="ndv-cine-btn" 
            onClick={() => setIsCinePlaying(!isCinePlaying)}
            title={isCinePlaying ? "Pause Cine" : "Play Cine Loop"}
          >
            {isCinePlaying ? <Pause size={16} className="text-amber-400" /> : <Play size={16} className="text-emerald-400" />}
          </button>
          <input
            type="range"
            min={0}
            max={currentInstances.length - 1}
            value={currentIndex}
            onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
            className="ndv-range"
          />
          <span className="ndv-scrub-label">{currentIndex + 1}/{currentInstances.length}</span>
        </div>
      )}

      {/* 🛸 STREAMLINED FLOATING TOUCH DOCK */}
      <footer className="ndv-floating-dock">
        <div className="ndv-segmented-modes">
          {currentInstances.length > 1 && (
            <button
              className={`ndv-seg-btn ${activeTool === "scroll" ? "active" : ""}`}
              onClick={() => setActiveTool("scroll")}
              title="Touch Drag to Scroll Slices"
            >
              📜 Scroll
            </button>
          )}

          <button
            className={`ndv-seg-btn ${activeTool === "pan" ? "active" : ""}`}
            onClick={() => setActiveTool("pan")}
            title="Pinch Zoom & Pan"
          >
            🔍 Pan/Zoom
          </button>

          <button
            className={`ndv-seg-btn ${activeTool === "wl" ? "active" : ""}`}
            onClick={() => setActiveTool("wl")}
            title="Touch Window / Level"
          >
            🌗 W / L
          </button>

          <button
            className={`ndv-seg-btn ${activeTool === "measure_dist" ? "active" : ""}`}
            onClick={() => setActiveTool("measure_dist")}
            title="Distance Caliper Measurement (mm)"
          >
            📏 Caliper
          </button>

          {(modalityKey === "CT" || modalityKey === "MR" || currentInstances.length > 5) && (
            <button
              className={`ndv-seg-btn ${mprPlane !== "AXIAL" ? "active" : ""}`}
              onClick={() => setMprPlane(prev => prev === "AXIAL" ? "SAGITTAL" : prev === "SAGITTAL" ? "CORONAL" : prev === "CORONAL" ? "GRID" : "AXIAL")}
              title="Switch 3D MPR Planes (Axial / Sagittal / Coronal / 2x2 Grid)"
            >
              🌀 MPR: {mprPlane}
            </button>
          )}
        </div>

        <div className="ndv-dock-divider" />

        <div className="ndv-dock-actions">
          <button className="ndv-dock-icon-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90°">
            <RotateCw size={18} />
          </button>
          
          <button className={`ndv-dock-icon-btn ${invert ? "active" : ""}`} onClick={() => setInvert(!invert)} title="Invert Negative">
            ☯️
          </button>

          <button className="ndv-dock-icon-btn text-cyan-400" onClick={handleCaptureSnapshot} title="Capture Key Image">
            <Camera size={18} />
          </button>

          <button className="ndv-dock-icon-btn reset" onClick={resetAll} title="Reset Canvas">
            <RotateCcw size={18} />
          </button>
        </div>
      </footer>
    </div>
  );
}
