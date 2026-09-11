import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { 
  ChevronLeft, 
  ChevronRight, 
  RotateCw, 
  Sun, 
  Moon,
  Layers,
  FileText,
  RefreshCw,
  X,
  Play,
  Pause,
  Tag,
  Camera,
  SlidersHorizontal,
  Eye,
  EyeOff,
  RotateCcw,
  Sparkles
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
  
  const [showSeriesDrawer, setShowSeriesDrawer] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);
  const [showOverlayInfo, setShowOverlayInfo] = useState(true);
  const [tagsData, setTagsData] = useState(null);
  const [loadingTags, setLoadingTags] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [isInverted, setIsInverted] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  // TOUCH GESTURE ENGINE STATE ("SCROLL" | "WL" | "PAN")
  const [touchMode, setTouchMode] = useState("PAN");
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [tagSearchText, setTagSearchText] = useState("");

  const initialPinchDist = useRef(null);
  const initialPinchZoom = useRef(1);
  const touchLastPos = useRef({ x: 0, y: 0 });
  const touchDeltaAccumulator = useRef({ x: 0, y: 0 });
  const lastTapTime = useRef(0);
  const isDragging = useRef(false);

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
        // Default touch mode: CR/DX -> PAN/ZOOM, CT/MR -> SCROLL
        const mod = String(res.data.modality || "").toUpperCase();
        if (mod === "CT" || mod === "MR") {
          setTouchMode("SCROLL");
        } else {
          setTouchMode("PAN");
        }
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
            previewUrl: inst.preview_url
          }))
        }));
        setSeriesList(formatted);
      }
    } catch (error) {
      console.error("Failed to load DICOM study for mobile viewer", error);
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

  const imageUrl = currentInstance 
    ? (currentInstance.previewUrl || `/api/pacs/instance-preview/${currentInstance.id}`)
    : "";

  const fetchInstanceTags = useCallback(async () => {
    if (!currentInstance?.id) return;
    setLoadingTags(true);
    try {
      const res = await api.get(`/api/pacs/instance-tags/${currentInstance.id}`).catch(() => null);
      if (res?.data?.success && res.data.tags) {
        setTagsData(res.data.tags);
      } else {
        const resStudy = await api.get(`/api/pacs/dicom-tags/${encodeURIComponent(studyUID)}`).catch(() => null);
        if (resStudy?.data?.data) {
          setTagsData(resStudy.data.data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch DICOM tags:", err);
    } finally {
      setLoadingTags(false);
    }
  }, [currentInstance?.id, studyUID]);

  useEffect(() => {
    if (showTagsModal) {
      fetchInstanceTags();
    }
  }, [showTagsModal, fetchInstanceTags]);

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
    setRotation(0);
    setIsPlaying(false);
  };

  // MULTI-TOUCH GESTURE ENGINE (PINCH TO ZOOM + TOUCH SLICE SCROLL + TOUCH W/L + PAN)
  const handleTouchStart = (e) => {
    isDragging.current = true;
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      resetTools();
    }
    lastTapTime.current = now;

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
    initialPinchDist.current = null;
    touchDeltaAccumulator.current = { x: 0, y: 0 };
  };

  const captureSnapshot = () => {
    if (!imageUrl) return;
    const snapshotObj = {
      id: currentInstance?.id || Date.now(),
      previewUrl: imageUrl,
      sliceNumber: currentIndex + 1,
      seriesDesc: activeSeries.seriesDescription || "Series",
      capturedAt: new Date().toISOString()
    };
    const saved = JSON.parse(localStorage.getItem("key_images") || "[]");
    localStorage.setItem("key_images", JSON.stringify([snapshotObj, ...saved]));
    alert(`📸 Key Image Captured (Slice ${currentIndex + 1})! Attached to Report Studio.`);
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
    <div className={`lite-viewer-container ${isDarkMode ? "dark" : "light"}`}>
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
            className={`icon-btn-glass ${showTagsModal ? "active-glow" : ""}`} 
            onClick={() => setShowTagsModal(true)} 
            title="DICOM Tags Inspector"
          >
            <Tag size={18} />
          </button>

          <button 
            className="icon-btn-glass action-report" 
            onClick={() => navigate(`/report-editor?study=${studyUID}`)} 
            title="Open Radiology Report Editor"
          >
            <FileText size={18} />
          </button>

          <button className="icon-btn-glass" onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
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
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.0); setContrast(1.15); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🟢</span>
                    <div className="p-text"><span className="p-name">Soft Tissue</span><span className="p-val">W:400 L:50</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.7); setContrast(2.2); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🦴</span>
                    <div className="p-text"><span className="p-name">Bone Window</span><span className="p-val">W:2000 L:500</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.45); setContrast(1.8); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🫁</span>
                    <div className="p-text"><span className="p-name">Lung Window</span><span className="p-val">W:1500 L:-600</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.95); setContrast(1.4); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🧠</span>
                    <div className="p-text"><span className="p-name">Brain Window</span><span className="p-val">W:80 L:40</span></div>
                  </button>
                </>
              ) : modalityKey === "MR" ? (
                <>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.0); setContrast(1.2); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🧠</span>
                    <div className="p-text"><span className="p-name">T1/T2 Brain</span><span className="p-val">Neuro Detail</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.9); setContrast(1.65); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🦴</span>
                    <div className="p-text"><span className="p-name">Spine / Joint</span><span className="p-val">MSK High Contrast</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.15); setContrast(1.7); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🩸</span>
                    <div className="p-text"><span className="p-name">Contrast Enhanced</span><span className="p-val">Vascular Detail</span></div>
                  </button>
                </>
              ) : modalityKey === "US" ? (
                <>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.9); setContrast(1.5); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🌊</span>
                    <div className="p-text"><span className="p-name">High Contrast</span><span className="p-val">Ultrasound Gray</span></div>
                  </button>
                </>
              ) : (
                <>
                  {/* CR / DX Radiography Presets */}
                  <button className="preset-card-btn" onClick={() => { setBrightness(1.05); setContrast(1.25); setShowPresetsMenu(false); }}>
                    <span className="p-icon">🫁</span>
                    <div className="p-text"><span className="p-name">Chest Radiograph</span><span className="p-val">Soft Tissue PA</span></div>
                  </button>
                  <button className="preset-card-btn" onClick={() => { setBrightness(0.85); setContrast(1.85); setShowPresetsMenu(false); }}>
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

      {/* 🏷️ DICOM TAGS INSPECTOR MODAL */}
      {showTagsModal && (
        <div className="tags-modal-backdrop" onClick={() => setShowTagsModal(false)}>
          <div className="tags-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tags-modal-header">
              <div className="flex items-center gap-2">
                <Tag className="text-cyan-400" size={18} />
                <span className="font-bold text-white text-base">DICOM Tags Header</span>
              </div>
              <button className="close-btn" onClick={() => setShowTagsModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="tags-modal-search">
              <input
                type="text"
                placeholder="Search DICOM attribute or tag..."
                value={tagSearchText}
                onChange={(e) => setTagSearchText(e.target.value)}
                className="tags-search-input"
              />
            </div>
            
            <div className="tags-modal-body scroll-y">
              {loadingTags ? (
                <div className="flex items-center justify-center p-8 gap-3 text-slate-300">
                  <RefreshCw className="animate-spin text-cyan-400" size={20} />
                  <span>Parsing DICOM Header Tags...</span>
                </div>
              ) : tagsData ? (
                <div className="tags-grid">
                  {Object.entries(tagsData)
                    .filter(([k, v]) => {
                      if (!tagSearchText) return true;
                      const q = tagSearchText.toLowerCase();
                      return String(k).toLowerCase().includes(q) || String(v).toLowerCase().includes(q);
                    })
                    .map(([key, val]) => (
                      <div key={key} className="tag-row">
                        <span className="tag-key">{key}</span>
                        <span className="tag-val">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center p-6 text-slate-400 text-sm">
                  No DICOM header tags available for this instance.
                </div>
              )}
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
              <img 
                src={imageUrl} 
                alt="DICOM Slice"
                className="main-image"
                style={{
                  transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                  filter: `brightness(${brightness}) contrast(${contrast}) ${isInverted ? "invert(1)" : ""}`,
                  transition: isDragging.current ? "none" : "transform 0.08s ease-out, filter 0.08s ease-out"
                }}
              />
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No preview frame available for this instance.</div>
            )}

            {/* 💬 Live Touch Mode Gesture Feedback Pill */}
            <div className="gesture-feedback-pill">
              {touchMode === "SCROLL" && <span>📜 Drag ↕ to Scroll • Slice {currentIndex + 1}/{currentInstances.length}</span>}
              {touchMode === "WL" && <span>🌗 Touch W/L • B: {(brightness * 100).toFixed(0)}% | C: {(contrast * 100).toFixed(0)}%</span>}
              {touchMode === "PAN" && <span>🔍 Pinch & Pan • Zoom: {(zoom * 100).toFixed(0)}%</span>}
            </div>

            {/* 🎯 Toggleable Corner DICOM Overlay Info */}
            {showOverlayInfo && (
              <>
                <div className="overlay-info top-left">
                  <div className="overlay-line font-bold text-cyan-300">{studyMeta?.patientName || "Patient"}</div>
                  <div className="overlay-line text-slate-300">ID: {studyMeta?.patientId || "PACS Direct"}</div>
                  <div className="overlay-line text-slate-400">{studyMeta?.studyDescription || activeSeries?.seriesDescription || "DICOM Study"}</div>
                </div>

                <div className="overlay-info top-right">
                  <div className="overlay-line text-amber-300 font-semibold">[{modalityKey}] {studyMeta?.studyDate || ""}</div>
                  <div className="overlay-line text-slate-300">Acc: {studyMeta?.accession || "N/A"}</div>
                  <div className="overlay-line text-cyan-400 font-mono">Slice: {currentIndex + 1} / {currentInstances.length}</div>
                </div>

                <div className="overlay-info bottom-left">
                  <div className="overlay-line text-indigo-300">Zoom: {(zoom * 100).toFixed(0)}%</div>
                  <div className="overlay-line text-slate-300">Pan: {panPosition.x.toFixed(0)}, {panPosition.y.toFixed(0)}</div>
                </div>

                <div className="overlay-info bottom-right">
                  <div className="overlay-line text-emerald-300 font-mono">W: {(contrast * 400).toFixed(0)} L: {(brightness * 40).toFixed(0)}</div>
                  <div className="overlay-line text-slate-300">Rot: {rotation}°</div>
                </div>
              </>
            )}

            {/* Toggle Overlay Eye Button */}
            <button 
              className="toggle-overlay-btn"
              onClick={() => setShowOverlayInfo(!showOverlayInfo)}
              title="Toggle DICOM Overlays"
            >
              {showOverlayInfo ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>
        )}
      </main>

      {/* 🎞️ INTEGRATED SLICE SCRUBBER (Only rendered when > 1 slice) */}
      {currentInstances.length > 1 && (
        <div className="scrubber-floating-bar">
          <button className="cine-btn" onClick={() => setIsPlaying(!isPlaying)} title={isPlaying ? "Pause Cine" : "Play Cine"}>
            {isPlaying ? <Pause size={16} className="text-amber-400" /> : <Play size={16} className="text-emerald-400" />}
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
        </div>

        <div className="dock-divider" />

        {/* Essential Action Buttons */}
        <div className="dock-actions">
          <button className="dock-icon-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90°">
            <RotateCw size={18} />
          </button>
          
          <button className={`dock-icon-btn ${isInverted ? "active" : ""}`} onClick={() => setIsInverted(!isInverted)} title="Invert Colors">
            ☯️
          </button>

          <button className="dock-icon-btn text-cyan-400" onClick={captureSnapshot} title="Capture Key Image">
            <Camera size={18} />
          </button>

          <button className="dock-icon-btn reset" onClick={resetTools} title="Reset Canvas">
            <RotateCcw size={18} />
          </button>
        </div>
      </footer>
    </div>
  );
};

export default MobileLiteViewer;
