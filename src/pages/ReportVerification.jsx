import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/axios";
import { ShieldCheck, CheckCircle2, AlertTriangle, Lock } from "lucide-react";

export default function ReportVerification() {
  const [searchParams] = useSearchParams();
  const uid = searchParams.get("uid") || searchParams.get("study_uid");
  
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }

    api.get(`/api/public/verify-report?uid=${encodeURIComponent(uid)}`)
      .then((res) => {
        setData(res.data);
      })
      .catch((err) => {
        console.error("Verification fetch error:", err);
      })
      .finally(() => setLoading(false));
  }, [uid]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
      color: "#ffffff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      padding: "24px 16px",
      display: "flex",
      justifyContent: "center",
      alignItems: "center"
    }}>
      <div style={{
        maxWidth: 580,
        width: "100%",
        background: "rgba(255, 255, 255, 0.98)",
        color: "#0f172a",
        borderRadius: 24,
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        overflow: "hidden"
      }}>
        {/* HEADER BRANDING */}
        <div style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          color: "#ffffff",
          padding: "28px 24px",
          textAlign: "center"
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(255, 255, 255, 0.15)",
            padding: "4px 14px",
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 800,
            color: "#a5b4fc",
            marginBottom: 12
          }}>
            <ShieldCheck size={14} color="#34d399" /> ABDM & NABH Digital Verification Gateway
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
            {data?.hospital?.name || "AKASH MEDICAL COLLEGE AND HOSPITALS"}
          </h2>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, fontWeight: 600 }}>
            {data?.hospital?.header_text || "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING"}
          </p>
        </div>

        {/* CONTENT CARD */}
        <div style={{ padding: 24 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#64748b", fontWeight: 700 }}>
              Verifying Cryptographic Digital Signature...
            </div>
          ) : !uid ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#dc2626" }}>
              <AlertTriangle size={36} style={{ display: "block", margin: "0 auto 12px" }} />
              <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 800 }}>Missing Study Identifier</h3>
              <p style={{ fontSize: 13, color: "#64748b" }}>Please scan a valid report QR Code from an official diagnostic report.</p>
            </div>
          ) : data?.verified ? (
            <div>
              {/* SUCCESS BADGE */}
              <div style={{
                background: "#ecfdf5",
                border: "1.5px solid #a7f3d0",
                borderRadius: 16,
                padding: "16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 20
              }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "#10b981",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0
                }}>
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h4 style={{ margin: "0 0 2px 0", color: "#065f46", fontSize: 15, fontWeight: 800 }}>
                    Official Report Authenticity Confirmed
                  </h4>
                  <span style={{ fontSize: 12, color: "#047857", fontWeight: 600 }}>
                    This document is electronically verified and signed by an authorized Radiologist.
                  </span>
                </div>
              </div>

              {/* REPORT METADATA GRID */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                fontSize: 13,
                background: "#f8fafc",
                padding: 16,
                borderRadius: 14,
                border: "1px solid #e2e8f0"
              }}>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>PATIENT NAME</span>
                  <strong style={{ color: "#0f172a", fontSize: 14 }}>{data.report.patient_name || "-"}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>PATIENT ID / MRN</span>
                  <strong style={{ color: "#0f172a", fontSize: 14 }}>{data.report.patient_id || "-"}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>MODALITY & EXAM</span>
                  <strong style={{ color: "#3b82f6" }}>{data.report.modality} ({data.report.body_part || "Diagnostic"})</strong>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>ACCESSION NO.</span>
                  <strong style={{ color: "#0f172a" }}>{data.report.accession_number || "-"}</strong>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>SIGNED BY RADIOLOGIST</span>
                  <strong style={{ color: "#047857" }}>{data.report.signed_by} ({data.report.qualification})</strong>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, display: "block" }}>REPORT STATUS</span>
                  <span style={{ background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: 6, fontWeight: 800, fontSize: 11 }}>
                    {data.report.status}
                  </span>
                </div>
              </div>

              {/* CRYPTOGRAPHIC SIGNATURE HASH */}
              <div style={{
                marginTop: 16,
                padding: "10px 14px",
                background: "#0f172a",
                borderRadius: 10,
                color: "#94a3b8",
                fontSize: 10,
                fontFamily: "monospace",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <span><Lock size={12} style={{ verticalAlign: "middle", marginRight: 4 }} /> Cryptographic Hash:</span>
                <span style={{ color: "#38bdf8", fontWeight: 700 }}>{data.report.digital_signature_hash}</span>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "30px 0", color: "#64748b" }}>
              <AlertTriangle size={36} color="#eab308" style={{ display: "block", margin: "0 auto 12px" }} />
              <h3 style={{ margin: "0 0 4px", color: "#0f172a", fontSize: 16, fontWeight: 800 }}>Report Pending Verification</h3>
              <p style={{ fontSize: 13, color: "#64748b" }}>{data?.message || "No report found for this study."}</p>
            </div>
          )}

          {/* FOOTER ACCREDITATIONS */}
          <div style={{
            marginTop: 24,
            paddingTop: 14,
            borderTop: "1px solid #e2e8f0",
            textAlign: "center",
            fontSize: 11,
            color: "#64748b",
            fontWeight: 600
          }}>
            🏢 {data?.hospital?.address || "AKASH MEDICAL COLLEGE AND HOSPITALS"} • 📞 {data?.hospital?.phone || ""}
          </div>
        </div>
      </div>
    </div>
  );
}
