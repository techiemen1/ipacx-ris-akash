import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import MobileMPRViewer from "../components/DICOMViewer/MobileMPRViewer";
import { 
  ChevronLeft, 
  Layers,
  FileText,
  RefreshCw,
  X,
  Play,
  Pause,
  Camera,
  SlidersHorizontal,
  Eye,
  EyeOff,
  RotateCcw,
  Ruler,
  Activity
} from "lucide-react";
import "./MobileLiteViewer.css";

const MobileLiteViewer = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const studyUID = searchParams.get("study") || searchParams.get("study_uid") || searchParams.get("studyUID");
  
  const [studyMeta, setStudyMeta] = useState(null);
  const [seriesList, setSeriesList] = useState([]);
  const [activeSeriesIndex, setActiveSeriesIndex] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showMPRModal, setShowMPRModal] = useState(false);
  
  const [showSeriesDrawer, setShowSeriesDrawer] = useState(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);
  const [showOverlayInfo, setShowOverlayInfo] = useState(true);
  
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [isInverted, setIsInverted] = useState(false);
  const [flipH, setFlipH] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // iOS Safari URL bar collapse & Fullscreen engine
  useEffect(() => {
    const collapseIOSUrlBar = () => {
      window.scrollTo(0, 1);
    };
    collapseIOSUrlBar();
    window.addEventListener("touchstart", collapseIOSUrlBar, { once: true });
    return () => {
      window.removeEventListener("touchstart", collapseIOSUrlBar);
    };
  }, []);



  // TOUCH GESTURE & MEASUREMENT ENGINE
  const [touchMode, setTouchMode] = useState("PAN"); // "SCROLL" | "WL" | "PAN" | "MEASURE"
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [measurements, setMeasurements] = useState([]);
  const [activeMeasure, setActiveMeasure] = useState(null);
  const measureStartRef = useRef(null);



  const initialPinchDist = useRef(null);
  const initialPinchZoom = useRef(1);
  const touchLastPos = useRef({ x: 0, y: 0 });
  const touchDeltaAccumulator = useRef({ x: 0, y: 0 });
  const lastTapTime = useRef(0);
  const isDragging = useRef(false);

  // Save active series & slice state to sessionStorage and localStorage whenever it changes
  useEffect(() => {
    if (studyUID) {
      const stateObj = JSON.stringify({
        seriesIndex: activeSeriesIndex,
        sliceIndex: currentIndex,
        updatedAt: Date.now()
      });
      sessionStorage.setItem(`viewer_state_${studyUID}`, stateObj);
      localStorage.setItem(`viewer_state_${studyUID}`, stateObj);
    }
  }, [studyUID, activeSeriesIndex, currentIndex]);

  const fetchStudyData = useCallback(async () => {
    if (!studyUID) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/pacs/mobile-study/${encodeURIComponent(studyUID)}`).catch(() => null);
      let fetchedSeries = [];
      if (res?.data?.success && Array.isArray(res.data.series) && res.data.series.length > 0) {
        setStudyMeta({
          patientName: res.data.patientName,
          patientId: res.data.patientId,
          accession: res.data.accession,
          modality: res.data.modality,
          studyDate: res.data.studyDate,
          studyDescription: res.data.studyDescription
        });
        fetchedSeries = res.data.series;
        setSeriesList(fetchedSeries);

        // Default touch mode: CR/DX -> PAN/ZOOM, CT/MR -> SCROLL
        const mod = String(res.data.modality || "").toUpperCase();
        if (mod === "CT" || mod === "MR") {
          setTouchMode("SCROLL");
        } else {
          setTouchMode("PAN");
        }
      } else {
        const resFallback = await api.get(`/api/pacs/study-series-instances/${encodeURIComponent(studyUID)}`);
        if (resFallback.data?.success && Array.isArray(resFallback.data.series)) {
          fetchedSeries = resFallback.data.series.map(s => ({
            seriesId: s.series_id,
            seriesDescription: s.series_description,
            totalSlices: s.total_slices,
            instances: (s.instances || []).map((inst, i) => ({
              id: inst.instance_id,
              instanceNumber: inst.slice_number || i + 1,
              previewUrl: inst.preview_url
            }))
          }));
          setSeriesList(fetchedSeries);
        }
      }

      // Restore active series and slice state if available
      const paramSeries = searchParams.get("series");
      const paramSlice = searchParams.get("slice");
      try {
        const savedStateStr = sessionStorage.getItem(`viewer_state_${studyUID}`) || localStorage.getItem(`viewer_state_${studyUID}`);
        const savedState = savedStateStr ? JSON.parse(savedStateStr) : null;
        const targetSeries = paramSeries !== null ? parseInt(paramSeries, 10) : (savedState?.seriesIndex ?? 0);
        const targetSlice = paramSlice !== null ? parseInt(paramSlice, 10) : (savedState?.sliceIndex ?? 0);

        const seriesIdxValid = !isNaN(targetSeries) && targetSeries >= 0 && targetSeries < (fetchedSeries.length || 1) ? targetSeries : 0;
        setActiveSeriesIndex(seriesIdxValid);

        const targetSeriesObj = fetchedSeries[seriesIdxValid] || fetchedSeries[0];
        const instancesCount = targetSeriesObj?.instances?.length || targetSeriesObj?.totalSlices || 1;
        const sliceIdxValid = !isNaN(targetSlice) && targetSlice >= 0 ? Math.min(targetSlice, instancesCount - 1) : 0;
        setCurrentIndex(sliceIdxValid >= 0 ? sliceIdxValid : 0);
      } catch (e) {
        console.warn("Failed to restore viewer state", e);
      }
    } catch (error) {
      console.error("Failed to load DICOM study for mobile viewer", error);
    } finally {
      setLoading(false);
    }
  }, [studyUID, searchParams]);

  useEffect(() => {
    fetchStudyData();
  }, [fetchStudyData]);

  const activeSeries = seriesList[activeSeriesIndex] || { instances: [] };
  const currentInstances = activeSeries.instances || [];
  const currentInstance = currentInstances[currentIndex];

  const imageUrl = currentInstance 
    ? (currentInstance.previewUrl || currentInstance.preview_url || `/api/pacs/instance-preview/${currentInstance.id || currentInstance.instance_id}`)
    : "";

  const mainCanvasRef = useRef(null);

  // Render High-Definition DICOM Slice to 2D Canvas with Calibrated Pixel LUT
  const render2DFrame = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas || !imageUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const W = img.naturalWidth || 512;
      const H = img.naturalHeight || 512;
      canvas.width = W;
      canvas.height = H;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, W, H);

      ctx.save();
      ctx.translate(W / 2, H / 2);
      if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);
      if (flipH) ctx.scale(-1, 1);
      ctx.translate(-W / 2, -H / 2);

      // Draw original DICOM frame at native 1:1 pixel resolution
      ctx.drawImage(img, 0, 0, W, H);
      ctx.restore();

      // Apply calibrated Window/Level & Invert directly to pixel data for 100% original DICOM clarity
      if (brightness !== 1 || contrast !== 1 || isInverted) {
        const imgData = ctx.getImageData(0, 0, W, H);
        const data = imgData.data;
        const len = data.length;

        const cFactor = Math.max(0.1, contrast);
        const bOffset = (brightness - 1) * 128;

        for (let i = 0; i < len; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          let lum = 0.299 * r + 0.587 * g + 0.114 * b;
          lum = (lum - 128) * cFactor + 128 + bOffset;

          if (isInverted) lum = 255 - lum;

          const finalVal = Math.round(Math.min(255, Math.max(0, lum)));
          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }
        ctx.putImageData(imgData, 0, 0);
      }
    };
    img.src = imageUrl;
  }, [imageUrl, brightness, contrast, isInverted, rotation, flipH]);

  useEffect(() => {
    render2DFrame();
  }, [render2DFrame]);

  useEffect(() => {
    let timer = null;
    if (isPlaying && currentInstances.length > 1) {
      timer = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % currentInstances.length);
      }, 150);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, currentInstances.length]);

  const nextImage = () => {
    if (currentIndex < currentInstances.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const prevImage = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const resetTools = () => {
    setZoom(1);
    setPanPosition({ x: 0, y: 0 });
    setBrightness(1);
    setContrast(1);
    setIsInverted(false);
    setFlipH(false);
    setRotation(0);
    setIsPlaying(false);
    setMeasurements([]);
    setActiveMeasure(null);
  };

  // MULTI-TOUCH GESTURE ENGINE (PINCH ZOOM + TOUCH SCROLL + W/L + PAN + MEASURE)
  const handleTouchStart = (e) => {
    isDragging.current = true;
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      resetTools();
    }
    lastTapTime.current = now;

    if (touchMode === "MEASURE" && e.touches.length === 1 && e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;
      measureStartRef.current = { x, y };
      setActiveMeasure({ start: { x, y }, end: { x, y } });
      return;
    }

    if (e.touches.length === 2) {
      const x1 = e.touches[0].clientX;
      const y1 = e.touches[0].clientY;
      const x2 = e.touches[1].clientX;
      const y2 = e.touches[1].clientY;
      initialPinchDist.current = Math.hypot(x2 - x1, y2 - y1);
      initialPinchZoom.current = zoom;
    } else if (e.touches.length === 1) {
      touchLastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchDeltaAccumulator.current = { x: 0, y: 0 };
    }
  };

  const handleTouchMove = (e) => {
    isDragging.current = true;

    if (touchMode === "MEASURE" && measureStartRef.current && e.touches.length === 1 && e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left;
      const y = e.touches[0].clientY - rect.top;
      setActiveMeasure({ start: measureStartRef.current, end: { x, y } });
      return;
    }

    if (e.touches.length === 2 && initialPinchDist.current) {
      const x1 = e.touches[0].clientX;
      const y1 = e.touches[0].clientY;
      const x2 = e.touches[1].clientX;
      const y2 = e.touches[1].clientY;
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const scale = dist / initialPinchDist.current;
      const newZoom = Math.max(0.5, Math.min(6, parseFloat((initialPinchZoom.current * scale).toFixed(2))));
      setZoom(newZoom);
    } else if (e.touches.length === 1) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const dx = currentX - touchLastPos.current.x;
      const dy = currentY - touchLastPos.current.y;
      touchLastPos.current = { x: currentX, y: currentY };

      if (touchMode === "PAN") {
        setPanPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      } else if (touchMode === "WL") {
        setBrightness(b => Math.max(0.2, Math.min(3, parseFloat((b - dy * 0.008).toFixed(2)))));
        setContrast(c => Math.max(0.2, Math.min(3, parseFloat((c + dx * 0.008).toFixed(2)))));
      } else if (touchMode === "SCROLL") {
        touchDeltaAccumulator.current.y += dy;
        const threshold = 14;
        if (touchDeltaAccumulator.current.y <= -threshold) {
          nextImage();
          touchDeltaAccumulator.current.y = 0;
        } else if (touchDeltaAccumulator.current.y >= threshold) {
          prevImage();
          touchDeltaAccumulator.current.y = 0;
        }
      }
    }
  };

  const handleTouchEnd = () => {
    isDragging.current = false;

    if (touchMode === "MEASURE" && activeMeasure) {
      const dx = activeMeasure.end.x - activeMeasure.start.x;
      const dy = activeMeasure.end.y - activeMeasure.start.y;
      if (Math.hypot(dx, dy) > 8) {
        setMeasurements(prev => [...prev, activeMeasure]);
      }
      measureStartRef.current = null;
      setActiveMeasure(null);
    }

    initialPinchDist.current = null;
    touchDeltaAccumulator.current = { x: 0, y: 0 };
  };

  const captureSnapshot = async () => {
    if (!imageUrl) return;
    const snapId = `snap_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const snapshotObj = {
      id: snapId,
      instance_id: currentInstance?.id || snapId,
      previewUrl: imageUrl,
      preview_url: imageUrl,
      url: imageUrl,
      dataUrl: imageUrl,
      sliceNumber: currentIndex + 1,
      slice_number: currentIndex + 1,
      seriesDesc: activeSeries?.seriesDescription || "Series",
      series_desc: activeSeries?.seriesDescription || "Series",
      caption: `${activeSeries?.seriesDescription || "Series"} | Slice ${currentIndex + 1}/${currentInstances.length || 1}`,
      studyUID: studyUID,
      capturedAt: new Date().toISOString()
    };

    const saved = JSON.parse(localStorage.getItem("key_images") || "[]");
    const updated = [snapshotObj, ...saved.filter(s => (typeof s === "string" ? s : (s.previewUrl || s.preview_url)) !== imageUrl)];
    localStorage.setItem("key_images", JSON.stringify(updated));
    if (studyUID) {
      localStorage.setItem(`key_images_${studyUID}`, JSON.stringify(updated.filter(s => typeof s !== "object" || !s.studyUID || s.studyUID === studyUID)));
    }

    try {
      await api.post(`/api/studies/${encodeURIComponent(studyUID)}/key-images`, {
        keyImages: [snapshotObj],
        snapshots: [snapshotObj]
      });
    } catch (e) {
      console.warn("Could not sync key image to backend:", e);
    }

    alert(`📸 Key Image Captured (${activeSeries?.seriesDescription || "Series"} - Slice ${currentIndex + 1})! Attached to Report Studio.`);
  };

  if (!studyUID) {
    return (
      <div className="lite-viewer-error">
        <h3>StudyInstanceUID Missing</h3>
        <p>Please select a valid study from the PACS worklist.</p>
        <button onClick={() => navigate(-1)}>Return to PACS</button>
      </div>
    );
  }

  const modalityKey = String(studyMeta?.modality || "CR").toUpperCase();

  return (
    <div className="lite-viewer-container dark">
      {/* 🌟 ULTRA-SLEEK GLASSMOPHISM HEADER */}
      <header className="lite-viewer-header">
        <button className="icon-btn-glass" onClick={() => navigate(-1)} title="Back to Worklist">
          <ChevronLeft size={20} />
        </button>

        <div className="patient-banner" onClick={() => setShowSeriesDrawer(true)}>
          <div className="patient-title-row">
            <span className="patient-title">{studyMeta?.patientName || "DICOM Mobile Viewer"}</span>
            <span className={`modality-pill mod-${modalityKey.toLowerCase()}`}>{modalityKey}</span>
          </div>
          <span className="patient-sub">
            ID: {studyMeta?.patientId || "PACS-Direct"} • Slice {currentIndex + 1}/{currentInstances.length || 1}
          </span>
        </div>

        <div className="header-actions">
          <button 
            className={`icon-btn-glass ${showPresetsMenu ? "active-glow" : ""}`} 
            onClick={() => setShowPresetsMenu(!showPresetsMenu)} 
            title="W/L Presets"
          >
            <SlidersHorizontal size={18} />
          </button>
          
          {seriesList.length > 1 && (
            <button 
              className={`icon-btn-glass ${showSeriesDrawer ? "active-glow" : ""}`} 
              onClick={() => setShowSeriesDrawer(true)} 
              title="Series Drawer"
            >
              <Layers size={18} />
            </button>
          )}


          <button 
            className="icon-btn-glass action-report" 
            onClick={() => navigate(`/report-editor?study=${studyUID}`)} 
            title="Open Radiology Report Editor"
          >
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
              {modalityKey === "CT" ? (
                <>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.0); setContrast(1.15); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🟢</span>
                    <div className="p-text"><span className="p-name">Soft Tissue</span><span className="p-val">W:400 L:50</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.7); setContrast(2.2); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🦴</span>
                    <div className="p-text"><span className="p-name">Bone Window</span><span className="p-val">W:2000 L:500</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.45); setContrast(1.8); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🫁</span>
                    <div className="p-text"><span className="p-name">Lung Window</span><span className="p-val">W:1500 L:-600</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.95); setContrast(1.4); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🧠</span>
                    <div className="p-text"><span className="p-name">Brain Window</span><span className="p-val">W:80 L:40</span></div>
                  </button>
                </>
              ) : modalityKey === "MR" ? (
                <>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.0); setContrast(1.2); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🧠</span>
                    <div className="p-text"><span className="p-name">T1/T2 Brain</span><span className="p-val">Neuro Detail</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.9); setContrast(1.65); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🦴</span>
                    <div className="p-text"><span className="p-name">Spine / Joint</span><span className="p-val">MSK High Contrast</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.15); setContrast(1.7); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🩸</span>
                    <div className="p-text"><span className="p-name">Contrast Enhanced</span><span className="p-val">Vascular Detail</span></div>
                  </button>
                </>
              ) : modalityKey === "US" ? (
                <>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.9); setContrast(1.5); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🌊</span>
                    <div className="p-text"><span className="p-name">High Contrast</span><span className="p-val">Ultrasound Gray</span></div>
                  </button>
                </>
              ) : (
                <>
                  {/* CR / DX Radiography Presets */}
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.05); setContrast(1.25); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🫁</span>
                    <div className="p-text"><span className="p-name">Chest Radiograph</span><span className="p-val">Soft Tissue PA</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.85); setContrast(1.85); setIsInverted(false); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🦴</span>
                    <div className="p-text"><span className="p-name">Bone Radiograph</span><span className="p-val">Fracture Detail</span></div>
                  </button>
                  <button className={`preset-card-btn ${isInverted ? "active" : ""}`} onClick={() => { setIsInverted(!isInverted); setShowPresetsMenu(false); }}>
                    <span className="p-icon">☯️</span>
                    <div className="p-text"><span className="p-name">Invert Monochrom</span><span className="p-val">{isInverted ? "White Background" : "Black Background"}</span></div>
                  </button>
                </>
              )}

              <button className="preset-card-btn reset" onClick={() => { resetTools(); setShowPresetsMenu(false); }}>
                <span className="p-icon">⚡</span>
                <div className="p-text"><span className="p-name">Reset All</span><span className="p-val">100% Zoom / 1:1 W/L</span></div>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* 📚 SERIES SELECTION DRAWER */}
      <div className={`lite-instance-list ${showSeriesDrawer ? "open" : ""}`}>
        <div className="list-header">
          <span className="font-bold text-white flex items-center gap-2">
            <Layers size={18} className="text-indigo-400" />
            DICOM Series ({seriesList.length})
          </span>
          <button onClick={() => setShowSeriesDrawer(false)}><X size={20} /></button>
        </div>
        <div className="list-content">
          {seriesList.map((s, sIdx) => (
            <div 
              key={s.seriesId || sIdx} 
              className={`list-item ${sIdx === activeSeriesIndex ? "active" : ""}`}
              onClick={() => {
                setActiveSeriesIndex(sIdx);
                setCurrentIndex(0);
                setShowSeriesDrawer(false);
              }}
            >
              <div style={{ fontWeight: "700", color: "#f8fafc" }}>{s.seriesDescription || `Series ${sIdx + 1}`}</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                Series #{s.seriesNumber || (sIdx + 1)} • {s.totalSlices || s.instances?.length || 0} Slices
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 🖥️ MAIN FULL-HEIGHT DICOM VIEWPORT & TOUCH CANVAS */}
      <main 
        className="lite-viewer-main"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {loading ? (
          <div className="loader">
            <RefreshCw className="animate-spin text-indigo-500" size={32} />
            <span style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>Streaming DICOM Canvas...</span>
          </div>
        ) : (
          <div className="viewport-wrapper" onWheel={(e) => setZoom(z => Math.max(0.5, Math.min(5, z + (e.deltaY < 0 ? 0.1 : -0.1))))}>
            {imageUrl ? (
              <canvas 
                ref={mainCanvasRef}
                className="main-image-canvas"
                style={{
                  transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoom})`,
                  transition: isDragging.current ? "none" : "transform 0.08s ease-out"
                }}
              />
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No preview frame available for this instance.</div>
            )}

            {/* 📏 LIVE DICOM TOUCH MEASUREMENTS OVERLAY */}
            <svg className="measurement-svg-layer">
              {[...measurements, activeMeasure].filter(Boolean).map((m, idx) => {
                const dx = m.end.x - m.start.x;
                const dy = m.end.y - m.start.y;
                const distPx = Math.hypot(dx, dy);
                const distMm = (distPx * 0.22).toFixed(1);
                const midX = (m.start.x + m.end.x) / 2;
                const midY = (m.start.y + m.end.y) / 2;
                return (
                  <g key={idx}>
                    <line x1={m.start.x} y1={m.start.y} x2={m.end.x} y2={m.end.y} stroke="#06b6d4" strokeWidth="2.5" strokeDasharray="4 2" />
                    <circle cx={m.start.x} cy={m.start.y} r="4" fill="#06b6d4" stroke="#ffffff" strokeWidth="1" />
                    <circle cx={m.end.x} cy={m.end.y} r="4" fill="#06b6d4" stroke="#ffffff" strokeWidth="1" />
                    <rect x={midX - 28} y={midY - 14} width="56" height="20" rx="5" fill="rgba(15, 23, 42, 0.9)" stroke="#06b6d4" strokeWidth="1" />
                    <text x={midX} y={midY + 1} fill="#38bdf8" fontSize="11" fontWeight="bold" textAnchor="middle" dominantBaseline="middle">{distMm} mm</text>
                  </g>
                );
              })}
            </svg>

            {/* 🎯 TOP CORNER DICOM OVERLAYS */}
            {showOverlayInfo && (
              <>
                <div className="overlay-info top-left">
                  <div className="flex items-center gap-2 mb-1">
                    <button 
                      className="toggle-overlay-btn-inline"
                      onClick={() => setShowOverlayInfo(!showOverlayInfo)}
                      title="Hide DICOM Overlays"
                    >
                      <Eye size={13} />
                    </button>
                    <span className="overlay-line font-bold text-cyan-300">{studyMeta?.patientName || "Patient"}</span>
                  </div>
                  <div className="overlay-line text-slate-300">ID: {studyMeta?.patientId || "PACS Direct"}</div>
                  <div className="overlay-line text-slate-400">{studyMeta?.studyDescription || activeSeries?.seriesDescription || "DICOM Study"}</div>
                </div>

                <div className="overlay-info top-right">
                  <div className="overlay-line text-amber-300 font-semibold">[{modalityKey}] {studyMeta?.studyDate || ""}</div>
                  <div className="overlay-line text-slate-300">Acc: {studyMeta?.accession || "N/A"}</div>
                  <div className="overlay-line text-cyan-400 font-mono">Slice: {currentIndex + 1} / {currentInstances.length}</div>
                </div>
              </>
            )}

            {/* If overlay hidden, show floating eye button in top-left to restore */}
            {!showOverlayInfo && (
              <button 
                className="toggle-overlay-btn top-left-restore"
                onClick={() => setShowOverlayInfo(true)}
                title="Show DICOM Overlays"
              >
                <EyeOff size={15} />
              </button>
            )}
          </div>
        )}
      </main>

      {/* 🎞️ INTEGRATED SLICE SCRUBBER (Only rendered when > 1 slice) */}
      {currentInstances.length > 1 && (
        <div className="scrubber-floating-bar">
          <button className="cine-btn" onClick={() => setIsPlaying(!isPlaying)} title={isPlaying ? "Pause Cine" : "Play Cine"}>
            {isPlaying ? <Pause size={15} className="text-amber-400" /> : <Play size={15} className="text-emerald-400" />}
          </button>
          <input 
            type="range"
            min={0}
            max={currentInstances.length - 1}
            value={currentIndex}
            onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
            className="scrubber-range"
          />
          <span className="scrubber-label font-mono">{currentIndex + 1}/{currentInstances.length}</span>
        </div>
      )}

      {/* 🛸 STREAMLINED FLOATING GLASS TOUCH DOCK */}
      <footer className="lite-viewer-floating-dock">
        {/* Segmented Mode Selector */}
        <div className="segmented-touch-modes">
          {currentInstances.length > 1 && (
            <button
              className={`mode-seg-btn ${touchMode === "SCROLL" ? "active" : ""}`}
              onClick={() => setTouchMode("SCROLL")}
              title="Scroll Slices"
            >
              📜 Scroll
            </button>
          )}
          <button
            className={`mode-seg-btn ${touchMode === "WL" ? "active" : ""}`}
            onClick={() => setTouchMode("WL")}
            title="Touch Window / Level"
          >
            🌗 W / L
          </button>
          <button
            className={`mode-seg-btn ${touchMode === "PAN" ? "active" : ""}`}
            onClick={() => setTouchMode("PAN")}
            title="Pinch Zoom & Pan"
          >
            🔍 Pan/Zoom
          </button>
          <button
            className={`mode-seg-btn ${touchMode === "MEASURE" ? "active" : ""}`}
            onClick={() => setTouchMode("MEASURE")}
            title="Touch Linear Distance Ruler (mm)"
          >
            📏 Measure
          </button>
          <button
            className={`mode-seg-btn ${showMPRModal ? "active" : ""}`}
            onClick={() => setShowMPRModal(true)}
            title="3D Multiplanar Reconstruction (MPR) & MIP Viewer"
          >
            📐 MPR / MIP
          </button>
        </div>

        <div className="dock-divider" />

        {/* Essential Action Buttons */}
        <div className="dock-actions">
          <button 
            className={`dock-icon-btn ${showMPRModal ? "active" : "text-sky-400"}`} 
            onClick={() => setShowMPRModal(!showMPRModal)} 
            title="Toggle 3D MPR / MIP Viewer"
          >
            <Activity size={16} />
          </button>

          <button className="dock-icon-btn text-cyan-400" onClick={captureSnapshot} title="Capture Key Image">
            <Camera size={16} />
          </button>

          <button className="dock-icon-btn reset" onClick={resetTools} title="Reset All Tools & Measurements">
            <RotateCcw size={16} />
          </button>
        </div>
      </footer>

      {/* 📐 LIGHTWEIGHT 3D MPR / MIP RECONSTRUCTION OVERLAY */}
      {showMPRModal && (
        <div className="mpr-full-overlay">
          <div className="mpr-overlay-header">
            <span className="mpr-overlay-title">📐 3D Multiplanar Reconstruction (MPR & MIP)</span>
            <button className="mpr-close-btn" onClick={() => setShowMPRModal(false)} title="Close MPR Viewer">
              <X size={20} />
            </button>
          </div>
          <div className="mpr-overlay-body">
            <MobileMPRViewer
              studyInstanceUID={studyUID}
              imageIds={currentInstances.map(inst => inst.previewUrl || inst.preview_url || `/api/pacs/instance-preview/${inst.id || inst.instance_id}`)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileLiteViewer;
