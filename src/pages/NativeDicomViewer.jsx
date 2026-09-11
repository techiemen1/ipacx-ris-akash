import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/axios";
import {
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Sun,
  Maximize2,
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
  Eye,
  CheckCircle,
  Smartphone,
  Compass
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

  // Viewport Transformation & Windowing State
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [invert, setInvert] = useState(false);
  const [rotation, setRotation] = useState(0);

  // Active Tool: "pan" | "wl" | "measure_dist" | "measure_angle"
  const [activeTool, setActiveTool] = useState("pan");
  const [measurements, setMeasurements] = useState([]); // [{ type: "dist", p1, p2, label }]
  const [currentDraftMeasure, setCurrentDraftMeasure] = useState(null);

  // Cine Play State
  const [isCinePlaying, setIsCinePlaying] = useState(false);
  const [cineFps, setCineFps] = useState(10);

  // UI Panels
  const [showDrawer, setShowDrawer] = useState(false);

  // Canvas Refs & Touch Refs
  const canvasRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const touchPinchDist = useRef(null);
  const loadedImageRef = useRef(null);

  // Load DICOM Study Data
  const fetchStudyData = useCallback(async () => {
    if (!studyUID) return;
    setLoading(true);
    try {
      // 1. Try Mobile Study API payload
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
    } catch (err) {
      console.error("Failed to load study for Native DICOM Viewer:", err);
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
    ? (currentInstance.previewUrl || `/api/pacs/instance-preview/${currentInstance.id}`)
    : "";

  // Render DICOM Image onto Canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize Canvas to container
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!loadedImageRef.current) {
      ctx.fillStyle = "#64748b";
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading DICOM Frame...", canvas.width / 2, canvas.height / 2);
      return;
    }

    const img = loadedImageRef.current;
    ctx.save();

    // Move to canvas center for transformations
    ctx.translate(canvas.width / 2 + pan.x, canvas.height / 2 + pan.y);
    ctx.scale(scale, scale);
    ctx.rotate((rotation * Math.PI) / 180);

    // Apply Filter W/L Brightness and Contrast
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) ${invert ? "invert(100%)" : ""}`;

    // Draw DICOM Image Centered
    const imgW = img.width || 512;
    const imgH = img.height || 512;
    ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    // Draw Overlay Measurements (In Canvas Screen Coordinates)
    drawMeasurementsOverlay(ctx);
  }, [scale, pan, brightness, contrast, invert, rotation, measurements, currentDraftMeasure]);

  // Load Image Source on Slice Change
  useEffect(() => {
    if (!currentPreviewUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = currentPreviewUrl;
    img.onload = () => {
      loadedImageRef.current = img;
      drawCanvas();
    };
  }, [currentPreviewUrl, drawCanvas]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Cine Player Interval Loop
  useEffect(() => {
    let intervalId = null;
    if (isCinePlaying && currentInstances.length > 1) {
      intervalId = setInterval(() => {
        setCurrentIndex(prev => (prev + 1) % currentInstances.length);
      }, 1000 / cineFps);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isCinePlaying, currentInstances.length, cineFps]);

  // Measurements Renderer
  const drawMeasurementsOverlay = (ctx) => {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#38bdf8";
    ctx.fillStyle = "#38bdf8";
    ctx.font = "bold 12px Inter, monospace";

    const allMeasures = currentDraftMeasure ? [...measurements, currentDraftMeasure] : measurements;

    allMeasures.forEach((m, idx) => {
      if (m.type === "dist" && m.p1 && m.p2) {
        ctx.beginPath();
        ctx.moveTo(m.p1.x, m.p1.y);
        ctx.lineTo(m.p2.x, m.p2.y);
        ctx.stroke();

        // End Handle Pins
        ctx.beginPath();
        ctx.arc(m.p1.x, m.p1.y, 4, 0, 2 * Math.PI);
        ctx.arc(m.p2.x, m.p2.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Calculate Distance Label
        const dx = m.p2.x - m.p1.x;
        const dy = m.p2.y - m.p1.y;
        const distPx = Math.sqrt(dx * dx + dy * dy);
        const distMm = (distPx * 0.25).toFixed(1); // 0.25mm/px ratio approximation

        const midX = (m.p1.x + m.p2.x) / 2;
        const midY = (m.p1.y + m.p2.y) / 2;

        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(midX - 25, midY - 18, 70, 18);
        ctx.fillStyle = "#38bdf8";
        ctx.fillText(`📏 ${distMm} mm`, midX - 20, midY - 5);
      }
    });
    ctx.restore();
  };

  // Canvas Mouse & Touch Interactivity
  const handlePointerDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX || (e.touches && e.touches[0].clientX);
    const y = e.clientY || (e.touches && e.touches[0].clientY);

    isDragging.current = true;
    dragStart.current = { x, y };

    if (activeTool === "measure_dist") {
      const canvasPos = { x: x - rect.left, y: y - rect.top };
      setCurrentDraftMeasure({ type: "dist", p1: canvasPos, p2: canvasPos });
    }
  };

  const handlePointerMove = (e) => {
    if (!isDragging.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX || (e.touches && e.touches[0].clientX);
    const y = e.clientY || (e.touches && e.touches[0].clientY);

    const dx = x - dragStart.current.x;
    const dy = y - dragStart.current.y;

    if (activeTool === "pan") {
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      dragStart.current = { x, y };
    } else if (activeTool === "wl") {
      setBrightness(prev => Math.max(20, Math.min(250, prev + dy * -0.5)));
      setContrast(prev => Math.max(20, Math.min(250, prev + dx * 0.5)));
      dragStart.current = { x, y };
    } else if (activeTool === "measure_dist" && currentDraftMeasure) {
      const canvasPos = { x: x - rect.left, y: y - rect.top };
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

  // Pinch-to-Zoom Touch Handler for Tablets / iPads
  const handleTouchMove = (e) => {
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

  const handleTouchEnd = (e) => {
    touchPinchDist.current = null;
    handlePointerUp();
  };

  // Mouse Wheel Zooming
  const handleWheel = (e) => {
    e.preventDefault();
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

  // Capture Key Image Snapshot to Report Studio
  const handleCaptureSnapshot = async () => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      
      // Dispatch viewer message via postMessage / storage
      localStorage.setItem("LAST_CAPTURED_KEY_IMG", JSON.stringify({
        dataUrl,
        caption: `${studyMeta?.modality || 'DICOM'} | ${activeSeries.seriesDescription || 'Series'} | Slice ${currentIndex + 1}/${currentInstances.length}`,
        timestamp: Date.now()
      }));

      alert("📸 Key Image captured! Slice attached to Report Studio.");
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
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  return (
    <div className="ndv-container">
      {/* Top Medical Workstation Bar */}
      <header className="ndv-topbar">
        <div className="ndv-left">
          <button onClick={() => navigate(-1)} className="ndv-icon-btn" title="Back">
            <ChevronLeft size={20} />
          </button>
          <div className="ndv-patient-info" onClick={() => setShowDrawer(!showDrawer)}>
            <div className="ndv-patient-name">{studyMeta?.patientName || "DICOM Native Viewer"}</div>
            <div className="ndv-patient-meta">
              <span className="ndv-badge blue">{studyMeta?.modality || "CR"}</span>
              <span className="ndv-badge orange">ID: {studyMeta?.patientId || "N/A"}</span>
              <span>Acc: {studyMeta?.accession || "N/A"}</span>
              <span>• Slice {currentIndex + 1}/{currentInstances.length}</span>
            </div>
          </div>
        </div>

        {/* Viewport Action Buttons */}
        <div className="ndv-right">
          <button className="ndv-btn ndv-btn-indigo" onClick={() => setShowDrawer(!showDrawer)}>
            <Layers size={14} /> Series ({seriesList.length})
          </button>
          <button className="ndv-btn ndv-btn-sky" onClick={handleCaptureSnapshot}>
            <Camera size={14} /> Capture Snapshot
          </button>
          <button className="ndv-btn ndv-btn-emerald" onClick={() => navigate(`/report-editor?study=${encodeURIComponent(studyUID)}`)}>
            <FileText size={14} /> Report Studio
          </button>
        </div>
      </header>

      {/* Main Viewport & Series Drawer */}
      <div className="ndv-body">
        {/* Series Drawer */}
        <div className={`ndv-drawer ${showDrawer ? "open" : ""}`}>
          <div className="ndv-drawer-header">
            <span>Study Series ({seriesList.length})</span>
            <button onClick={() => setShowDrawer(false)} className="ndv-icon-btn"><X size={18} /></button>
          </div>
          <div className="ndv-drawer-content">
            {seriesList.map((s, idx) => (
              <div
                key={s.seriesId || idx}
                className={`ndv-series-card ${idx === activeSeriesIndex ? "active" : ""}`}
                onClick={() => {
                  setActiveSeriesIndex(idx);
                  setCurrentIndex(0);
                  setShowDrawer(false);
                }}
              >
                <div style={{ fontWeight: 800, fontSize: 13, color: "#ffffff" }}>
                  {s.seriesDescription || `Series ${idx + 1}`}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                  {s.totalSlices || s.instances?.length || 0} Slices • Series #{s.seriesNumber || idx + 1}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas Display Viewport */}
        <div 
          className="ndv-viewport-container"
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
        >
          {loading ? (
            <div className="ndv-loader">
              <RefreshCw className="animate-spin text-indigo-400" size={36} />
              <span style={{ marginTop: 10, color: "#f8fafc", fontWeight: 700 }}>Launching Fast Canvas DICOM Engine...</span>
            </div>
          ) : (
            <canvas ref={canvasRef} className="ndv-canvas" />
          )}

          {/* Interactive Orientation Compass Overlay */}
          <div className="ndv-overlay-info">
            <div><b>L:</b> {brightness.toFixed(0)} | <b>W:</b> {contrast.toFixed(0)}</div>
            <div><b>Zoom:</b> {(scale * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>

      {/* Slice Scrubber Range Bar */}
      {currentInstances.length > 1 && (
        <div className="ndv-scrubber">
          <button 
            className="ndv-scrub-btn" 
            onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))}
            disabled={currentIndex === 0}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={currentInstances.length - 1}
            value={currentIndex}
            onChange={(e) => setCurrentIndex(parseInt(e.target.value, 10))}
            className="ndv-range"
          />
          <button 
            className="ndv-scrub-btn" 
            onClick={() => setCurrentIndex(prev => Math.min(currentInstances.length - 1, prev + 1))}
            disabled={currentIndex === currentInstances.length - 1}
          >
            <ChevronLeft size={16} style={{ transform: "rotate(180deg)" }} />
          </button>
        </div>
      )}

      {/* Interactive Tool Toolbar */}
      <footer className="ndv-toolbar">
        <div className="ndv-tool-group">
          <button
            className={`ndv-tool-btn ${activeTool === "pan" ? "active" : ""}`}
            onClick={() => setActiveTool("pan")}
            title="1-Touch Pan / Drag"
          >
            <Compass size={18} />
            <span>Pan</span>
          </button>

          <button
            className={`ndv-tool-btn ${activeTool === "wl" ? "active" : ""}`}
            onClick={() => setActiveTool("wl")}
            title="Window / Level W/L Contrast Drag"
          >
            <Sliders size={18} />
            <span>W / L</span>
          </button>

          <button
            className={`ndv-tool-btn ${activeTool === "measure_dist" ? "active" : ""}`}
            onClick={() => setActiveTool("measure_dist")}
            title="Caliper Distance Measurement (mm)"
          >
            <Ruler size={18} />
            <span>Measure</span>
          </button>
        </div>

        <div className="ndv-separator" />

        <div className="ndv-tool-group">
          <button className="ndv-tool-btn" onClick={() => setScale(s => Math.min(6, s + 0.25))} title="Zoom In">
            <ZoomIn size={18} />
          </button>
          <button className="ndv-tool-btn" onClick={() => setScale(s => Math.max(0.4, s - 0.25))} title="Zoom Out">
            <ZoomOut size={18} />
          </button>
          <button className="ndv-tool-btn" onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90°">
            <RotateCw size={18} />
          </button>
          <button className={`ndv-tool-btn ${invert ? "active" : ""}`} onClick={() => setInvert(!invert)} title="Invert Negative">
            <Sun size={18} />
          </button>
        </div>

        <div className="ndv-separator" />

        <div className="ndv-tool-group">
          <button
            className={`ndv-tool-btn ${isCinePlaying ? "playing" : ""}`}
            onClick={() => setIsCinePlaying(!isCinePlaying)}
            title="Cine Auto-Play Loop"
          >
            {isCinePlaying ? <Pause size={18} /> : <Play size={18} />}
            <span>Cine</span>
          </button>

          <button className="ndv-tool-btn reset" onClick={resetAll} title="Reset Viewport">
            <RotateCcw size={16} />
            <span>Reset</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
