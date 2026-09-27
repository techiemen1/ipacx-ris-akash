import React, { useState, useEffect } from "react";
import { X, Check, Image as ImageIcon, Layers } from "lucide-react";
import api from "../../api/axios";

export default function DicomKeyImagePickerModal({ isOpen, onClose, studyUID, onSelectImage, attachedSnapshots = [] }) {
  const [loading, setLoading] = useState(false);
  const [seriesList, setSeriesList] = useState([]);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedSliceIndex, setSelectedSliceIndex] = useState(0);
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
        console.log("🔍 [TRACE 3: FRONTEND STATE] Received series list:", res.data.series.map(s => ({ id: s.series_id, desc: s.series_description, slices: s.total_slices })));
        if (res.data.series.length > 0) {
          const defaultSeries = res.data.series.find(s => s.total_slices > 1) || res.data.series[0];
          setSelectedSeries(defaultSeries);
          setSelectedSliceIndex(0);
        }
      }
    } catch (err) {
      console.error("Failed loading series:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCaptureSelectedSlice = async (overrideIndex = null) => {
    if (!selectedSeries) {
      setToastMsg("No series selected");
      setTimeout(() => setToastMsg(""), 3000);
      return;
    }

    setLoading(true);
    try {
      const idxToUse = overrideIndex !== null ? overrideIndex : selectedSliceIndex;
      const instance = selectedSeries.instances ? selectedSeries.instances[idxToUse] : null;
      if (!instance) {
        throw new Error("No instance at selected index");
      }

      const sliceNum = instance.slice_number || instance.instance_number || (idxToUse + 1);
      const caption = `${selectedSeries.series_description} | ${sliceNum}/${selectedSeries.total_slices || selectedSeries.instances.length}`;

      const payload = {
        reportId: null, // Will be set by parent
        studyUID: studyUID,
        seriesUID: selectedSeries.series_id || selectedSeries.series_instance_uid,
        instanceId: instance.instance_id,
        sliceNumber: sliceNum,
        seriesDescription: selectedSeries.series_description || "Unknown",
        modality: selectedSeries.modality || "CT"
      };

      console.log("🔍 [TRACE 4: CAPTURE PAYLOAD] Sending to backend:", JSON.stringify({ studyUID, seriesUID: selectedSeries?.series_id, seriesDesc: selectedSeries?.series_description, instanceId: instance?.instance_id, slice: idxToUse }, null, 2));
      console.log("🚨 [MODAL] About to send capture. Current selectedSeries:", selectedSeries?.series_description, "ID:", selectedSeries?.series_id);

      const res = await api.post("/api/pacs/v2/key-images/save", payload);
      
      if (res.data?.success && res.data?.data) {
        const savedImage = res.data.data;
        onSelectImage(savedImage);
        setAddedIds(prev => new Set(prev).add(String(instance.instance_id)));
        setToastMsg(`✅ Captured: ${caption}`);
        setTimeout(() => setToastMsg(""), 3000);
      } else {
        throw new Error("Backend did not return success");
      }
    } catch (err) {
      console.error("[Modal] Capture failed:", err);
      setToastMsg(`❌ Failed: ${err.message}`);
      setTimeout(() => setToastMsg(""), 3000);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  console.log("🚨 [MODAL RENDER] selectedSeries:", selectedSeries?.series_description, "ID:", selectedSeries?.series_id);

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
          overflow: "hidden"
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
            <div style={{ background: "#0284c7", padding: 8, borderRadius: 10 }}>
              <ImageIcon size={20} color="#ffffff" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Select Key Images
              </h3>
              <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "#94a3b8" }}>
                Click any slice to attach
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => {
                console.log("🚨 [TEST BUTTON CLICKED] Current selectedSeries:", selectedSeries?.series_description, "ID:", selectedSeries?.series_id);
                alert(`Current Selected Series: ${selectedSeries?.series_description || "None"}\nID: ${selectedSeries?.series_id || "None"}`);
              }}
              style={{ background: "#8b5cf6", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              🧪 TEST STATE
            </button>

            <button
              onClick={() => {
                localStorage.clear();
                sessionStorage.clear();
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister()));
                }
                window.location.reload(true);
              }}
              style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              🗑️ CLEAR CACHE & RELOAD
            </button>

            {toastMsg && (
              <div style={{ 
                background: toastMsg.includes("✅") ? "#10b981" : "#ef4444", 
                color: "#fff", 
                padding: "4px 12px", 
                borderRadius: 20, 
                fontSize: 12, 
                fontWeight: 700 
              }}>
                {toastMsg}
              </div>
            )}
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", borderRadius: 8, padding: 6, cursor: "pointer" }}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Series Tabs */}
        {seriesList.length > 0 && (
          <div style={{ display: "flex", gap: 8, padding: "12px 20px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", overflowX: "auto" }}>
            {seriesList.map((s) => {
              const isSelected = selectedSeries && String(s.series_id) === String(selectedSeries.series_id);
              return (
                <button
                  key={s.series_id}
                  onClick={() => {
                    console.log("🚨 [TAB CLICK] Changing from:", selectedSeries?.series_description, "TO:", s.series_description);
                    console.log("🚨 [TAB CLICK] Series ID from:", selectedSeries?.series_id, "TO:", s.series_id);
                    setSelectedSeries(s);
                    setSelectedSliceIndex(0);
                    setTimeout(() => {
                      console.log("🚨 [TAB CLICK] After setState, selectedSeries is:", selectedSeries?.series_description);
                    }, 100);
                  }}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: isSelected ? 700 : 600,
                    border: isSelected ? "2px solid #0284c7" : "1px solid #cbd5e1",
                    background: isSelected ? "#e0f2fe" : "#fff",
                    color: isSelected ? "#0369a1" : "#475569",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  <Layers size={14} style={{ display: "inline", marginRight: 4 }} />
                  Series {s.series_number}: {s.series_description} ({s.total_slices})
                </button>
              );
            })}
          </div>
        )}

        {/* Image Grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20, background: "#f1f5f9" }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: "center" }}>Loading...</div>
          ) : !selectedSeries || !selectedSeries.instances?.length ? (
            <div style={{ padding: 60, textAlign: "center", color: "#64748b" }}>No images</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
              {selectedSeries.instances.map((inst, idx) => {
                const isAdded = addedIds.has(String(inst.instance_id));
                const isSelected = idx === selectedSliceIndex;
                return (
                  <div
                    key={inst.instance_id}
                    onClick={() => setSelectedSliceIndex(idx)}
                    style={{
                      position: "relative",
                      background: "#fff",
                      borderRadius: 12,
                      border: isSelected ? "3px solid #0284c7" : (isAdded ? "2px solid #10b981" : "1px solid #cbd5e1"),
                      overflow: "hidden",
                      cursor: "pointer"
                    }}
                  >
                    <div style={{ position: "relative", aspectRatio: "1/1", background: "#000" }}>
                      <img
                        src={inst.preview_url || `/api/pacs/instance-preview/${inst.instance_id}?studyUID=${studyUID}`}
                        alt={`Slice ${inst.slice_number}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div style={{ position: "absolute", top: 6, left: 6, background: "rgba(0,0,0,0.8)", color: "#fff", padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 800 }}>
                        #{inst.slice_number || (idx + 1)}
                      </div>
                      {isAdded && (
                        <div style={{ position: "absolute", top: 6, right: 6, background: "#10b981", padding: 4, borderRadius: "50%" }}>
                          <Check size={12} color="#fff" />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedSliceIndex(idx); handleCaptureSelectedSlice(idx); }}
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "none",
                        background: isAdded ? "#ecfdf5" : "#0284c7",
                        color: isAdded ? "#047857" : "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >
                      {isAdded ? "✓ Added" : "+ Select"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", background: "#fff", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between" }}>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Selected: <b>{selectedSeries?.series_description || "None"}</b> | Slice: <b>{selectedSliceIndex + 1}</b> | Total: <b>{addedIds.size}</b>
          </div>
          <button onClick={onClose} style={{ padding: "8px 20px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
