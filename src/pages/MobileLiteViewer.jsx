import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import api, { apiUrl } from "../api/axios";
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Sun, 
  Moon,
  Move,
  Maximize,
  X
} from "lucide-react";
import "./MobileLiteViewer.css";

const MobileLiteViewer = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const studyUID = searchParams.get("study");
  
  const [instances, setInstances] = useState([]);
  const [showList, setShowList] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const fetchInstances = useCallback(async () => {
    if (!studyUID) return;
    setLoading(true);
    try {
      // Fetch instances using DICOMWeb QIDO-RS via direct Nginx proxy
      const res = await api.get(`/pacs/dicom-web/studies/${studyUID}/instances`);
      
      const instanceList = res.data.map(inst => ({
        id: inst["00080018"]?.Value?.[0], // SOPInstanceUID
        seriesId: inst["0020000E"]?.Value?.[0], // SeriesInstanceUID
        instanceNumber: parseInt(inst["00200013"]?.Value?.[0] || 0)
      })).sort((a, b) => a.instanceNumber - b.instanceNumber);
      
      setInstances(instanceList);
    } catch (error) {
      console.error("Failed to fetch instances", error);
    } finally {
      setLoading(false);
    }
  }, [studyUID]);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  const nextImage = () => {
    if (currentIndex < instances.length - 1) {
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
    setRotation(0);
  };


  const currentInstance = instances[currentIndex];
  // Robust URL construction: Use relative path if possible or the current origin to avoid 'localhost' issues on mobile
  const getFullImageUrl = (path) => {
    if (!path) return "";
    return `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const imageUrl = currentInstance 
    ? getFullImageUrl(`/pacs/dicom-web/studies/${studyUID}/series/${currentInstance.seriesId}/instances/${currentInstance.id}/rendered`)
    : "";

  if (!studyUID) {
    return (
      <div className="lite-viewer-error">
        <h3>Study UID missing</h3>
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  return (
    <div className={`lite-viewer-container ${isDarkMode ? "dark" : "light"}`}>
      {/* Header */}
      <header className="lite-viewer-header">
        <button className="icon-btn" onClick={() => navigate(-1)}>
          <ChevronLeft size={24} />
        </button>
        <button className="icon-btn" onClick={() => setShowList(!showList)}>
          <div style={{ position: 'relative' }}>
            <span className="index-label">{currentIndex + 1} / {instances.length}</span>
          </div>
        </button>
        <button className="icon-btn" onClick={() => setIsDarkMode(!isDarkMode)}>
          {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </header>

      {/* Instance List Sidebar (Drawer) */}
      <div className={`lite-instance-list ${showList ? "open" : ""}`}>
        <div className="list-header">
          <span>Instances ({instances.length})</span>
          <button onClick={() => setShowList(false)}><X size={20} /></button>
        </div>
        <div className="list-content">
          {instances.map((inst, idx) => (
            <div 
              key={inst.id} 
              className={`list-item ${idx === currentIndex ? "active" : ""}`}
              onClick={() => {
                setCurrentIndex(idx);
                setShowList(false);
              }}
            >
              Image {idx + 1}
            </div>
          ))}
        </div>
      </div>

      {/* Main Viewport */}
      <main className="lite-viewer-main">
        {loading ? (
          <div className="loader">Loading Study...</div>
        ) : (
          <div className="viewport-wrapper" onWheel={(e) => setZoom(z => Math.max(0.5, Math.min(5, z + (e.deltaY < 0 ? 0.1 : -0.1))))}>
            <img 
              src={imageUrl} 
              alt="DICOM Instance"
              className="main-image"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                filter: `brightness(${brightness}) contrast(${contrast})`,
                transition: "transform 0.2s ease-out, filter 0.2s ease-out"
              }}
            />
          </div>
        )}
      </main>

      {/* Footer Tools */}
      <footer className="lite-viewer-footer">
        <div className="tool-row scroll-x">
          <button className="tool-btn" onClick={prevImage} disabled={currentIndex === 0}>
            <ChevronLeft size={20} />
          </button>
          
          <div className="divider" />
          
          <button className="tool-btn" onClick={() => setZoom(z => Math.min(5, z + 0.2))}>
            <ZoomIn size={20} />
          </button>
          <button className="tool-btn" onClick={() => setZoom(z => Math.max(0.5, z - 0.2))}>
            <ZoomOut size={20} />
          </button>
          <button className="tool-btn" onClick={() => setRotation(r => (r + 90) % 360)}>
            <RotateCw size={20} />
          </button>
          
          <div className="divider" />
          
          <button className="tool-btn" onClick={() => setBrightness(b => Math.min(2, b + 0.1))}>
            <Sun size={20} />
          </button>
          <button className="tool-btn" onClick={() => setContrast(c => Math.min(2, c + 0.1))}>
            <Maximize size={20} />
          </button>
          
          <div className="divider" />
          
          <button className="tool-btn reset" onClick={resetTools}>
            RESET
          </button>
          
          <div className="divider" />

          <button className="tool-btn" onClick={nextImage} disabled={currentIndex === instances.length - 1}>
            <ChevronRight size={20} />
          </button>
        </div>
      </footer>
    </div>
  );
};

export default MobileLiteViewer;
