import React, { useState } from "react";
import { Image as ImageIcon, Trash2, Plus, FileText, Maximize2, X, Edit2, Check } from "lucide-react";
import api from "../../api/axios";

export default function KeyImageGallery({
  studyUID,
  attachedSnapshots = [],
  setAttachedSnapshots,
  onOpenPicker,
  onAttachActiveSlice,
  onInsertToEditor
}) {
  const [lightboxImg, setLightboxImg] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editCaptionText, setEditCaptionText] = useState("");

  const handleDelete = async (snap) => {
    const targetId = snap.db_id || snap.id;
    if (studyUID && targetId) {
      try {
        await api.delete(`/api/pacs/v1/studies/${encodeURIComponent(studyUID)}/key-images/${encodeURIComponent(targetId)}`);
      } catch (err) {
        console.warn("Failed deleting key image from backend DB:", err.message);
      }
    }

    const updated = attachedSnapshots.filter(s => (s.id !== snap.id && s.db_id !== snap.db_id && s.preview_url !== snap.preview_url));
    setAttachedSnapshots(updated);

    if (studyUID) {
      try {
        localStorage.setItem(`key_images_${studyUID}`, JSON.stringify(updated));
      } catch (e) {
        // ignore localStorage errors
      }
    }
  };

  const startEditCaption = (snap) => {
    setEditingId(snap.id || snap.db_id);
    setEditCaptionText(snap.caption || "");
  };

  const saveCaption = (snap) => {
    const updated = attachedSnapshots.map(s => {
      if ((s.id && s.id === snap.id) || (s.db_id && s.db_id === snap.db_id)) {
        return { ...s, caption: editCaptionText };
      }
      return s;
    });
    setAttachedSnapshots(updated);
    setEditingId(null);
    if (studyUID) {
      try {
        localStorage.setItem(`key_images_${studyUID}`, JSON.stringify(updated));
      } catch (e) {
        // ignore localStorage errors
      }
    }
  };

  return (
    <div style={{ background: "#ffffff", borderRadius: 12, border: "1px solid #cbd5e1", overflow: "hidden", marginTop: 16 }}>
      {/* Header Bar */}
      <div
        style={{
          padding: "12px 16px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ImageIcon size={18} color="#38bdf8" />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em" }}>
            KEY DIAGNOSTIC IMAGES ATTACHED ({attachedSnapshots.length})
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              onClick={onAttachActiveSlice}
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
            >
              <Plus size={13} /> Attach Active Slice
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
                          onClick={() => saveCaption(snap)}
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
