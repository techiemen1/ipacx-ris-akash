import React, { useState } from "react";
import { Image as ImageIcon, Trash2, Plus, FileText, Maximize2, X, Edit2, Check } from "lucide-react";
import api from "../../api/axios";

export default function KeyImageGallery({
  studyUID,
  attachedSnapshots = [],
  setAttachedSnapshots,
  onOpenPicker,
  onAttachActiveSlice,
  onInsertToEditor,
  studySeriesList = [],
  selectedSeriesId = "",
  onSelectSeries
}) {
  const [lightboxImg, setLightboxImg] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editCaptionText, setEditCaptionText] = useState("");

  const handleDelete = async (snap) => {
    const targetId = snap.db_id || snap.id || snap.instance_id || snap.sopInstanceUid;
    const previewUrl = snap.preview_url || snap.previewUrl || snap.url;

    if (studyUID && (targetId || previewUrl)) {
      try {
        const queryParams = new URLSearchParams();
        if (previewUrl) queryParams.append('preview_url', previewUrl);
        if (snap.sliceNumber || snap.slice_number) queryParams.append('sliceNumber', snap.sliceNumber || snap.slice_number);

        const deleteUrl = `/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images/${encodeURIComponent(targetId || 'by-url')}?${queryParams.toString()}`;
        await api.delete(deleteUrl);
      } catch (err) {
        console.warn("Failed deleting key image from backend DB:", err.message);
      }
    }

    const filterOutSnap = (s) => {
      const sId = s.db_id || s.id || s.instance_id || s.sopInstanceUid;
      const sUrl = s.preview_url || s.previewUrl || s.url || s.dataUrl;
      if (targetId && (sId === targetId || String(sId) === String(targetId))) return false;
      if (previewUrl && sUrl && (sUrl === previewUrl || sUrl.includes(previewUrl) || previewUrl.includes(sUrl))) return false;
      return true;
    };

    if (setAttachedSnapshots) {
      setAttachedSnapshots(prev => prev.filter(filterOutSnap));
    }

    try {
      localStorage.removeItem("key_images");
      if (studyUID) {
        localStorage.removeItem(`key_images_${studyUID}`);
        sessionStorage.removeItem(`key_images_${studyUID}`);
      }
    } catch (e) {
      // ignore storage errors
    }
  };

  const startEditCaption = (snap) => {
    setEditingId(snap.id || snap.db_id);
    setEditCaptionText(snap.caption || "");
  };

  const handleSaveCaption = async (snap) => {
    const targetId = snap.db_id || snap.id;
    if (!targetId) return;

    if (setAttachedSnapshots) {
      setAttachedSnapshots(prev => prev.map(s => {
        if ((s.id || s.db_id) === targetId) {
          return { ...s, caption: editCaptionText };
        }
        return s;
      }));
    }
    setEditingId(null);
  };

  const [sliceInput, setSliceInput] = useState(1);

  const currentSeries = (studySeriesList || []).find(s => 
    String(s.series_id) === String(selectedSeriesId) || 
    String(s.series_instance_uid) === String(selectedSeriesId) || 
    String(s.orthanc_series_id) === String(selectedSeriesId)
  ) || (studySeriesList || [])[0];

  const maxSlices = currentSeries?.total_slices || currentSeries?.instances?.length || 999;

  return (
    <div style={{ background: "#ffffff", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 16 }}>
      {/* Gallery Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
          <ImageIcon size={16} style={{ color: "#0284c7" }} />
          KEY IMAGES ATTACHED ({attachedSnapshots.length})
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {Array.isArray(studySeriesList) && studySeriesList.length > 0 && (
            <>
              {onSelectSeries && (
                <select
                  value={selectedSeriesId}
                  onChange={(e) => {
                    onSelectSeries(e.target.value);
                    setSliceInput(1);
                  }}
                  style={{
                    background: "#0f172a",
                    color: "#38bdf8",
                    border: "1px solid #0284c7",
                    borderRadius: 6,
                    padding: "4px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    outline: "none"
                  }}
                  title="Select Active Diagnostic Series"
                >
                  {studySeriesList
                    .filter(s => {
                      const d = String(s.series_description || "").toLowerCase();
                      return !d.includes("topogram") && !d.includes("localizer") && !d.includes("scout") && !d.includes("survey") && !d.includes("plan");
                    })
                    .map(s => (
                      <option key={s.series_id || s.series_instance_uid} value={s.series_id || s.series_instance_uid}>
                        S:{s.series_number || 1} - {s.series_description || `Series ${s.series_number || 1}`} ({s.total_slices || s.instances?.length || 1})
                      </option>
                    ))}
                </select>
              )}

              {/* Direct Slice Selector Input */}
              <div style={{ display: "flex", alignItems: "center", gap: 4, background: "#ffffff", padding: "3px 8px", borderRadius: 6, border: "1px solid #cbd5e1" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>Slice #:</span>
                <input
                  type="number"
                  min="1"
                  max={maxSlices}
                  value={sliceInput}
                  onChange={(e) => setSliceInput(Math.max(1, Math.min(maxSlices, parseInt(e.target.value, 10) || 1)))}
                  style={{
                    width: 44,
                    fontSize: 11,
                    fontWeight: 700,
                    textAlign: "center",
                    border: "1px solid #0284c7",
                    borderRadius: 4,
                    padding: "1px 2px",
                    outline: "none",
                    background: "#f0f9ff",
                    color: "#0369a1"
                  }}
                  title={`Enter slice number (1 to ${maxSlices})`}
                />
              </div>
            </>
          )}

          {onOpenPicker && (
            <button
              type="button"
              onClick={onOpenPicker}
              style={{
                background: "#0284c7",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4
              }}
            >
              <Plus size={13} /> Select Key Images
            </button>
          )}

          {onAttachActiveSlice && (
            <button
              type="button"
              onClick={() => onAttachActiveSlice(sliceInput, selectedSeriesId)}
              style={{
                background: "#059669",
                color: "#ffffff",
                border: "none",
                borderRadius: 6,
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4
              }}
              title={`Attach Slice #${sliceInput} of series to report`}
            >
              <Plus size={13} /> Attach Slice #{sliceInput}
            </button>
          )}
        </div>
      </div>

      {/* Gallery Tray */}
      <div style={{ padding: 14, background: "#f8fafc" }}>
        {attachedSnapshots.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px 10px", color: "#64748b", fontSize: 12 }}>
            No key diagnostic images attached yet. Click <b>"Attach Active Slice"</b> or <b>"Select Key Images"</b> to add slices to this report.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
            {attachedSnapshots.map((snap, idx) => {
              const previewUrl = snap.preview_url || snap.previewUrl || snap.url || snap.dataUrl;
              const isEditing = editingId === (snap.id || snap.db_id);

              return (
                <div
                  key={snap.id || snap.db_id || idx}
                  style={{
                    background: "#ffffff",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)"
                  }}
                >
                  <div style={{ position: "relative", aspectRatio: "4/3", backgroundColor: "#000000", overflow: "hidden" }}>
                    <img
                      src={previewUrl}
                      alt={snap.caption || `Key Image ${idx + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />

                    {/* Action Overlay buttons */}
                    <div
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        display: "flex",
                        gap: 4
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setLightboxImg(snap)}
                        title="View Fullscreen"
                        style={{
                          background: "rgba(15, 23, 42, 0.75)",
                          border: "none",
                          color: "#ffffff",
                          borderRadius: 4,
                          padding: 4,
                          cursor: "pointer",
                          display: "flex"
                        }}
                      >
                        <Maximize2 size={12} />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(snap)}
                        title="Delete Key Image"
                        style={{
                          background: "rgba(225, 29, 72, 0.85)",
                          border: "none",
                          color: "#ffffff",
                          borderRadius: 4,
                          padding: 4,
                          cursor: "pointer",
                          display: "flex"
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Caption & Insert controls */}
                  <div style={{ padding: 8, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                        <input
                          type="text"
                          value={editCaptionText}
                          onChange={(e) => setEditCaptionText(e.target.value)}
                          style={{
                            flex: 1,
                            fontSize: 10,
                            padding: "2px 4px",
                            borderRadius: 4,
                            border: "1px solid #0284c7",
                            outline: "none"
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveCaption(snap)}
                          style={{ background: "#10b981", color: "#ffffff", border: "none", borderRadius: 4, padding: "2px 6px", cursor: "pointer", display: "flex" }}
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "#334155",
                          marginBottom: 6,
                          lineHeight: 1.3,
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between"
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {snap.caption || `Key Image ${idx + 1}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEditCaption(snap)}
                          title="Edit Caption"
                          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", padding: 0, marginLeft: 4 }}
                        >
                          <Edit2 size={10} />
                        </button>
                      </div>
                    )}

                    {onInsertToEditor && (
                      <button
                        type="button"
                        onClick={() => onInsertToEditor(snap)}
                        style={{
                          width: "100%",
                          padding: "4px 0",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          border: "1px solid #0284c7",
                          background: "#e0f2fe",
                          color: "#0369a1",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 4
                        }}
                      >
                        <FileText size={11} /> Cite in Report
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxImg && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20
          }}
          onClick={() => setLightboxImg(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "90vw",
              maxHeight: "90vh",
              background: "#000000",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxImg(null)}
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                background: "rgba(255,255,255,0.2)",
                border: "none",
                color: "#ffffff",
                borderRadius: "50%",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer"
              }}
            >
              <X size={18} />
            </button>
            <img
              src={lightboxImg.preview_url || lightboxImg.previewUrl || lightboxImg.url || lightboxImg.dataUrl}
              alt="Full Resolution Key Image"
              style={{ maxWidth: "100%", maxHeight: "80vh", display: "block" }}
            />
            <div style={{ padding: "12px 16px", background: "#0f172a", color: "#ffffff", fontSize: 12, fontWeight: 600 }}>
              {lightboxImg.caption}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
