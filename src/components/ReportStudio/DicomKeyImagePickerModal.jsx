import React, { useState, useEffect } from "react";
import { X, Check, Image as ImageIcon, Layers, RefreshCw } from "lucide-react";
import api from "../../api/axios";

export default function DicomKeyImagePickerModal({ isOpen, onClose, studyUID, onSelectImage, attachedSnapshots = [] }) {
  const [loading, setLoading] = useState(false);
  const [seriesList, setSeriesList] = useState([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState("");
  const [addedIds, setAddedIds] = useState(new Set());
  const [toastMsg, setToastMsg] = useState("");

  useEffect(() => {
    if (isOpen && studyUID) {
      loadSeriesInstances();
    }
  }, [isOpen, studyUID]);

  useEffect(() => {
    const ids = new Set((attachedSnapshots || []).map(s => String(s.instance_id)));
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
          setSelectedSeriesId(String(defaultSeries.series_id));
        }
      }
    } catch (err) {
      console.error("Failed loading study series instances:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentSeries = seriesList.find(s => String(s.series_id) === String(selectedSeriesId)) || seriesList[0];

  const handlePick = (inst) => {
    const snapObj = {
      id: `snap_picker_${Date.now()}_${inst.slice_number}`,
      instance_id: inst.instance_id,
      preview_url: inst.preview_url,
      caption: inst.caption || `Series ${currentSeries?.series_number || 1}: ${currentSeries?.series_description || ''} (Slice ${inst.slice_number}/${currentSeries?.total_slices || 1})`
    };

    onSelectImage(snapObj);

    setAddedIds(prev => new Set(prev).add(String(inst.instance_id)));
    setToastMsg(`Added Slice #${inst.slice_number} to Key Images!`);
    setTimeout(() => setToastMsg(""), 2500);
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
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
                Select Key Diagnostic Images
              </h3>
              <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "#94a3b8" }}>
                Browse exact study series & slices. Click any thumbnail to attach as key image.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {toastMsg && (
              <div style={{ background: "#10b981", color: "#ffffff", padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, animation: "fadeIn 0.2s" }}>
                ✓ {toastMsg}
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
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
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
              const isSelected = String(s.series_id) === String(selectedSeriesId);
              return (
                <button
                  key={s.series_id}
                  onClick={() => setSelectedSeriesId(String(s.series_id))}
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
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease"
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
              <div style={{ fontSize: 14, fontWeight: 600 }}>Loading Study Slices & Thumbnails...</div>
            </div>
          ) : !currentSeries || !currentSeries.instances || currentSeries.instances.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center", color: "#64748b", fontSize: 13 }}>
              No DICOM instances found for this series.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 14
              }}
            >
              {currentSeries.instances.map((inst) => {
                const isAdded = addedIds.has(String(inst.instance_id));
                return (
                  <div
                    key={inst.instance_id}
                    onClick={() => handlePick(inst)}
                    style={{
                      position: "relative",
                      background: "#ffffff",
                      borderRadius: 12,
                      border: isAdded ? "2px solid #10b981" : "1px solid #cbd5e1",
                      overflow: "hidden",
                      boxShadow: isAdded ? "0 4px 12px rgba(16, 185, 129, 0.2)" : "0 2px 4px rgba(0,0,0,0.05)",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, box-shadow 0.15s ease",
                      display: "flex",
                      flexDirection: "column"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-3px)";
                      e.currentTarget.style.boxShadow = "0 8px 16px rgba(0,0,0,0.12)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = isAdded ? "0 4px 12px rgba(16, 185, 129, 0.2)" : "0 2px 4px rgba(0,0,0,0.05)";
                    }}
                  >
                    <div style={{ position: "relative", aspectRatio: "1/1", backgroundColor: "#000000", overflow: "hidden" }}>
                      <img
                        src={`/api/pacs/instance-preview/${inst.instance_id}`}
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
                          fontWeight: 800,
                          backdropFilter: "blur(2px)"
                        }}
                      >
                        Slice #{inst.slice_number}
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePick(inst);
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
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4
                        }}
                      >
                        {isAdded ? (
                          <>
                            <Check size={12} /> Added
                          </>
                        ) : (
                          <>+ Select Image</>
                        )}
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
            Total Attached Key Images: <b>{addedIds.size}</b>
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
            Done Selecting
          </button>
        </div>
      </div>
    </div>
  );
}
