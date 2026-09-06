import React, { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  CalendarDays,
  ClipboardList,
  Monitor,
  FileText,
  Settings,
  Menu,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Building2,
  Building,
  Sparkles,
  ShieldCheck,
  Palette,
  UserCheck,
  FileCode,
  Radio,
  Tag,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import "./MainLayout.css";
import { getClickLabel, logAuditEvent } from "../utils/auditClient";
import { useClinic } from "../context/ClinicContext";

export default function MainLayout({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = sessionStorage.getItem("sidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });

  // Palette Accent Theme: "blue" | "green" | "pink" | "yellow"
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("risTheme") || "blue";
  });

  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showUserInfo, setShowUserInfo] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const { user, logout } = useAuth();
  const { clinics, activeClinic, switchClinic } = useClinic() || {};
  const navigate = useNavigate();
  const location = useLocation();

  const username = user?.username || "Doctor";
  const role = user?.role || "RADIOLOGIST";

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  useEffect(() => {
    sessionStorage.setItem("sidebarCollapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem("risTheme", theme);
  }, [theme]);

  useEffect(() => {
    if (location.pathname.startsWith("/admin")) {
      setShowAdminMenu(true);
    }
  }, [location.pathname]);

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  const menuItems = [
    { name: "Dashboard", icon: <LayoutDashboard size={19} />, path: "/dashboard" },
    { name: "Patient List", icon: <Users size={19} />, path: "/patient-list" },
    { name: "Billing", icon: <CreditCard size={19} />, path: "/billing" },
    { name: "Scheduling", icon: <CalendarDays size={19} />, path: "/scheduling" },
    { name: "Modality WorkList", icon: <ClipboardList size={19} />, path: "/mwls" },
    { name: "PACS Page", icon: <Monitor size={19} />, path: "/pacspage" },
    { name: "Reporting", icon: <FileText size={19} />, path: "/reporting" },
    { name: "Doctor Portal", icon: <Users size={19} />, path: "/doctor-portal" },
  ];

  useEffect(() => {
    if (!user) return;
    if (location.pathname.startsWith("/admin/audit-logs")) return;
    logAuditEvent("PAGE_VIEW", { pathname: location.pathname });
  }, [location.pathname, user]);

  useEffect(() => {
    if (!user) return;

    const handler = (evt) => {
      if (window.location.pathname.startsWith("/admin/audit-logs")) return;
      const node = evt.target?.closest?.("button, a, [role='button']");
      if (!node) return;
      const label = getClickLabel(node);
      logAuditEvent("CLICK", {
        label: label || "unknown",
        tag: node.tagName || "",
      });
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [user]);

  function getInitials(name) {
    if (!name || typeof name !== "string") return "DR";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  return (
    <div className={`ris-layout theme-${theme}`}>
      {/* MOBILE HEADER */}
      <header className="ris-mobile-header">
        <div className="ris-brand-logo">
          <span className="brand-dot" />
          <span className="brand-title">iPacx<span className="brand-highlight">-RIS</span></span>
        </div>
        <button 
          className="mobile-menu-toggle" 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          <Menu size={24} />
        </button>
      </header>

      {/* SIDEBAR */}
      <aside className={`ris-sidebar ${collapsed ? "collapsed" : ""} ${isMobileMenuOpen ? "open" : ""}`}>
        {/* MOBILE CLOSE OVERLAY */}
        {isMobileMenuOpen && (
          <div className="sidebar-overlay" onClick={() => setIsMobileMenuOpen(false)} />
        )}

        {/* SIDEBAR HEADER / BRANDING */}
        <div className="ris-sidebar-header">
          {!collapsed ? (
            <div className="ris-brand-box">
              <div className="ris-logo-badge">
                <Sparkles size={18} className="logo-sparkle" />
              </div>
              <div className="ris-brand-details">
                <span className="brand-title">iPacx<span className="brand-highlight">-RIS</span></span>
                <span className="brand-subtitle">v1.1 Enterprise • PACS</span>
              </div>
            </div>
          ) : (
            <div className="ris-logo-badge collapsed">
              <Sparkles size={18} />
            </div>
          )}

          <button
            className="ris-toggle-btn"
            onClick={toggleSidebar}
            title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* COLOR PALETTE THEME SELECTOR CHIPS */}
        {!collapsed && (
          <div className="ris-theme-card">
            <div className="ris-theme-header">
              <Palette size={13} />
              <span>Accent Theme</span>
            </div>
            <div className="ris-theme-chips">
              <button
                onClick={() => setTheme("blue")}
                className={`theme-chip blue ${theme === "blue" ? "active" : ""}`}
                title="Light Blue Theme"
              />
              <button
                onClick={() => setTheme("green")}
                className={`theme-chip green ${theme === "green" ? "active" : ""}`}
                title="Light Green Theme"
              />
              <button
                onClick={() => setTheme("pink")}
                className={`theme-chip pink ${theme === "pink" ? "active" : ""}`}
                title="Light Pink Theme"
              />
              <button
                onClick={() => setTheme("yellow")}
                className={`theme-chip yellow ${theme === "yellow" ? "active" : ""}`}
                title="Sun Yellow Theme"
              />
            </div>
          </div>
        )}

        {/* MAIN NAVIGATION MENU */}
        <nav className="ris-menu">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <div key={item.name} className="ris-menu-item-wrapper">
                <Link
                  to={item.path}
                  className={`ris-menu-item ${isActive ? "active" : ""}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <span className="item-icon-box">{item.icon}</span>
                  {!collapsed && <span className="item-label">{item.name}</span>}
                  {isActive && !collapsed && <span className="active-indicator-bar" />}
                </Link>
                {collapsed && <div className="ris-tooltip">{item.name}</div>}
              </div>
            );
          })}

          {/* ADMIN MENU */}
          {role === "ADMIN" && (
            <div className="ris-menu-item-wrapper">
              <button
                type="button"
                className={`ris-menu-item ris-admin-toggle ${location.pathname.startsWith("/admin") ? "active" : ""} ${showAdminMenu ? "expanded" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAdminMenu(!showAdminMenu);
                }}
              >
                <span className="item-icon-box"><Settings size={19} /></span>
                {!collapsed && <span className="item-label">Admin Settings</span>}
                {!collapsed && (
                  <span className="admin-arrow-box">
                    {showAdminMenu ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                )}
              </button>
              {collapsed && <div className="ris-tooltip">Admin Settings</div>}

              {showAdminMenu && (
                <div className={`ris-admin-submenu ${collapsed ? "collapsed" : ""}`}>
                  {[
                    { name: "User Management", path: "/admin/user-management", icon: <UserCheck size={14} /> },
                    { name: "Template Studio", path: "/admin/templates", icon: <FileCode size={14} /> },
                    { name: "MWLS & PACS Gateway", path: "/admin/mwls-management", icon: <Radio size={14} /> },
                    { name: "Audit Logs", path: "/admin/audit-logs", icon: <ShieldCheck size={14} /> },
                    { name: "Price Management", path: "/admin/prices", icon: <Tag size={14} /> },
                  ].map((sub) => {
                    const isSubActive = location.pathname === sub.path;
                    return (
                      <Link
                        key={sub.path}
                        to={sub.path}
                        className={`admin-sub-item ${isSubActive ? "active" : ""}`}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <span className="sub-icon">{sub.icon}</span>
                        <span className="sub-name">{sub.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </nav>

        {/* USER PROFILE & DEDICATED LOGOUT FOOTER */}
        <div className="ris-user-card">
          <div className="ris-user-profile" onClick={() => !collapsed && setShowUserInfo(!showUserInfo)}>
            <div className="user-avatar">{getInitials(username)}</div>
            {!collapsed && (
              <div className="user-info-text">
                <span className="user-name">{username}</span>
                <span className="user-role"><ShieldCheck size={11} /> {role}</span>
              </div>
            )}
          </div>

          {!collapsed && showUserInfo && (
            <div className="ris-user-dropdown">
              <div className="dropdown-row">
                <span className="dropdown-label">System Role:</span>
                <span className="dropdown-val">{role}</span>
              </div>
            </div>
          )}

          {/* DEDICATED ALWAYS-VISIBLE 1-CLICK LOGOUT BUTTON */}
          <button 
            onClick={handleLogout} 
            className={`ris-logout-btn-direct ${collapsed ? "collapsed" : ""}`}
            title="Sign Out of iPACX RIS"
          >
            <LogOut size={16} />
            {!collapsed && <span>Log Out</span>}
          </button>
        </div>
      </aside>

      {/* CONTENT CANVAS */}
      <main className="ris-content">
        {children}
        <footer className="ris-footer">
          © {new Date().getFullYear()} iPacx Healthcare RIS & PACS Engine. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
