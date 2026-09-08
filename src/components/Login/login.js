import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import api from "../../api/axios";
import { 
  ShieldCheck, 
  Lock, 
  User, 
  Eye, 
  EyeOff, 
  Activity, 
  Stethoscope, 
  Building, 
  Sparkles,
  ChevronRight
} from "lucide-react";
import "./login.css";

function Login() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState("ADMIN");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();

    if (!username || !password) {
      alert("Please enter both username and password.");
      return;
    }

    try {
      setLoading(true);

      const res = await api.post("/api/login", { username, password });

      if (!res.data || !res.data.user) {
        alert("Login failed. Invalid response from server.");
        return;
      }

      // Save user context
      login(res.data.user, res.data.token);

      // Navigate to dashboard
      navigate("/dashboard");
    } catch (err) {
      if (err.response?.data?.message) {
        alert(err.response.data.message);
      } else {
        alert("Server connection failed. Ensure backend service is running.");
      }
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const applyPreset = (userVal, passVal, roleVal) => {
    setUsername(userVal);
    setPassword(passVal);
    setSelectedRole(roleVal);
  };

  return (
    <div className="login-container-pro">
      {/* BACKGROUND DECORATIVE GLOWS */}
      <div className="glow-orb orb-1"></div>
      <div className="glow-orb orb-2"></div>

      <div className="login-card-pro">
        {/* LEFT PANEL - BRANDING & RADIOLOGY HERO */}
        <div className="login-left-pro">
          <div className="system-badge">
            <span className="pulse-dot"></span>
            <Activity size={14} className="icon-spin" /> iPacx DICOM & RIS Engine v1.1
          </div>

          <div className="brand-heading">
            <div className="brand-logo-wrapper">
              <Stethoscope size={32} color="#6366f1" />
            </div>
            <h1>iPacx Radiology</h1>
            <p className="brand-sub">Enterprise Diagnostic Imaging & RIS Command Platform</p>
          </div>

          <div className="feature-bullets">
            <div className="bullet-item">
              <div className="bullet-icon"><ShieldCheck size={16} /></div>
              <div>
                <strong>ABDM & HIPAA Compliant</strong>
                <span>Secure multi-tenant data architecture</span>
              </div>
            </div>
            <div className="bullet-item">
              <div className="bullet-icon"><Sparkles size={16} /></div>
              <div>
                <strong>AI Dictation & SR Auto-Fill</strong>
                <span>10+ structured templates per modality</span>
              </div>
            </div>
            <div className="bullet-item">
              <div className="bullet-icon"><Building size={16} /></div>
              <div>
                <strong>Multi-Hospital MWL Sync</strong>
                <span>Live DICOM C-STORE and Orthanc PACS</span>
              </div>
            </div>
          </div>

          <div className="left-footer-status">
            <span>🟢 PACS Gateway: Online</span>
            <span>🟢 Postgres Mirror: Connected</span>
          </div>
        </div>

        {/* RIGHT PANEL - LOGIN FORM */}
        <div className="login-right-pro">
          <div className="form-header-pro">
            <h2>Portal Sign In</h2>
            <p>Access your diagnostic worklist, DICOM viewer, and billing studio</p>
          </div>

          {/* ROLE SELECTOR CHIPS */}
          <div className="role-chips-label">Select Workspace Role</div>
          <div className="role-chips-grid">
            {[
              { role: "ADMIN", label: "Admin", user: "admin", pass: "admin123" },
              { role: "RADIOLOGIST", label: "Radiologist", user: "radiologist", pass: "rad123" },
              { role: "TECHNOLOGIST", label: "Technologist", user: "tech", pass: "tech123" },
              { role: "RECEPTION", label: "Desk / Billing", user: "reception", pass: "desk123" },
            ].map((item) => (
              <button
                key={item.role}
                type="button"
                className={`role-chip ${selectedRole === item.role ? "active" : ""}`}
                onClick={() => applyPreset(item.user, item.pass, item.role)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleLogin} className="login-form-pro">
            <div className="input-group-pro">
              <label>Username / User ID</label>
              <div className="input-field-wrapper">
                <User size={18} className="field-icon" />
                <input
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="input-group-pro">
              <div className="flex-label">
                <label>Password</label>
                <a href="#forgot" onClick={(e) => { e.preventDefault(); alert("Contact system administrator to reset credentials."); }} className="forgot-link">Forgot?</a>
              </div>
              <div className="input-field-wrapper">
                <Lock size={18} className="field-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="eye-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? "Authenticating Session..." : "Access RIS Workspace"}
              {!loading && <ChevronRight size={18} />}
            </button>
          </form>

          {/* DEMO ONE-CLICK LOGIN FOOTER */}
          <div className="demo-login-box">
            <span>Quick Demo Launch:</span>
            <button
              type="button"
              className="demo-pill"
              onClick={() => applyPreset("admin", "admin123", "ADMIN")}
            >
              Fill Admin Credentials
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;
