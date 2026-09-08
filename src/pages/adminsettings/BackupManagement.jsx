import React, { useState, useEffect } from "react";
import MainLayout from "../../layout/MainLayout";
import api from "../../api/axios";
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  Clock,
  ShieldCheck,
  HardDrive,
  FileArchive,
  CheckCircle,
  AlertTriangle,
  Play
} from "lucide-react";

export default function BackupManagement() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const [schedule, setSchedule] = useState({
    enabled: true,
    frequency: "Daily",
    time: "02:00 AM",
    retentionCount: 30,
    includeMedia: true
  });

  useEffect(() => {
    fetchBackups();
    fetchSchedule();
  }, []);

  const fetchBackups = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.get("/api/backup/list");
      if (res.data?.success) {
        setBackups(res.data.backups || []);
      }
    } catch (err) {
      console.error("Failed to fetch backups:", err);
      setErrorMsg("Unable to load backup history.");
    } finally {
      setLoading(false);
    }
  };

  const fetchSchedule = async () => {
    try {
      const res = await api.get("/api/backup/schedule");
      if (res.data) setSchedule(res.data);
    } catch (err) {
      console.warn("Failed to load schedule:", err.message);
    }
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await api.post("/api/backup/create", { type: "Manual Admin" });
      if (res.data?.success) {
        setStatusMsg(res.data.message || "System backup created successfully!");
        fetchBackups();
      }
    } catch (err) {
      console.error("Backup creation failed:", err);
      setErrorMsg(err.response?.data?.error || "Failed to create backup.");
    } finally {
      setCreating(false);
    }
  };

  const handleDownloadBackup = (filename) => {
    window.open(`/api/backup/download/${encodeURIComponent(filename)}`, "_blank");
  };

  const handleRestoreBackup = async (filename) => {
    if (!window.confirm(`CAUTION: Are you sure you want to restore system from "${filename}"? Current database tables and files will be updated.`)) {
      return;
    }

    setRestoring(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await api.post("/api/backup/restore", { filename });
      if (res.data?.success) {
        setStatusMsg(res.data.message || "System restore completed!");
        fetchBackups();
      }
    } catch (err) {
      console.error("Restore failed:", err);
      setErrorMsg(err.response?.data?.error || "Failed to restore backup.");
    } finally {
      setRestoring(false);
    }
  };

  const handleUploadRestore = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg("Please select a valid .zip backup file first.");
      return;
    }

    if (!window.confirm(`CAUTION: Confirm restoring system state from uploaded archive "${selectedFile.name}"?`)) {
      return;
    }

    setRestoring(true);
    setStatusMsg(null);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("backup_file", selectedFile);

    try {
      const res = await api.post("/api/backup/restore", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      if (res.data?.success) {
        setStatusMsg(res.data.message || "System restore from uploaded file completed!");
        setSelectedFile(null);
        fetchBackups();
      }
    } catch (err) {
      console.error("Upload restore failed:", err);
      setErrorMsg(err.response?.data?.error || "Failed to restore backup file.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <MainLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* EXECUTIVE HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-2xl border border-indigo-900/50 shadow-xl gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-600/30 text-indigo-400 rounded-xl border border-indigo-500/30">
              <Database size={32} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">System Backup & Disaster Recovery Suite</h1>
              <p className="text-xs text-slate-300 mt-1">
                Full-system PostgreSQL database dumps, key image snapshots, and audit trail archiving with instant restore capability.
              </p>
            </div>
          </div>

          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-slate-950 font-bold px-5 py-3 rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all text-sm cursor-pointer whitespace-nowrap"
          >
            {creating ? <RefreshCw size={18} className="animate-spin" /> : <Play size={18} />}
            {creating ? "Generating Backup..." : "Create Instant Backup ZIP"}
          </button>
        </div>

        {/* STATUS MESSAGES */}
        {statusMsg && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 rounded-xl flex items-center gap-3 text-xs font-semibold">
            <CheckCircle size={18} className="text-emerald-400 shrink-0" />
            <span>{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-rose-950/40 border border-rose-500/40 text-rose-300 rounded-xl flex items-center gap-3 text-xs font-semibold">
            <AlertTriangle size={18} className="text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* TOP CARDS: BACKUP STATUS & UPLOAD RESTORE */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CARD 1: DISASTER RESTORE ARCHIVE UPLOAD */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="p-2 bg-amber-100 text-amber-800 rounded-xl">
                <Upload size={20} />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-base">Restore System from External Backup</h2>
                <p className="text-xs text-slate-500">Upload a valid `.zip` backup archive to restore database and media files.</p>
              </div>
            </div>

            <form onSubmit={handleUploadRestore} className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl p-5 text-center transition-colors">
                <FileArchive size={32} className="mx-auto text-slate-400 mb-2" />
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  className="hidden"
                  id="backup-file-input"
                />
                <label htmlFor="backup-file-input" className="cursor-pointer text-xs text-indigo-600 font-bold hover:underline">
                  {selectedFile ? selectedFile.name : "Click to select backup .zip file"}
                </label>
                <p className="text-[11px] text-slate-400 mt-1">Supports iPACX standard ZIP dumps up to 500MB</p>
              </div>

              <button
                type="submit"
                disabled={!selectedFile || restoring}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {restoring ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {restoring ? "Restoring System..." : "Execute System Disaster Restore"}
              </button>
            </form>
          </div>

          {/* CARD 2: AUTOMATED CRON BACKUP SCHEDULE */}
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
                <Clock size={20} />
              </div>
              <div>
                <h2 className="font-bold text-slate-900 text-base">Automated Scheduled Backups</h2>
                <p className="text-xs text-slate-500">Configure background cron execution and archival policies.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium block">Schedule Status</span>
                <span className="font-bold text-emerald-600 flex items-center gap-1 mt-1">
                  <CheckCircle size={14} /> Active Daily Task
                </span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium block">Execution Time</span>
                <span className="font-bold text-slate-900 mt-1 block">02:00 AM (Midnight)</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium block">Retention Policy</span>
                <span className="font-bold text-slate-900 mt-1 block">Keep Last 30 Snapshots</span>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium block">Scope Included</span>
                <span className="font-bold text-indigo-600 mt-1 block">DB Dumps + DICOM Snapshots</span>
              </div>
            </div>
          </div>
        </div>

        {/* BACKUP HISTORY TABLE */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-indigo-600" />
              <h2 className="font-bold text-slate-900 text-sm">Backup Archive History</h2>
              <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full font-bold">
                {backups.length} archives
              </span>
            </div>

            <button
              onClick={fetchBackups}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw size={14} /> Refresh History
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3.5">Filename</th>
                  <th className="px-5 py-3.5">Created At</th>
                  <th className="px-5 py-3.5">Archive Size</th>
                  <th className="px-5 py-3.5">Type</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="text-center py-8 text-slate-400">
                      <RefreshCw size={24} className="animate-spin mx-auto mb-2 text-indigo-500" />
                      Loading backup history...
                    </td>
                  </tr>
                ) : backups.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-8 text-slate-400">
                      No system backups found. Click "Create Instant Backup ZIP" to generate one now.
                    </td>
                  </tr>
                ) : (
                  backups.map((b) => (
                    <tr key={b.id || b.filename} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono font-bold text-slate-900 flex items-center gap-2">
                        <FileArchive size={16} className="text-indigo-500 shrink-0" />
                        {b.filename}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {new Date(b.created_at).toLocaleString("en-IN")}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-slate-800">
                        {b.size_mb} MB
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold text-[10px]">
                          {b.backup_type || "Manual"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-bold text-[10px] flex items-center gap-1 w-max">
                          <CheckCircle size={10} /> {b.status || "Completed"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right space-x-2">
                        <button
                          onClick={() => handleDownloadBackup(b.filename)}
                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Download size={13} /> Download
                        </button>
                        <button
                          onClick={() => handleRestoreBackup(b.filename)}
                          disabled={restoring}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <RefreshCw size={13} /> Restore
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
