import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import MainLayout from "../../layout/MainLayout";
import api from "../../api/axios";
import { ShieldCheck, Download, FileText, CheckCircle2, XCircle, LogOut, ExternalLink, Calendar, Filter } from "lucide-react";
import "./AuditLogs.css";

const AUDIT_FILTER_CACHE_KEY = "audit_log_filters";

function getTodayYmd() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentSessionId() {
  try {
    const user = JSON.parse(sessionStorage.getItem("user") || "null");
    return user?.session_id || "";
  } catch {
    return "";
  }
}

function toCsv(rows) {
  const headers = [
    "created_at",
    "username",
    "role",
    "session_id",
    "event",
    "page",
    "ip_address",
    "user_agent",
    "details",
  ];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = rows.map((r) =>
    [
      r.created_at,
      r.username,
      r.role,
      r.session_id,
      r.event,
      r.page,
      r.ip_address,
      r.user_agent,
      JSON.stringify(r.details || {}),
    ]
      .map(esc)
      .join(",")
  );
  return [headers.join(","), ...body].join("\n");
}

function formatPageLink(page) {
  if (!page) return "-";
  let targetPath = page;
  let label = page;

  if (page.includes("/patient-list")) {
    targetPath = "/patient-list";
    label = "👥 Patient List";
  } else if (page.includes("/scheduling")) {
    targetPath = "/scheduling";
    label = "📅 Scheduling";
  } else if (page.includes("/reporting") || page.includes("/report")) {
    targetPath = "/reporting";
    label = "📄 Reporting";
  } else if (page.includes("/billing")) {
    targetPath = "/billing";
    label = "💵 Billing";
  } else if (page.includes("/mwls")) {
    targetPath = "/mwls";
    label = "🩻 MWLS Engine";
  } else if (page.includes("/pacspage")) {
    targetPath = "/pacspage";
    label = "🖼️ PACS Viewer";
  } else if (page.includes("/doctor-portal")) {
    targetPath = "/doctor-portal";
    label = "👨‍⚕️ Doctor Portal";
  } else if (page.includes("/admin/users")) {
    targetPath = "/admin/users";
    label = "⚙️ User Management";
  } else if (page.includes("/admin/clinics")) {
    targetPath = "/admin/clinics";
    label = "⚙️ Clinic Branches";
  } else if (page.includes("/admin/hospitals")) {
    targetPath = "/admin/hospitals";
    label = "⚙️ Hospital Groups";
  } else if (page.includes("/admin/prices")) {
    targetPath = "/admin/prices";
    label = "⚙️ Tariff Rates";
  }

  return (
    <Link to={targetPath} className="audit-page-link" title={`Navigate to ${label}`}>
      {label} <ExternalLink size={10} />
    </Link>
  );
}

function formatEventBadge(event) {
  const ev = String(event || "").toUpperCase();
  if (ev.includes("LOGIN_SUCCESS") || ev.includes("AUTH_SUCCESS")) {
    return <span className="audit-event-badge login-success">🟢 LOGIN_SUCCESS</span>;
  }
  if (ev.includes("LOGIN_FAIL") || ev.includes("AUTH_FAIL")) {
    return <span className="audit-event-badge login-failed">🔴 LOGIN_FAILED</span>;
  }
  if (ev.includes("LOGOUT")) {
    return <span className="audit-event-badge logout">🚪 LOGOUT</span>;
  }
  return <span className="audit-event-badge action">⚡ {ev}</span>;
}

export default function AuditLogs() {
  const [, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    username: "",
    ip: "",
    from: getTodayYmd(),
    to: getTodayYmd(),
    limit: 30,
  });
  const [offset, setOffset] = useState(0);
  const [paging, setPaging] = useState({ total: 0, has_next: false });
  const [summaryCounts, setSummaryCounts] = useState({
    total: 0,
    login_success: 0,
    login_failed: 0,
    logout: 0,
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [archiveInfo, setArchiveInfo] = useState({ found: false, file_path: "", log_date: "" });
  const [hasSearched, setHasSearched] = useState(false);

  const fetchLogs = useCallback(async (nextOffset = offset, activeFilters = filters, markSearched = true) => {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (markSearched) params.set("searched", "1");
      params.set("limit", String(activeFilters.limit || 200));
      params.set("offset", String(nextOffset || 0));
      if (activeFilters.username.trim()) params.set("username", activeFilters.username.trim());
      if (activeFilters.ip.trim()) params.set("ip", activeFilters.ip.trim());
      if (activeFilters.from.trim()) params.set("from", activeFilters.from.trim());
      if (activeFilters.to.trim()) params.set("to", activeFilters.to.trim());

      setSearchParams(params, { replace: true });
      const res = await api.get(`/api/audit/logs?${params.toString()}`);
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      setArchiveInfo({
        found: Boolean(res.data?.archive?.found),
        file_path: res.data?.archive?.file_path || "",
        log_date: res.data?.archive?.log_date || "",
      });
      setLogs(rows);
      setOffset(nextOffset || 0);
      const apiTotal = Number(res.data?.paging?.total);
      const fallbackTotal = (nextOffset || 0) + rows.length;
      setPaging({
        total: Number.isFinite(apiTotal) ? Math.max(apiTotal, fallbackTotal) : fallbackTotal,
        has_next:
          typeof res.data?.paging?.has_next === "boolean"
            ? res.data.paging.has_next
            : rows.length === 30,
      });
      setSummaryCounts({
        total: Number(res.data?.summary?.total || 0),
        login_success: Number(res.data?.summary?.login_success || 0),
        login_failed: Number(res.data?.summary?.login_failed || 0),
        logout: Number(res.data?.summary?.logout || 0),
      });
    } catch (err) {
      console.error("Fetch audit logs failed:", err);
      setError(err.response?.data?.message || "Failed to fetch audit logs");
    } finally {
      setLoading(false);
    }
  }, [filters, offset, setSearchParams]);

  useEffect(() => {
    const currentSessionId = getCurrentSessionId();

    const urlParams = new URLSearchParams(window.location.search);
    const urlUsername = urlParams.get("username") || "";
    const urlIp = urlParams.get("ip") || "";
    const urlFrom = urlParams.get("from") || "";
    const urlTo = urlParams.get("to") || "";
    const urlSearched = urlParams.get("searched") === "1";
    if (urlSearched) {
      const nextFilters = {
        username: urlUsername,
        ip: urlIp,
        from: urlFrom || getTodayYmd(),
        to: urlTo || getTodayYmd(),
        limit: 30,
      };
      setFilters(nextFilters);
      setOffset(0);
      setHasSearched(true);
      fetchLogs(0, nextFilters, true);
      return;
    }

    try {
      const raw = sessionStorage.getItem(AUDIT_FILTER_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.session_id && currentSessionId && parsed.session_id !== currentSessionId) {
        sessionStorage.removeItem(AUDIT_FILTER_CACHE_KEY);
      }
      const canRestore =
        parsed &&
        parsed.filters &&
        parsed.hasSearched &&
        (!parsed.session_id || !currentSessionId || parsed.session_id === currentSessionId);
      if (canRestore) {
        const nextFilters = {
          username: parsed.filters?.username || "",
          ip: parsed.filters?.ip || "",
          from: parsed.filters?.from || getTodayYmd(),
          to: parsed.filters?.to || getTodayYmd(),
          limit: 30,
        };
        const nextOffset = Number(parsed.offset || 0);
        setFilters(nextFilters);
        setOffset(nextOffset);
        setHasSearched(true);
        setTimeout(() => {
          fetchLogs(nextOffset, nextFilters, true);
        }, 0);
        return;
      }
    } catch (err) {
      console.warn("Failed to restore audit filter cache", err);
    }

    setHasSearched(false);
    setFilters({
      username: "",
      ip: "",
      from: getTodayYmd(),
      to: getTodayYmd(),
      limit: 30,
    });
    setOffset(0);
    setLogs([]);
    setPaging({ total: 0, has_next: false });
    setSummaryCounts({
      total: 0,
      login_success: 0,
      login_failed: 0,
      logout: 0,
    });
    setSearchParams({}, { replace: true });
  }, []);

  useEffect(() => {
    if (!autoRefresh || logs.length === 0 || !filters.username.trim() || !hasSearched) return;
    const timer = setInterval(() => {
      fetchLogs(offset, filters);
    }, Math.max(5, Number(refreshSec) || 10) * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshSec, fetchLogs, offset, logs.length, filters]);

  const pageStats = useMemo(() => {
    const stats = {
      totalRows:
        Number(summaryCounts.total || 0) > 0
          ? Number(summaryCounts.total || 0)
          : Math.max(paging.total || 0, offset + logs.length),
      loginSuccess: Number(summaryCounts.login_success || 0),
      loginFailed: Number(summaryCounts.login_failed || 0),
      logout: Number(summaryCounts.logout || 0),
    };
    return stats;
  }, [summaryCounts, paging.total, offset, logs.length]);

  const currentPage = Math.floor(offset / filters.limit) + 1;
  const totalPages = Math.max(1, Math.ceil((paging.total || 0) / filters.limit));

  const exportCsv = async () => {
    try {
      setExporting(true);
      const chunkSize = 1000;
      let nextOffset = 0;
      let hasNext = true;
      const allRows = [];

      while (hasNext) {
        const params = new URLSearchParams();
        params.set("limit", String(chunkSize));
        params.set("offset", String(nextOffset));
        if (filters.username.trim()) params.set("username", filters.username.trim());
        if (filters.ip.trim()) params.set("ip", filters.ip.trim());
        if (filters.from.trim()) params.set("from", filters.from.trim());
        if (filters.to.trim()) params.set("to", filters.to.trim());

        const res = await api.get(`/api/audit/logs?${params.toString()}`);
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        allRows.push(...rows);

        if (typeof res.data?.paging?.has_next === "boolean") {
          hasNext = res.data.paging.has_next;
        } else {
          hasNext = rows.length === chunkSize;
        }
        nextOffset += chunkSize;
      }

      const csvRows = allRows.length ? allRows : logs;
      const csv = toCsv(csvRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export CSV failed:", err);
      alert("Failed to export full audit logs.");
    } finally {
      setExporting(false);
    }
  };

  const applyFilters = () => {
    const today = getTodayYmd();
    const normalizedFilters = {
      ...filters,
      from: filters.from?.trim() || today,
      to: filters.to?.trim() || today,
      limit: 30,
    };

    setError("");
    setFilters(normalizedFilters);

    const nextOffset = 0;
    const payload = {
      session_id: getCurrentSessionId(),
      offset: nextOffset,
      hasSearched: true,
      filters: {
        username: normalizedFilters.username || "",
        ip: normalizedFilters.ip || "",
        from: normalizedFilters.from || "",
        to: normalizedFilters.to || "",
      },
    };
    sessionStorage.setItem(AUDIT_FILTER_CACHE_KEY, JSON.stringify(payload));
    setHasSearched(true);
    fetchLogs(nextOffset, normalizedFilters, true);
  };

  const clearFilters = () => {
    const resetFilters = {
      username: "",
      ip: "",
      from: "",
      to: "",
      limit: 30,
    };
    setFilters(resetFilters);
    setOffset(0);
    setError("");
    setArchiveInfo({ found: false, file_path: "", log_date: "" });
    setSearchParams({}, { replace: true });
    sessionStorage.removeItem(AUDIT_FILTER_CACHE_KEY);
    setHasSearched(false);
    setLogs([]);
    setPaging({ total: 0, has_next: false });
    setSummaryCounts({
      total: 0,
      login_success: 0,
      login_failed: 0,
      logout: 0,
    });
  };

  const downloadDateTxt = () => {
    const date = (filters.from || "").trim();
    const to = (filters.to || "").trim();
    if (!date || !to) {
      alert("Select From and To date to download TXT.");
      return;
    }
    const params = new URLSearchParams();
    params.set("from", date);
    params.set("to", to);
    if ((filters.username || "").trim()) params.set("username", filters.username.trim());
    if ((filters.ip || "").trim()) params.set("ip", filters.ip.trim());
    const url = `${api.defaults.baseURL}/api/audit/archives/download?${params.toString()}`;
    window.open(url, "_blank");
  };

  useEffect(() => {
    const payload = {
      session_id: getCurrentSessionId(),
      offset,
      hasSearched,
      filters: {
        username: filters.username || "",
        ip: filters.ip || "",
        from: filters.from || "",
        to: filters.to || "",
      },
    };
    sessionStorage.setItem(AUDIT_FILTER_CACHE_KEY, JSON.stringify(payload));
  }, [filters.username, filters.ip, filters.from, filters.to, offset]);

  return (
    <MainLayout>
      <div className="audit-page">
        {/* HEADER HERO BAR */}
        <header className="audit-header">
          <div className="audit-title-box">
            <div className="audit-icon-wrapper">
              <ShieldCheck size={24} />
            </div>
            <div>
              <span className="audit-badge">Compliance & Security Ledger</span>
              <h1 className="audit-title">System Audit Trail & Security Logs</h1>
              <p className="audit-subtitle">
                Monitor user login activity, authentication events, multi-tenant clinic actions, and system data access trails.
              </p>
            </div>
          </div>

          <div className="audit-actions">
            <button className="audit-action-btn primary" onClick={exportCsv} disabled={!logs.length || exporting}>
              <Download size={14} /> {exporting ? "Exporting..." : "Export CSV"}
            </button>
            <label className="audit-auto">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto Refresh
            </label>
            <select
              className="audit-select-timer"
              value={refreshSec}
              onChange={(e) => setRefreshSec(Number(e.target.value) || 10)}
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>
        </header>

        {/* KPI SUMMARY STATS STRIP */}
        <div className="audit-stats-grid">
          <div className="audit-stat-card">
            <div className="audit-stat-icon indigo">
              <FileText size={20} />
            </div>
            <div>
              <div className="audit-stat-value">{pageStats.totalRows}</div>
              <div className="audit-stat-label">Total Logged Events</div>
            </div>
          </div>

          <div className="audit-stat-card">
            <div className="audit-stat-icon emerald">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <div className="audit-stat-value">{pageStats.loginSuccess}</div>
              <div className="audit-stat-label">Successful Logins</div>
            </div>
          </div>

          <div className="audit-stat-card">
            <div className="audit-stat-icon rose">
              <XCircle size={20} />
            </div>
            <div>
              <div className="audit-stat-value">{pageStats.loginFailed}</div>
              <div className="audit-stat-label">Failed Auth Attempts</div>
            </div>
          </div>

          <div className="audit-stat-card">
            <div className="audit-stat-icon slate">
              <LogOut size={20} />
            </div>
            <div>
              <div className="audit-stat-value">{pageStats.logout}</div>
              <div className="audit-stat-label">Session Logouts</div>
            </div>
          </div>
        </div>

        {/* FILTER TOOLBAR CARD */}
        <div className="audit-filter-card">
          <div className="audit-filters">
            <input
              placeholder="🔍 Search username..."
              value={filters.username}
              onChange={(e) => setFilters((p) => ({ ...p, username: e.target.value }))}
            />
            <input
              placeholder="🌐 Search IP address..."
              value={filters.ip}
              onChange={(e) => setFilters((p) => ({ ...p, ip: e.target.value }))}
            />
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
            />
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
            />
            <button onClick={applyFilters} disabled={loading} className="audit-filter-btn primary">
              <Filter size={13} className="inline mr-1" /> Apply Filter
            </button>
            <button onClick={clearFilters} disabled={loading} className="audit-filter-btn">
              Clear
            </button>
            <button onClick={downloadDateTxt} disabled={loading} className="audit-filter-btn" title="Download Archive TXT">
              <Download size={13} className="inline mr-1" /> TXT
            </button>
          </div>
        </div>

        {error && <div className="audit-error">{error}</div>}
        {!error && archiveInfo.found && (
          <div className="audit-error" style={{ background: "#e0f2fe", color: "#0369a1", borderColor: "#bae6fd", padding: 12, borderRadius: 12, marginBottom: 16 }}>
            Archived logs loaded for {archiveInfo.log_date}. File: {archiveInfo.file_path}
          </div>
        )}

        {/* AUDIT LOG TABLE CARD */}
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Session ID</th>
                <th>Security Event</th>
                <th>Target Page</th>
                <th>IP Address</th>
                <th>Event Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' }}>
                    <Calendar size={12} className="inline mr-1 text-slate-400" />
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td>
                    <strong style={{ color: '#0f172a' }}>{row.username || "-"}</strong>
                  </td>
                  <td>
                    <span style={{ fontSize: 11, fontWeight: 700, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                      {row.role || "-"}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>
                    {row.session_id ? row.session_id.slice(0, 14) + "..." : "-"}
                  </td>
                  <td>{formatEventBadge(row.event)}</td>
                  <td>{formatPageLink(row.page)}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: '#4338ca' }}>
                    {row.ip_address || "-"}
                  </td>
                  <td>
                    <div className="audit-details-box">
                      {JSON.stringify(row.details || {})}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontWeight: 600 }}>
                    No audit logs matching selected filters. Select a date range or username and click "Apply Filter".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION ROW */}
        <div className="audit-pagination">
          <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>
            Page {currentPage} of {totalPages} ({pageStats.totalRows} records)
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => fetchLogs(Math.max(0, offset - 30))}
              disabled={loading || offset <= 0}
            >
              Previous
            </button>
            <button
              onClick={() => fetchLogs(offset + 30)}
              disabled={loading || !paging.has_next}
            >
              Next
            </button>
          </div>
        </div>

      </div>
    </MainLayout>
  );
}
