import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Sun, 
  Moon,
  Maximize,
  Sliders,
  Layers,
  FileText,
  RefreshCw,
  X,
  Play,
  Pause,
  Tag,
  Camera
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

  // Touch Swipe & Vertical Drag State
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const fetchStudyData = useCallback(async () => {
    if (!studyUID) return;
    setLoading(true);
    try {
      // 1. Ultra-fast Mobile Study API payload with ordered slice sorting
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

      // 2. Fallback to Series Instances API
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

  // Fetch DICOM Tags for current active instance
  const fetchInstanceTags = useCallback(async () => {
    if (!currentInstance?.id) return;
    setLoadingTags(true);
    try {
      const res = await api.get(`/api/pacs/instance-tags/${currentInstance.id}`).catch(() => null);
      if (res?.data?.success && res.data.tags) {
        setTagsData(res.data.tags);
      } else {
        // Fallback to study level tags
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

  // Cine Auto-Play Loop
  useEffect(() => {
    let timer = null;
    if (isPlaying && currentInstances.length > 1) {
      timer = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % currentInstances.length);
      }, 150); // ~6.6 FPS for smooth diagnostic review
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
    setBrightness(1);
    setContrast(1);
    setIsInverted(false);
    setRotation(0);
    setIsPlaying(false);
  };

  // Touch Drag Handlers (Swipe for Slice Scrubber, Vertical for W/L Brightness)
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchStartX.current - touchEndX;
    const diffY = touchStartY.current - touchEndY;

    // Horizontal Swipe -> Change Slice
    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 0) nextImage();
      else prevImage();
    }
    // Vertical Swipe -> Adjust Brightness / Contrast (Window/Level)
    else if (Math.abs(diffY) > 50 && Math.abs(diffY) > Math.abs(diffX)) {
      if (diffY > 0) {
        setBrightness(b => Math.min(2.2, parseFloat((b + 0.15).toFixed(2))));
      } else {
        setBrightness(b => Math.max(0.4, parseFloat((b - 0.15).toFixed(2))));
      }
    }
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

  return (
    <div className={`lite-viewer-container ${isDarkMode ? "dark" : "light"}`}>
      {/* Sleek Glassmorphism Header */}
      <header className="lite-viewer-header">
        <button className="icon-btn" onClick={() => navigate(-1)} title="Back">
          <ChevronLeft size={22} />
        </button>

        <div className="patient-banner" onClick={() => setShowSeriesDrawer(true)}>
          <span className="patient-title">
            {studyMeta?.patientName || "DICOM Mobile Viewer"}
          </span>
          <span className="patient-sub">
            <span className="badge-modality">{studyMeta?.modality || "CR"}</span> • {studyMeta?.patientId ? `ID: ${studyMeta.patientId}` : "Mobile Lite"} • Slice {currentIndex + 1}/{currentInstances.length}
          </span>
        </div>

        <div className="header-actions">
          <button className={`icon-btn ${showTagsModal ? "active-glow" : ""}`} onClick={() => setShowTagsModal(true)} title="DICOM Tags">
            <Tag size={20} />
          </button>
          <button className="icon-btn text-indigo-400" onClick={() => setShowSeriesDrawer(true)} title="Series Drawer">
            <Layers size={20} />
          </button>
          <button className="icon-btn text-emerald-400" onClick={() => navigate(`/report-editor?study=${studyUID}`)} title="Open Report Studio">
            <FileText size={20} />
          </button>
          <button className="icon-btn" onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>
      </header>

      {/* DICOM Tags Inspector Modal */}
      {showTagsModal && (
        <div className="tags-modal-backdrop" onClick={() => setShowTagsModal(false)}>
          <div className="tags-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="tags-modal-header">
              <div className="flex items-center gap-2">
                <Tag className="text-cyan-400" size={18} />
                <span className="font-bold text-white text-base">DICOM Tags Inspector</span>
              </div>
              <button className="close-btn" onClick={() => setShowTagsModal(false)}>
                <X size={18} />
              </button>
            </div>
            
            <div className="tags-modal-body scroll-y">
              {loadingTags ? (
                <div className="flex items-center justify-center p-8 gap-3 text-slate-300">
                  <RefreshCw className="animate-spin text-cyan-400" size={20} />
                  <span>Parsing DICOM Header Tags...</span>
                </div>
              ) : tagsData ? (
                <div className="tags-grid">
                  {Object.entries(tagsData).map(([key, val]) => (
                    <div key={key} className="tag-row">
                      <span className="tag-key">{key}</span>
                      <span className="tag-val">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center p-6 text-slate-400 text-sm">
                  No DICOM header tags could be extracted for instance {currentInstance?.id || "N/A"}.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Series Selection Drawer (Mobile Drawer) */}
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
                Series #{s.seriesNumber || (sIdx + 1)} • {s.totalSlices || s.instances?.length || 0} DICOM Slices
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Viewport & Touch Canvas */}
      <main 
        className="lite-viewer-main"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {loading ? (
          <div className="loader">
            <RefreshCw className="animate-spin text-indigo-500" size={32} />
            <span style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>Streaming DICOM Slices...</span>
          </div>
        ) : (
          <div className="viewport-wrapper" onWheel={(e) => setZoom(z => Math.max(0.5, Math.min(5, z + (e.deltaY < 0 ? 0.1 : -0.1))))}>
            {imageUrl ? (
              <img 
                src={imageUrl} 
                alt="DICOM Slice"
                className="main-image"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  filter: `brightness(${brightness}) contrast(${contrast}) ${isInverted ? "invert(1)" : ""}`,
                  transition: "transform 0.1s ease-out, filter 0.1s ease-out"
                }}
              />
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>No preview frame available for this slice.</div>
            )}

            {/* Diagnostic On-Screen Overlay */}
            <div className="overlay-info top-left">
              <div className="overlay-line font-bold">{studyMeta?.patientName}</div>
              <div className="overlay-line">{studyMeta?.patientId}</div>
              <div className="overlay-line">{studyMeta?.studyDescription || activeSeries?.seriesDescription}</div>
            </div>
            <div className="overlay-info top-right">
              <div className="overlay-line text-cyan-400 font-semibold">{activeSeries?.seriesDescription || "Series 1"}</div>
              <div className="overlay-line font-mono">Slice: {currentIndex + 1} / {currentInstances.length}</div>
            </div>
            <div className="overlay-info bottom-left">
              <div className="overlay-line">Zoom: {(zoom * 100).toFixed(0)}%</div>
              <div className="overlay-line">W/L: B{(brightness * 100).toFixed(0)} C{(contrast * 100).toFixed(0)}</div>
            </div>
          </div>
        )}
      </main>

      {/* Fast Slice Scrubber Slider Bar */}
      {currentInstances.length > 1 && (
        <div className="scrubber-bar">
          <button className="cine-btn" onClick={() => setIsPlaying(!isPlaying)} title={isPlaying ? "Pause Cine" : "Play Cine"}>
            {isPlaying ? <Pause size={18} className="text-amber-400" /> : <Play size={18} className="text-emerald-400" />}
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

      {/* Footer Quick Diagnostic Toolbar */}
      <footer className="lite-viewer-footer">
        <div className="tool-row scroll-x">
          <button className="tool-btn" onClick={prevImage} disabled={currentIndex === 0}>
            <ChevronLeft size={20} />
          </button>
          
          <div className="divider" />
          
          <button className="tool-btn" onClick={() => setZoom(z => Math.min(5, z + 0.25))} title="Zoom In">
            <ZoomIn size={20} />
          </button>
          <button className="tool-btn" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} title="Zoom Out">
            <ZoomOut size={20} />
          </button>
          <button className="tool-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate">
            <RotateCw size={20} />
          </button>
          
          <div className="divider" />
          
          <button className="tool-btn" onClick={() => setBrightness(b => b >= 1.8 ? 1 : b + 0.2)} title="Brightness (Vertical Drag)">
            <Sun size={20} />
          </button>
          <button className="tool-btn" onClick={() => setContrast(c => c >= 1.8 ? 1 : c + 0.2)} title="Contrast">
            <Maximize size={20} />
          </button>
          <button className={`tool-btn ${isInverted ? "active" : ""}`} onClick={() => setIsInverted(!isInverted)} title="Invert Colors">
            <Sliders size={20} />
          </button>
          
          <div className="divider" />

          <button className="tool-btn text-cyan-400" onClick={captureSnapshot} title="Capture Key Image">
            <Camera size={20} />
          </button>
          
          <button className="tool-btn reset" onClick={resetTools}>
            RESET
          </button>
          
          <div className="divider" />

          <button className="tool-btn" onClick={nextImage} disabled={currentIndex === currentInstances.length - 1}>
            <ChevronRight size={20} />
          </button>
        </div>
      </footer>
    </div>
  );
};

export default MobileLiteViewer;
