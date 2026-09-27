import React, { useState, useEffect } from "react";
import { X, Check, Image as ImageIcon, Layers, RefreshCw, Star } from "lucide-react";
import api from "../../api/axios";

export default function DicomKeyImagePickerModal({ isOpen, onClose, studyUID, onSelectImage, attachedSnapshots = [] }) {
  const [loading, setLoading] = useState(false);
  const [seriesList, setSeriesList] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState(null); // Store FULL object
  const [selectedSliceIndex, setSelectedSliceIndex] = useState(0); // Track selected slice
  const [addedIds, setAddedIds] = useState(new Set());
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => {
    if (isOpen && studyUID) {
      loadSeriesInstances();
    }
  }, [isOpen, studyUID]);

  useEffect(() => {
    const ids = new Set((attachedSnapshots || []).map(s => String(s.instance_id || s.sopInstanceUid || s.id)));
    setAddedIds(ids);
  }, [attachedSnapshots]);

  const loadSeriesInstances = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/pacs/study-series-instances/${encodeURIComponent(studyUID)}`);
      if (res.data?.success && Array.isArray(res.data.series)) {
        setSeriesList(res.data.series);
        if (res.data.series.length > 0) {
          const defaultSeries = res.data.series.find(s => s.total_slices > 1) || res.data.series[0];
          setSelectedSeries(defaultSeries); // Store full object
          setSelectedSliceIndex(0);
        }
      }
    } catch (err) {
      console.error("Failed loading study series instances:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleCaptureSelectedSlice = async () => {
    if (!selectedSeries) {
      setToastMsg("❌ No series selected!");
      setTimeout(() => setToastMsg(""), 3000);
      return;
    }

    setLoading(true);
    try {
      const instance = selectedSeries.instances[selectedSliceIndex];
      if (!instance) {
        throw new Error("No instance at selected slice index");
      }

      const sDesc = selectedSeries.series_description || `Series ${selectedSeries.series_number || 1}`;
      const totSlices = selectedSeries.total_slices || selectedSeries.instances.length || 1;
      const sliceNum = instance.slice_number || instance.instance_number || (selectedSliceIndex + 1);
      const caption = `${sDesc} | ${sliceNum}/${totSlices}`;

      console.log('[Modal] Capturing:', {
        studyUID,
        seriesUID: selectedSeries.series_id,
        seriesDescription: sDesc,
        sliceNumber: sliceNum,
        instanceId: instance.instance_id,
        previewUrl: instance.preview_url
      });

      const capturePayload = {
        studyUID: studyUID,
        seriesUID: selectedSeries.series_id || selectedSeries.series_instance_uid,
        sopInstanceUid: instance.instance_id || instance.sop_instance_uid,
        instanceId: instance.instance_id,
        sliceNumber: sliceNum,
        totalSlices: totSlices,
        seriesNumber: selectedSeries.series_number || 1,
        seriesDescription: sDesc,
        modality: selectedSeries.modality || 'CT',
        caption: caption,
        previewUrl: instance.preview_url || instance.previewUrl
      };

      let snapObj = null;
      try {
        const res = await api.post("/api/pacs/capture-key-image", capturePayload);
        if (res.data?.success && res.data?.data) {
          snapObj = res.data.data;
          console.log('[Modal] ✅ Backend saved:', snapObj);
        }
      } catch (e) {
        console.error("[Modal] Backend save failed:", e);
      }

      if (!snapObj) {
        snapObj = {
          id: `snap_${Date.now()}`,
          instance_id: instance.instance_id,
          sopInstanceUid: instance.instance_id,
          studyUID: studyUID,
          seriesUID: selectedSeries.series_id,
          sliceNumber: sliceNum,
          preview_url: instance.preview_url,
          previewUrl: instance.preview_url,
          caption: caption
        };
      }

      onSelectImage(snapObj);
      setAddedIds(prev => new Set(prev).add(String(instance.instance_id)));
      setToastMsg(`✅ Captured: ${caption}`);
      setTimeout(() => setToastMsg(""), 3000);
    } catch (err) {
      console.error("[Modal] Capture failed:", err);
      setToastMsg(`❌ Failed: ${err.message}`);
      setTimeout(() => setToastMsg(""), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 960,
          maxHeight: "88vh",
          backgroundColor: "#ffffff",
          borderRadius: 16,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #cbd5e1"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ background: "#0284c7", padding: 8, borderRadius: 10, display: "flex" }}>
              <ImageIcon size={20} color="#ffffff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Select Key Diagnostic Images
              </h3>
              <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "#94a3b8" }}>
                Browse series & slices. Click thumbnails to attach.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              onClick={handleCaptureSelectedSlice}
              disabled={!selectedSeries || loading}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: 8,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: selectedSeries && !loading ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 6,
                opacity: selectedSeries && !loading ? 1 : 0.5
              }}
            >
              <Star size={14} fill="#f59e0b" color="#f59e0b" />
              {loading ? "Capturing..." : "Capture Selected Slice"}
            </button>

            {toastMsg && (
              <div style={{ 
                background: toastMsg.includes("❌") ? "#ef4444" : "#10b981", 
                color: "#ffffff", 
                padding: "4px 12px", 
                borderRadius: 20, 
                fontSize: 12, 
                fontWeight: 700 
              }}>
                {toastMsg}
              </div>
            )}
            <button
              onClick={onClose}
              style={{
                background: "rgba(255, 255, 255, 0.1)",
                border: "none",
                color: "#ffffff",
                borderRadius: 8,
                padding: 6,
                cursor: "pointer",
                display: "flex"
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Series Navigation Tabs */}
        {seriesList.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 8,
              padding: "12px 20px",
              background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
              overflowX: "auto"
            }}
          >
            {seriesList.map((s) => {
              const isSelected = selectedSeries && String(s.series_id) === String(selectedSeries.series_id);
              return (
                <button
                  key={s.series_id}
                  onClick={() => {
                    setSelectedSeries(s);
                    setSelectedSliceIndex(0);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 600,
                    border: isSelected ? "2px solid #0284c7" : "1px solid #cbd5e1",
                    background: isSelected ? "#e0f2fe" : "#ffffff",
                    color: isSelected ? "#0369a1" : "#475569",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  <Layers size={14} color={isSelected ? "#0284c7" : "#64748b"} />
                  <span>Series {s.series_number}: {s.series_description}</span>
                  <span
                    style={{
                      background: isSelected ? "#0284c7" : "#e2e8f0",
                      color: isSelected ? "#ffffff" : "#475569",
                      padding: "1px 6px",
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 800
                    }}
                  >
                    {s.total_slices} slices
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Image Grid Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#f1f5f9" }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: "center", color: "#64748b" }}>
              <RefreshCw size={28} className="animate-spin" style={{ margin: "0 auto 10px auto", color: "#0284c7" }} />
              <div style={{ fontSize: 14, fontWeight: 600 }}>Loading...</div>
            </div>
          ) : !selectedSeries || !selectedSeries.instances || selectedSeries.instances.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", color: "#64748b", fontSize: 13 }}>
              No instances found for this series.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 14
              }}
            >
              {selectedSeries.instances.map((inst, idx) => {
                const isAdded = addedIds.has(String(inst.instance_id));
                const isSelected = idx === selectedSliceIndex;
                return (
                  <div
                    key={inst.instance_id}
                    onClick={() => setSelectedSliceIndex(idx)}
                    style={{
                      position: "relative",
                      background: "#ffffff",
                      borderRadius: 12,
                      border: isSelected ? "3px solid #0284c7" : (isAdded ? "2px solid #10b981" : "1px solid #cbd5e1"),
                      overflow: "hidden",
                      boxShadow: isSelected ? "0 4px 12px rgba(2, 132, 199, 0.3)" : (isAdded ? "0 4px 12px rgba(16, 185, 129, 0.2)" : "0 2px 4px rgba(0,0,0,0.05)"),
                      cursor: "pointer",
                      transition: "all 0.15s ease"
                    }}
                  >
                    <div style={{ position: "relative", aspectRatio: "1/1", backgroundColor: "#000000", overflow: "hidden" }}>
                      <img
                        src={inst.preview_url || inst.previewUrl || `/api/pacs/instance-preview/${inst.instance_id}?studyUID=${encodeURIComponent(studyUID)}`}
                        alt={`Slice ${inst.slice_number}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 6,
                          left: 6,
                          background: "rgba(15, 23, 42, 0.85)",
                          color: "#ffffff",
                          padding: "2px 7px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 800
                        }}
                      >
                        #{inst.slice_number || (idx + 1)}
                      </div>

                      {isAdded && (
                        <div
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            background: "#10b981",
                            color: "#ffffff",
                            padding: 4,
                            borderRadius: "50%",
                            display: "flex"
                          }}
                        >
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    <div style={{ padding: "8px 10px", background: "#ffffff", borderTop: "1px solid #f1f5f9" }}>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>
                        Slice {inst.slice_number || (idx + 1)}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSliceIndex(idx);
                          setTimeout(() => handleCaptureSelectedSlice(), 100);
                        }}
                        style={{
                          width: "100%",
                          padding: "5px 0",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          border: "none",
                          background: isAdded ? "#ecfdf5" : "#0284c7",
                          color: isAdded ? "#047857" : "#ffffff",
                          cursor: "pointer"
                        }}
                      >
                        {isAdded ? "✓ Added" : "+ Select"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            background: "#ffffff",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Selected: <b>{selectedSeries?.series_description || 'None'}</b> | Slice: <b>{selectedSliceIndex + 1}</b> | Total Attached: <b>{addedIds.size}</b>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px 20px",
              background: "#0f172a",
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
