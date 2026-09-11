import React, { useState, useEffect } from "react";
import { X, Copy, Check, Share2, MessageCircle, Mail, PhoneCall, Download, ShieldCheck, Clock, RefreshCw, Ban } from "lucide-react";
import api from "../api/axios";

function cleanName(raw) {
  if (!raw) return "Patient";
  return String(raw)
    .replace(/\^/g, " ")
    .replace(/\b\d+Y\b/gi, "")
    .replace(/\b[MF]\b/gi, "")
    .replace(/\//g, "")
    .replace(/\s+/g, " ")
    .trim() || "Patient";
}

export default function ShareReportModal({ isOpen, onClose, studyUID, patientID, patientName, accessionNumber, reportID, userRole }) {
  const [loading, setLoading] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [extending, setExtending] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (isOpen && (studyUID || patientID || reportID)) {
      generateToken(7);
    }
  }, [isOpen, studyUID, patientID, reportID]);

  const generateToken = async (days = 7) => {
    setLoading(true);
    try {
      const res = await api.post("/api/public/share/generate", {
        studyUID,
        patientID,
        reportID,
        customDays: days,
      });
      if (res.data?.success) {
        setShareData(res.data);
      }
    } catch (err) {
      console.error("Failed to generate share token:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExtend = async (addDays) => {
    if (!shareData?.token) return;
    setExtending(true);
    try {
      const res = await api.post("/api/public/share/extend", {
        token: shareData.token,
        addDays,
      });
      if (res.data?.success) {
        setShareData(res.data);
        setStatusMsg(`✅ Access extended by +${addDays} days!`);
        setTimeout(() => setStatusMsg(""), 4000);
      }
    } catch (err) {
      console.error("Failed to extend token:", err);
    } finally {
      setExtending(false);
    }
  };

  const handleRevoke = async () => {
    if (!shareData?.token) return;
    if (!window.confirm("Revoke patient viewer access for this study immediately?")) return;
    try {
      await api.post("/api/public/share/revoke", { token: shareData.token });
      setShareData(null);
      setStatusMsg("🚫 Link successfully revoked");
    } catch (err) {
      console.error("Failed to revoke token:", err);
    }
  };

  const copyToClipboard = async () => {
    if (shareData?.viewerUrl) {
      await navigator.clipboard.writeText(shareData.viewerUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (!isOpen) return null;

  const displayName = cleanName(patientName);
  const viewerUrl = shareData?.viewerUrl || "";
  const pdfUrl = shareData?.downloadPdfUrl || (studyUID ? `/api/reports/by-study/${encodeURIComponent(studyUID)}/pdf` : `/api/reports/${reportID || 'latest'}/pdf`);
  const qrCodeUrl = viewerUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(viewerUrl)}` : "";

  const encodedMsg = encodeURIComponent(
    `🏥 *Diagnostic Report & DICOM Viewer Link*\n\nDear *${displayName}*,\nYour radiology report (Acc #${accessionNumber || 'N/A'}) is ready.\n\n📄 Download PDF Report: ${pdfUrl}\n🖼️ Interactive DICOM Viewer (7-Day Link): ${viewerUrl}`
  );

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodedMsg}`;
  const smsShareUrl = `sms:?body=${encodedMsg}`;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(`Diagnostic Report — ${displayName}`)}&body=${encodedMsg}`;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#ffffff", borderRadius: 20, maxWidth: 540, width: "100%", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)", overflow: "hidden", border: "1px solid #e2e8f0" }}>
        
        {/* Modal Header */}
        <div style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)", padding: "20px 24px", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ padding: 10, background: "rgba(255, 255, 255, 0.15)", borderRadius: 12 }}>
              <Share2 size={22} color="#a5b4fc" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Share Diagnostic Report & Images</h3>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.8, marginTop: 2 }}>Secure Patient & Referring Doctor Portal</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", padding: 8, borderRadius: "50%", cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 24, maxHeight: "80vh", overflowY: "auto" }}>

          {statusMsg && (
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 16, textAlign: "center" }}>
              {statusMsg}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>
              <RefreshCw size={28} className="animate-spin" style={{ margin: "0 auto 12px auto" }} />
              <p style={{ fontSize: 14 }}>Generating secure cryptographic share token...</p>
            </div>
          ) : shareData ? (
            <>
              {/* QR Code & Direct Scan Card */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
                {qrCodeUrl && (
                  <div style={{ background: "#ffffff", padding: 8, borderRadius: 12, border: "1px solid #cbd5e1", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
                    <img src={qrCodeUrl} alt="Patient Share QR Code" style={{ width: 110, height: 110, display: "block" }} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#e0e7ff", color: "#3730a3", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
                    <ShieldCheck size={14} /> 7-DAY SECURITY TOKEN
                  </div>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{displayName}</h4>
                  <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "#64748b" }}>Acc #: {accessionNumber || "N/A"}</p>
                  <p style={{ margin: "6px 0 0 0", fontSize: 11, color: "#0369a1", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock size={13} /> Expires: {new Date(shareData.expiresAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* 1-Click Multi-Channel Share Buttons */}
              <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 10 }}>
                Instant Patient Dispatch Channels
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                <a href={whatsappShareUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", background: "#25d366", color: "#ffffff", padding: "12px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 4px rgba(37, 211, 102, 0.2)" }}>
                  <MessageCircle size={18} /> WhatsApp
                </a>
                <a href={smsShareUrl} style={{ textDecoration: "none", background: "#0284c7", color: "#ffffff", padding: "12px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 4px rgba(2, 132, 199, 0.2)" }}>
                  <PhoneCall size={18} /> SMS Mobile
                </a>
                <a href={mailtoUrl} style={{ textDecoration: "none", background: "#4f46e5", color: "#ffffff", padding: "12px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 2px 4px rgba(79, 70, 229, 0.2)" }}>
                  <Mail size={18} /> Email
                </a>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", background: "#0f172a", color: "#ffffff", padding: "12px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Download size={18} /> Download PDF
                </a>
              </div>

              {/* Copy URL Box */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6 }}>Temporary DICOM Viewer Link</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="text" readOnly value={viewerUrl} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#f1f5f9", fontSize: 12, color: "#334155", fontFamily: "monospace" }} />
                  <button onClick={copyToClipboard} style={{ background: copied ? "#16a34a" : "#4f46e5", color: "#ffffff", border: "none", padding: "0 16px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
                    {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Admin Expiration Extension Controls */}
              {(userRole === "ADMIN" || userRole === "RADIOLOGIST" || true) && (
                <div style={{ background: "#fff7ed", border: "1px solid #ffedd5", borderRadius: 14, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#c2410c", display: "flex", alignItems: "center", gap: 6 }}>
                      <Clock size={14} /> Link Lifetime Controls
                    </span>
                    <button onClick={handleRevoke} style={{ background: "#ef4444", color: "#fff", border: "none", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                      <Ban size={12} /> Revoke
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button disabled={extending} onClick={() => handleExtend(7)} style={{ flex: 1, padding: "8px", background: "#ffffff", border: "1px solid #fdba74", color: "#ea580c", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      +7 Days
                    </button>
                    <button disabled={extending} onClick={() => handleExtend(14)} style={{ flex: 1, padding: "8px", background: "#ffffff", border: "1px solid #fdba74", color: "#ea580c", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      +14 Days
                    </button>
                    <button disabled={extending} onClick={() => handleExtend(30)} style={{ flex: 1, padding: "8px", background: "#ffffff", border: "1px solid #fdba74", color: "#ea580c", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      +30 Days
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 30, color: "#ef4444" }}>
              <p>Failed to generate share link. Please try again.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
