import React, { useState, useEffect } from "react";
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hospitalInfo, setHospitalInfo] = useState({
    name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
    header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
    logo_url: "",
    address: "",
    phone: ""
  });

  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const fetchHospitalInfo = async () => {
      try {
        const res = await api.get("/api/public/hospital-info");
        if (isMounted && res.data?.success && res.data?.hospital) {
          setHospitalInfo({
            name: res.data.hospital.name || "AKASH MEDICAL COLLEGE AND HOSPITALS",
            header_text: res.data.hospital.header_text || "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
            logo_url: res.data.hospital.logo_url || "",
            address: res.data.hospital.address || "",
            phone: res.data.hospital.phone || ""
          });
        }
      } catch (err) {
        console.warn("Using default hospital info branding:", err);
      }
    };

    fetchHospitalInfo();
    return () => {
      isMounted = false;
    };
  }, []);

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

      // Save user context (auto-selects assigned role/workspace)
      login(res.data.user, res.data.token);

      // Navigate directly to RIS dashboard
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

  return (
    <div className="login-container-pro">
      {/* BACKGROUND DECORATIVE GLOWS */}
      <div className="glow-orb orb-1"></div>
      <div className="glow-orb orb-2"></div>

      <div className="login-card-pro">
        {/* LEFT PANEL - DYNAMIC HOSPITAL BRANDING & RADIOLOGY HERO */}
        <div className="login-left-pro">
          <div className="system-badge">
            <span className="pulse-dot"></span>
            <Activity size={14} className="icon-spin" /> iPacx DICOM & RIS Engine v1.1
          </div>

          <div className="brand-heading">
            <div className="brand-logo-wrapper">
              {hospitalInfo.logo_url ? (
                <img src={hospitalInfo.logo_url} alt="Hospital Logo" className="hospital-brand-logo-img" />
              ) : (
                <Stethoscope size={32} color="#6366f1" />
              )}
            </div>
            <h1>{hospitalInfo.name}</h1>
            <p className="brand-sub">{hospitalInfo.header_text}</p>
            {hospitalInfo.address && (
              <p className="hospital-meta-address">📍 {hospitalInfo.address} {hospitalInfo.phone ? `| 📞 ${hospitalInfo.phone}` : ""}</p>
            )}
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
                <span>Professional medical voice dictation studio</span>
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

        {/* RIGHT PANEL - CLEAN DIRECT LOGIN FORM */}
        <div className="login-right-pro">
          <div className="form-header-pro">
            <h2>Portal Sign In</h2>
            <p>Enter your credentials to access your auto-assigned RIS workspace</p>
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
                  autoComplete="username"
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
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="eye-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? "Authenticating Session..." : "Sign In to RIS"}
              {!loading && <ChevronRight size={18} />}
            </button>
          </form>

          <div className="auto-role-notice">
            <span>🔒 Role & Department automatically configured on sign in</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;

