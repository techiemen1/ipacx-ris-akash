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
  X
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
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [isInverted, setIsInverted] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // Touch Swipe State
  const touchStartX = useRef(0);

  const fetchStudyData = useCallback(async () => {
    if (!studyUID) return;
    setLoading(true);
    try {
      // 1. Try ultra-fast Mobile Study API payload
      const res = await api.get(`/api/pacs/mobile-study/${encodeURIComponent(studyUID)}`).catch(() => null);
      if (res?.data?.success && Array.isArray(res.data.series) && res.data.series.length > 0) {
        setStudyMeta({
          patientName: res.data.patientName,
          patientId: res.data.patientId,
          accession: res.data.accession,
          modality: res.data.modality,
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
  };

  // Touch Swipe Handlers for Mobile Slice Scrubbing
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const diff = touchStartX.current - touchEndX;
    if (Math.abs(diff) > 40) {
      if (diff > 0) nextImage();
      else prevImage();
    }
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
      {/* Sleek Mobile Executive Header */}
      <header className="lite-viewer-header">
        <button className="icon-btn" onClick={() => navigate(-1)} title="Back">
          <ChevronLeft size={22} />
        </button>

        <div className="patient-banner" onClick={() => setShowSeriesDrawer(true)}>
          <span className="patient-title">
            {studyMeta?.patientName || "DICOM Mobile Viewer"}
          </span>
          <span className="patient-sub">
            {studyMeta?.modality || "CR"} • {studyMeta?.accession ? `Acc: ${studyMeta.accession}` : "Mobile Lite"} • Slice {currentIndex + 1}/{currentInstances.length}
          </span>
        </div>

        <div className="header-actions">
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

      {/* Series Selection Drawer (Mobile Drawer) */}
      <div className={`lite-instance-list ${showSeriesDrawer ? "open" : ""}`}>
        <div className="list-header">
          <span>DICOM Series ({seriesList.length})</span>
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
              <div style={{ fontWeight: "700" }}>{s.seriesDescription || `Series ${sIdx + 1}`}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{s.totalSlices || s.instances?.length || 0} DICOM Slices</div>
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
            <span style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>Streaming Mobile DICOM Slices...</span>
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
          </div>
        )}
      </main>

      {/* Fast Slice Scrubber Slider Bar */}
      {currentInstances.length > 1 && (
        <div className="scrubber-bar">
          <input 
            type="range"
            min={0}
            max={currentInstances.length - 1}
            value={currentIndex}
            onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
            className="scrubber-range"
          />
        </div>
      )}

      {/* Footer Quick Tools */}
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
          
          <button className="tool-btn" onClick={() => setBrightness(b => b >= 1.8 ? 1 : b + 0.2)} title="Brightness">
            <Sun size={20} />
          </button>
          <button className="tool-btn" onClick={() => setContrast(c => c >= 1.8 ? 1 : c + 0.2)} title="Contrast">
            <Maximize size={20} />
          </button>
          <button className={`tool-btn ${isInverted ? "active" : ""}`} onClick={() => setIsInverted(!isInverted)} title="Invert Colors">
            <Sliders size={20} />
          </button>
          
          <div className="divider" />
          
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
