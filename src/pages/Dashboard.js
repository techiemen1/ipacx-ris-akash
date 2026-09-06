import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import api from "../api/axios";
import "./Dashboard.css";
import {
  Activity,
  IndianRupee,
  Clock,
  AlertTriangle,
  Plus,
  Zap,
  ArrowRight,
  TrendingUp,
  FileText,
  Eye,
  ShieldCheck
} from "lucide-react";

function getTodayString() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

export default function Dashboard() {
  const navigate = useNavigate();

  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [stats, setStats] = useState({
    totalReceipts: 48500,
    procedureScans: 68,
    averageTatMinutes: 24,
    criticalTriageCount: 3,
    modalityBreakdown: {
      CT: 28,
      MRI: 18,
      USG: 14,
      XRay: 6,
      Mammography: 2
    },
    paymentBreakdown: {
      UPI: 24500,
      Cash: 12000,
      POS: 8000,
      Insurance: 4000
    }
  });

  const [recentStudies, setRecentStudies] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadDashboardData() {
      setLoading(true);
      try {
        const { data } = await api.get("/api/reports").catch(() => ({ data: [] }));
        if (Array.isArray(data)) {
          setRecentStudies(data.slice(0, 5));
        }
      } catch (err) {
        console.error("Failed to load dashboard statistics:", err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [selectedDate]);

  return (
    <MainLayout>
      <div className="db-container">
        {/* EXECUTIVE HEADER */}
        <header className="db-header">
          <div className="db-title-section">
            <span className="db-tag">iPacx Radiology Command Hub | Enterprise RIS/PACS Diagnostic Operations</span>
            <h1 className="db-title">Radiology Executive Dashboard</h1>
          </div>

          <div className="db-header-actions">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="db-date-input"
            />

            <button onClick={() => navigate("/add-patient")} className="db-btn db-btn-primary">
              <Plus size={16} /> Patient Registration
            </button>
          </div>
        </header>

        {/* SENTINEL AUTONOMOUS STATUS CARD */}
        <div className="db-sentinel-card">
          <div>
            <div className="db-sentinel-title">
              <Zap size={18} className="text-amber-400" /> Autonomous Diagnostic Sentinel Active
            </div>
            <p className="db-sentinel-desc">
              Monitoring MWL DICOM Dispatchers, Auto-Fill SR Engine, UPI Gateways & ABDM Health Records.
            </p>
          </div>

          <div className="db-quick-links">
            <button onClick={() => navigate("/reporting")} className="db-quick-btn">
              Diagnostic Worklist
            </button>
            <button onClick={() => navigate("/pacspage")} className="db-quick-btn">
              PACS Explorer
            </button>
            <button onClick={() => navigate("/billing")} className="db-quick-btn">
              Billing Studio
            </button>
          </div>
        </div>

        {/* KPI METRICS GRID */}
        <div className="db-kpi-grid">
          {/* REVENUE */}
          <div className="db-kpi-card">
            <div className="db-kpi-icon emerald"><IndianRupee /></div>
            <div className="db-kpi-info">
              <span className="db-kpi-label">Today's Receipts</span>
              <span className="db-kpi-value">₹{stats.totalReceipts.toLocaleString()}</span>
              <span className="db-kpi-sub">UPI + Cash + POS Card</span>
            </div>
          </div>

          {/* PROCEDURE SCANS */}
          <div className="db-kpi-card">
            <div className="db-kpi-icon indigo"><Activity /></div>
            <div className="db-kpi-info">
              <span className="db-kpi-label">Procedure Scans</span>
              <span className="db-kpi-value">{stats.procedureScans}</span>
              <span className="db-kpi-sub">CT, MRI, USG, X-Ray, Mammo</span>
            </div>
          </div>

          {/* TAT SLA */}
          <div className="db-kpi-card">
            <div className="db-kpi-icon sky"><Clock /></div>
            <div className="db-kpi-info">
              <span className="db-kpi-label">Average TAT SLA</span>
              <span className="db-kpi-value">{stats.averageTatMinutes} Mins</span>
              <span className="db-kpi-sub">Scan Completion to Sign-off</span>
            </div>
          </div>

          {/* CRITICAL TRIAGE */}
          <div className="db-kpi-card">
            <div className="db-kpi-icon rose"><AlertTriangle /></div>
            <div className="db-kpi-info">
              <span className="db-kpi-label">Critical Triage Alerts</span>
              <span className="db-kpi-value">{stats.criticalTriageCount} Red</span>
              <span className="db-kpi-sub">AI Hemorrhage & Trauma Flags</span>
            </div>
          </div>
        </div>

        {/* MAIN TWO-COLUMN LAYOUT */}
        <div className="db-main-grid">
          {/* LEFT 2-COL: MODALITY BREAKDOWN */}
          <div className="db-card">
            <div className="db-card-title">
              <span>Today's Modality Scan Breakdown</span>
              <span style={{ fontSize: 11, color: '#4338ca', cursor: 'pointer' }} onClick={() => navigate("/pacspage")}>
                View All in PACS Explorer →
              </span>
            </div>

            <div className="db-modality-item">
              <div className="db-modality-info">
                <span>CT Scan ({stats.modalityBreakdown.CT} Scans)</span>
                <span>41%</span>
              </div>
              <div className="db-progress-bg">
                <div className="db-progress-fill ct" style={{ width: '41%' }} />
              </div>
            </div>

            <div className="db-modality-item">
              <div className="db-modality-info">
                <span>MRI ({stats.modalityBreakdown.MRI} Scans)</span>
                <span>26%</span>
              </div>
              <div className="db-progress-bg">
                <div className="db-progress-fill mr" style={{ width: '26%' }} />
              </div>
            </div>

            <div className="db-modality-item">
              <div className="db-modality-info">
                <span>Ultrasound USG ({stats.modalityBreakdown.USG} Scans)</span>
                <span>21%</span>
              </div>
              <div className="db-progress-bg">
                <div className="db-progress-fill us" style={{ width: '21%' }} />
              </div>
            </div>

            <div className="db-modality-item">
              <div className="db-modality-info">
                <span>X-Ray CR/DX ({stats.modalityBreakdown.XRay} Scans)</span>
                <span>9%</span>
              </div>
              <div className="db-progress-bg">
                <div className="db-progress-fill xr" style={{ width: '9%' }} />
              </div>
            </div>

            <div className="db-modality-item">
              <div className="db-modality-info">
                <span>Mammography ({stats.modalityBreakdown.Mammography} Scans)</span>
                <span>3%</span>
              </div>
              <div className="db-progress-bg">
                <div className="db-progress-fill mg" style={{ width: '3%' }} />
              </div>
            </div>
          </div>

          {/* RIGHT 1-COL: RECENT ACTIVITY & REVENUE */}
          <div className="db-card">
            <div className="db-card-title">Recent Reporting Activity</div>
            <div className="db-activity-list">
              {recentStudies.length === 0 ? (
                <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: 20 }}>
                  {loading ? "Loading activity..." : "No recent signed reports today."}
                </div>
              ) : (
                recentStudies.map((item, idx) => (
                  <div key={item.id || idx} className="db-activity-item">
                    <div>
                      <div className="db-activity-name">{item.patient_name || "Patient"}</div>
                      <div className="db-activity-sub">{item.modality || "CT"} • {item.accession_number || "-"}</div>
                    </div>
                    <button
                      onClick={() => navigate(`/report-panel?study=${encodeURIComponent(item.study_uid)}`)}
                      style={{ padding: '4px 8px', borderRadius: 8, background: '#e0e7ff', color: '#4338ca', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                    >
                      View
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
