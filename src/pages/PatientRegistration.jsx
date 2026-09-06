import React, { useState, useRef, useEffect } from "react";
import "./PatientRegistration.css";
import dayjs from "dayjs";
import { toast } from "react-hot-toast";
import api from "../api/axios";

import {
  User, Phone, Calendar, Activity, FileText,
  CreditCard, CheckCircle, ShieldCheck, Stethoscope,
  Camera, Fingerprint, Printer, X, PlusCircle, Check
} from "lucide-react";

const STEPS = [
  { id: 1, title: "Identity", icon: <ShieldCheck size={16} /> },
  { id: 2, title: "Demographics", icon: <User size={16} /> },
  { id: 3, title: "Clinical", icon: <Stethoscope size={16} /> },
  { id: 4, title: "Workflow", icon: <Activity size={16} /> },
  { id: 5, title: "Billing", icon: <CreditCard size={16} /> },
  { id: 6, title: "Consent & Sign", icon: <FileText size={16} /> },
];

export default function PatientRegistration({ onClose, onSave, initialData = null }) {
  const [step, setStep] = useState(1);
  const canvasRef = useRef(null);
  const bodyRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Lookup State
  const [lookupField, setLookupField] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupMatches, setLookupMatches] = useState([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  // Webcam Camera State
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [facingMode, setFacingMode] = useState("user");
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);

  // Custom Modality State
  const [customModalityInput, setCustomModalityInput] = useState("");
  const [showCustomModality, setShowCustomModality] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    // Identity
    phone: "",
    abha_number: "",
    abha_address: "",
    idType: "AADHAAR",
    idNumber: "",
    voter_id: "",
    biometric_flag: false,
    registration_channel: "DESK",
    photo_url: "",

    // Demographics
    title: "",
    firstName: "",
    lastName: "",
    name: "",
    dob: "",
    age: "",
    gender: "Male",
    relationship_type: "S/O",
    relationship_name: "",
    marital_status: "Single",
    occupation: "",
    nationality: "Indian",
    language_preference: "English",
    address: "",
    email: "",

    // Emergency Contact
    emergency_contact_name: "",
    emergency_contact_phone: "",
    emergency_contact_relation: "",
    secondaryContactName: "",
    secondaryContactPhone: "",

    // Clinical & Radiology
    blood_group: "",
    height_cm: "",
    weight_kg: "",
    allergies: "",
    current_medications: "",
    medical_history: "",
    isPregnant: false,
    husband_name: "",
    indication_for_scan: "",
    menstrual_status: "",
    lmp_date: "",
    edd: "",
    gestational_age: "",
    creatinine_level: "",
    contrast_safety_flag: true,
    modalities: [],
    custom_modality: "",
    study_type: "",

    // Workflow
    patient_type: "OPD",
    visit_type: "NEW",
    department: "General Radiology",
    referring_doctor: "",
    ward_room_bed: "",

    // Billing & Payment Details
    billing_category: "Self-Pay",
    bill_amount: 1500,
    discount_amount: 0,
    tax_amount: 0,
    grand_total: 1500,
    payment_status: "PAID",
    payment_method: "UPI_SCAN",
    insurance_provider: "",
    insurance_id: "",


    // Consent
    consent_image_sharing: true,
    consent_research_ai: true,
    consent_telemedicine: true,
    data_privacy_accepted: true,
    digital_signature: "",
    patient_id: "",
    accession_number: "",
  });

  // Helpers
  const toBool = (v, fallback = false) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["true", "t", "1", "yes", "y"].includes(s)) return true;
      if (["false", "f", "0", "no", "n"].includes(s)) return false;
    }
    return fallback;
  };

  const normalizeMediaSrc = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^(data:|blob:|https?:\/\/)/i.test(raw)) return raw;
    const normalized = raw.replace(/\\/g, "/");
    const base = String(api?.defaults?.baseURL || "").replace(/\/$/, "");
    if (/^\/?uploads\//i.test(normalized)) {
      const path = normalized.startsWith("/") ? normalized : `/${normalized}`;
      return `${base}${path}`;
    }
    return normalized.startsWith("/") ? `${base}${normalized}` : `${base}/${normalized}`;
  };

  const applyPatientToForm = (source) => {
    if (!source) return;
    const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && String(v).trim() !== "");
    const fullName = pick(source.full_name, source.patient_name, source.name, "");
    const modalitiesFromDb = pick(source.modality, source.modalities, "");

    setFormData((prev) => ({
      ...prev,
      phone: pick(source.mobile, source.phone, prev.phone),
      abha_number: pick(source.abha_number, prev.abha_number),
      idType: pick(source.id_type, source.idType, prev.idType),
      idNumber: pick(source.id_number, source.idNumber, prev.idNumber),
      title: pick(source.title, prev.title),
      firstName: pick(source.first_name, fullName.split(" ")[0], prev.firstName),
      lastName: pick(source.last_name, fullName.split(" ").slice(1).join(" "), prev.lastName),
      gender: pick(source.gender, prev.gender),
      dob: source.dob ? dayjs(source.dob).format("YYYY-MM-DD") : prev.dob,
      age: pick(source.age, prev.age),
      relationship_type: pick(source.relationship_type, prev.relationship_type),
      relationship_name: pick(source.relationship_name, prev.relationship_name),
      marital_status: pick(source.marital_status, prev.marital_status),
      occupation: pick(source.occupation, prev.occupation),
      nationality: pick(source.nationality, prev.nationality),
      address: pick(source.address, source.address_line1, prev.address),
      email: pick(source.email, prev.email),
      modalities: modalitiesFromDb ? String(modalitiesFromDb).split(",").map((m) => m.trim()).filter(Boolean) : prev.modalities,
      study_type: pick(source.study_type, source.study, prev.study_type),
      referring_doctor: pick(source.referring_doctor, prev.referring_doctor),
      patient_id: pick(source.uhid, source.patient_id, source.mrn, prev.patient_id),
      photo_url: normalizeMediaSrc(pick(source.photo_url, prev.photo_url)),
      digital_signature: normalizeMediaSrc(pick(source.digital_signature, source.signature_file, prev.digital_signature)),
    }));
  };

  useEffect(() => {
    if (initialData) applyPatientToForm(initialData);
  }, [initialData]);

  // Webcam Camera Handlers
  const startCamera = async (mode = facingMode) => {
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: mode },
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      console.error("Camera access error:", err);
      toast.error("Unable to access camera stream. Check browser permissions.");
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setShowCameraModal(false);
  };

  const takePhotoSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setFormData((prev) => ({ ...prev, photo_url: dataUrl }));
    toast.success("Photo captured cleanly!");
    stopCamera();
  };

  // Form Field Change Handler
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === "checkbox" ? checked : value;
    setFormData((prev) => ({ ...prev, [name]: val }));
  };

  // Auto calculate Age from DOB
  const handleDobChange = (e) => {
    const dobVal = e.target.value;
    let calculatedAge = formData.age;
    if (dobVal) {
      const birthDate = new Date(dobVal);
      const today = new Date();
      let years = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        years--;
      }
      calculatedAge = years >= 0 ? String(years) : "";
    }
    setFormData((prev) => ({ ...prev, dob: dobVal, age: calculatedAge }));
  };

  // Auto estimate DOB from Age
  const handleAgeChange = (e) => {
    const ageVal = e.target.value;
    let estimatedDob = formData.dob;
    const numAge = parseInt(ageVal, 10);
    if (!isNaN(numAge) && numAge >= 0 && numAge < 120) {
      const today = new Date();
      const birthYear = today.getFullYear() - numAge;
      estimatedDob = `${birthYear}-01-01`;
    }
    setFormData((prev) => ({ ...prev, age: ageVal, dob: estimatedDob }));
  };


  // ID Generators
  const fetchNextPatientId = async () => {
    try {
      const res = await api.get("/api/patients/next-id");
      if (res.data?.patient_id) {
        setFormData((prev) => ({ ...prev, patient_id: res.data.patient_id }));
        toast.success("Generated next MRN / Patient ID");
      }
    } catch (err) {
      toast.error("Failed to generate MRN / Patient ID");
    }
  };

  const fetchNextAccession = async () => {
    try {
      const res = await api.get("/api/mwl/next-accession");
      if (res.data?.accession_number) {
        setFormData((prev) => ({ ...prev, accession_number: res.data.accession_number }));
        toast.success("Generated next Accession Number");
      }
    } catch (err) {
      toast.error("Failed to generate Accession Number");
    }
  };

  // Physical Consent Print Handler
  const handlePrintPhysicalConsent = () => {
    const patientName = `${formData.firstName || ""} ${formData.lastName || ""}`.trim() || "N/A";
    const patientId = formData.patient_id || formData.phone || "N/A";
    const guardianName = formData.relationship_name || "N/A";
    const relation = formData.relationship_type || "N/A";
    const printWindow = window.open("", "_blank", "width=850,height=950");
    if (!printWindow) {
      toast.error("Popup blocked. Please allow popups to print consent form.");
      return;
    }
    const html = `
      <!doctype html>
      <html>
      <head>
        <title>Patient & Guardian Medical Consent Form</title>
        <style>
          body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #1e293b; line-height: 1.6; }
          .header { border-bottom: 2px solid #0284c7; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; }
          .title { font-size: 22px; font-weight: bold; color: #0f172a; }
          .subtitle { font-size: 13px; color: #64748b; }
          .info-table { width: 100%; border-collapse: collapse; margin-bottom: 25px; font-size: 13px; }
          .info-table td { padding: 8px 12px; border: 1px solid #cbd5e1; }
          .info-table td.label { font-weight: bold; background: #f8fafc; width: 22%; color: #334155; }
          .section-title { font-size: 15px; font-weight: bold; color: #0369a1; margin-top: 20px; margin-bottom: 10px; border-left: 4px solid #0284c7; padding-left: 10px; }
          .consent-text { font-size: 13px; color: #334155; margin-bottom: 15px; text-align: justify; }
          .sig-box-container { display: flex; justify-content: space-between; margin-top: 60px; }
          .sig-box { width: 45%; border-top: 1px solid #475569; text-align: center; padding-top: 8px; font-size: 12px; font-weight: bold; color: #1e293b; }
          .footer-note { font-size: 10px; color: #94a3b8; margin-top: 40px; text-align: center; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="title">PATIENT & GUARDIAN MEDICAL CONSENT FORM</div>
            <div class="subtitle">iPacx Healthcare Systems — Radiology Information System</div>
          </div>
          <div style="font-size: 12px; text-align: right; color: #64748b;">
            Date: ${new Date().toLocaleDateString()}<br/>
            MRN / Patient ID: <strong>${patientId}</strong>
          </div>
        </div>

        <table class="info-table">
          <tr>
            <td class="label">Patient Name</td>
            <td>${patientName}</td>
            <td class="label">Age / Gender</td>
            <td>${formData.age || "N/A"} Yrs / ${formData.gender || "N/A"}</td>
          </tr>
          <tr>
            <td class="label">Guardian / Relation</td>
            <td>${relation}: ${guardianName}</td>
            <td class="label">Mobile Number</td>
            <td>${formData.phone || "N/A"}</td>
          </tr>
          <tr>
            <td class="label">Planned Modality</td>
            <td>${Array.isArray(formData.modalities) ? formData.modalities.join(", ") : formData.modalities || "N/A"}</td>
            <td class="label">Study Type</td>
            <td>${formData.study_type || "N/A"}</td>
          </tr>
        </table>

        <div class="section-title">1. Data Privacy & ABDM Compliance</div>
        <p class="consent-text">
          I hereby authorize the healthcare facility to collect, store, and process my personal health information (PHI) and diagnostic imaging data in accordance with National Digital Health Mission (NDHM/ABDM) guidelines.
        </p>

        <div class="section-title">2. Diagnostic Imaging & Tele-Reporting Consent</div>
        <p class="consent-text">
          I give my informed consent to undergo the requested diagnostic radiology examination. I understand that anonymized imaging scans may be transmitted via secure DICOM PACS network for specialist tele-radiology interpretation or AI-assisted findings generation.
        </p>

        <div class="section-title">3. Physical Paper Signature Declaration</div>
        <p class="consent-text">
          I confirm that I have read (or have had read to me) the contents of this consent document and fully understand the nature and purpose of the procedure.
        </p>

        <div class="sig-box-container">
          <div class="sig-box">
            Signature of Patient / Authorized Guardian<br/>
            <span style="font-weight: normal; font-size: 11px;">Name: __________________________</span><br/>
            <span style="font-weight: normal; font-size: 11px;">Date: ____ / ____ / ________</span>
          </div>
          <div class="sig-box">
            Authorized Healthcare Staff Signature<br/>
            <span style="font-weight: normal; font-size: 11px;">Staff Name: _____________________</span><br/>
            <span style="font-weight: normal; font-size: 11px;">Designation: ___________________</span>
          </div>
        </div>

        <div class="footer-note">
          Original paper copy retained in medical records archive. Form Reference: RIS-CONSENT-V1.1
        </div>

        <script>
          window.onload = function() {
            window.focus();
            window.print();
          };
        </script>
      </body>
      </html>
    `;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  // Signature Drawing Logic
  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = ("clientX" in e ? e.clientX : e.touches[0].clientX) - rect.left;
    const y = ("clientY" in e ? e.clientY : e.touches[0].clientY) - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = ("clientX" in e ? e.clientX : e.touches[0].clientX) - rect.left;
    const y = ("clientY" in e ? e.clientY : e.touches[0].clientY) - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      setFormData((prev) => ({ ...prev, digital_signature: canvas.toDataURL() }));
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      setFormData((prev) => ({ ...prev, digital_signature: "" }));
    }
  };

  // Submit Handler
  const handleSubmit = async () => {
    const fullName = `${formData.firstName} ${formData.lastName}`.trim();
    if (!fullName || !formData.phone || !formData.gender) {
      toast.error("Mandatory fields missing: First Name, Mobile, and Gender");
      setStep(1);
      return;
    }
    try {
      setIsSubmitting(true);
      await onSave({ ...formData, name: fullName });
      toast.success("Patient registered successfully!");
    } catch (err) {
      toast.error("Registration failed: " + (err.message || "Unknown error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step Switch Navigation
  const nextStep = () => setStep((prev) => Math.min(prev + 1, STEPS.length));
  const prevStep = () => setStep((prev) => Math.max(prev - 1, 1));

  // Render Step Contents
  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="pr-card">
            <div className="pr-card-title"><ShieldCheck size={18} color="#0284c7" /> Patient Identity & Identification</div>

            {/* Photo Section */}
            <div className="pr-photo-section">
              <div className="pr-photo-preview">
                {formData.photo_url ? (
                  <img src={formData.photo_url} alt="Patient" />
                ) : (
                  <Camera size={36} color="#94a3b8" />
                )}
              </div>
              <div className="pr-photo-actions">
                <button
                  type="button"
                  className="pr-btn-next"
                  style={{ background: "#0284c7", fontSize: "12px" }}
                  onClick={() => {
                    setShowCameraModal(true);
                    setTimeout(() => startCamera("user"), 200);
                  }}
                >
                  <Camera size={14} style={{ marginRight: 6 }} /> Open Webcam Camera
                </button>
                <label className="pr-btn-back" style={{ cursor: "pointer", fontSize: "12px", display: "inline-flex", alignItems: "center" }}>
                  <FileText size={14} style={{ marginRight: 6 }} /> Browse Image File
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => setFormData((prev) => ({ ...prev, photo_url: reader.result }));
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
                {formData.photo_url && (
                  <button
                    type="button"
                    style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" }}
                    onClick={() => setFormData((prev) => ({ ...prev, photo_url: "" }))}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            <div className="pr-grid pr-grid-3" style={{ marginTop: 20 }}>
              <div className="pr-field">
                <label className="pr-label">Mobile Number <span className="pr-required">*</span></label>
                <input
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="10-digit Mobile"
                  className="pr-input"
                  maxLength={10}
                />
              </div>

              <div className="pr-field">
                <label className="pr-label">ABHA Number (ABDM)</label>
                <input
                  name="abha_number"
                  value={formData.abha_number}
                  onChange={handleChange}
                  placeholder="XX-XXXX-XXXX-XXXX"
                  className="pr-input"
                />
              </div>

              <div className="pr-field">
                <label className="pr-label">Govt ID Type</label>
                <select name="idType" value={formData.idType} onChange={handleChange} className="pr-select">
                  <option value="AADHAAR">Aadhaar Card</option>
                  <option value="VOTER_ID">Voter ID</option>
                  <option value="PAN">PAN Card</option>
                  <option value="DRIVING_LICENSE">Driving License</option>
                  <option value="PASSPORT">Passport</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Govt ID Number</label>
                <input
                  name="idNumber"
                  value={formData.idNumber}
                  onChange={handleChange}
                  placeholder="Enter ID Number"
                  className="pr-input"
                />
              </div>

              <div className="pr-field">
                <label className="pr-label">MRN / Patient ID (World Standard)</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    name="patient_id"
                    value={formData.patient_id}
                    onChange={handleChange}
                    placeholder="Auto MRN ID"
                    className="pr-input"
                  />
                  <button type="button" className="pr-btn-back" style={{ padding: "6px 12px", fontSize: "12px", whiteSpace: "nowrap" }} onClick={fetchNextPatientId}>
                    Auto ID
                  </button>
                </div>
              </div>

              <div className="pr-field" style={{ justifyContent: "center" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#334155" }}>
                  <input
                    type="checkbox"
                    name="biometric_flag"
                    checked={formData.biometric_flag}
                    onChange={handleChange}
                    style={{ width: 16, height: 16 }}
                  />
                  <Fingerprint size={18} color="#0284c7" /> Biometric Verified
                </label>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="pr-card">
            <div className="pr-card-title"><User size={18} color="#0284c7" /> Demographics & Contact Information</div>
            
            <div className="pr-grid pr-grid-3">
              <div className="pr-field">
                <label className="pr-label">Title</label>
                <select name="title" value={formData.title} onChange={handleChange} className="pr-select">
                  <option value="">Select Title</option>
                  <option value="Mr.">Mr.</option>
                  <option value="Mrs.">Mrs.</option>
                  <option value="Ms.">Ms.</option>
                  <option value="Dr.">Dr.</option>
                  <option value="Baby">Baby</option>
                  <option value="Master">Master</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">First Name <span className="pr-required">*</span></label>
                <input name="firstName" value={formData.firstName} onChange={handleChange} placeholder="First Name" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Last Name</label>
                <input name="lastName" value={formData.lastName} onChange={handleChange} placeholder="Surname" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Gender <span className="pr-required">*</span></label>
                <select name="gender" value={formData.gender} onChange={handleChange} className="pr-select">
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Date of Birth</label>
                <input type="date" name="dob" value={formData.dob} onChange={handleDobChange} className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Age (Years)</label>
                <input name="age" type="number" value={formData.age} onChange={handleAgeChange} placeholder="Auto calculated from DOB" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Relation Type</label>
                <select name="relationship_type" value={formData.relationship_type} onChange={handleChange} className="pr-select">
                  <option value="Self">Self</option>
                  <option value="S/O">S/O (Son of)</option>
                  <option value="D/O">D/O (Daughter of)</option>
                  <option value="W/O">W/O (Wife of)</option>
                  <option value="H/O">H/O (Husband of)</option>
                  <option value="C/O">C/O (Care of)</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Relation Name</label>
                <input name="relationship_name" value={formData.relationship_name} onChange={handleChange} placeholder="Father / Guardian Name" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Marital Status</label>
                <select name="marital_status" value={formData.marital_status} onChange={handleChange} className="pr-select">
                  <option value="Single">Single</option>
                  <option value="Married">Married</option>
                  <option value="Divorced">Divorced</option>
                  <option value="Widowed">Widowed</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Occupation</label>
                <input name="occupation" value={formData.occupation} onChange={handleChange} placeholder="e.g. Engineer, Teacher" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Language Preference</label>
                <select name="language_preference" value={formData.language_preference} onChange={handleChange} className="pr-select">
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Kannada">Kannada</option>
                  <option value="Telugu">Telugu</option>
                  <option value="Tamil">Tamil</option>
                  <option value="Marathi">Marathi</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Nationality</label>
                <input name="nationality" value={formData.nationality} onChange={handleChange} className="pr-input" />
              </div>
            </div>

            <div className="pr-field" style={{ marginTop: 16 }}>
              <label className="pr-label">Postal Address</label>
              <textarea name="address" value={formData.address} onChange={handleChange} className="pr-textarea" placeholder="House No, Street, District, State, Pincode" />
            </div>
          </div>
        );

      case 3:
        return (
          <div className="pr-card">
            <div className="pr-card-title"><Stethoscope size={18} color="#0284c7" /> Clinical & Radiology Specifics</div>

            <div className="pr-grid pr-grid-3">
              <div className="pr-field">
                <label className="pr-label">Blood Group</label>
                <select name="blood_group" value={formData.blood_group} onChange={handleChange} className="pr-select">
                  <option value="">Unknown</option>
                  <option>A+</option><option>A-</option>
                  <option>B+</option><option>B-</option>
                  <option>AB+</option><option>AB-</option>
                  <option>O+</option><option>O-</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Height (cm)</label>
                <input name="height_cm" type="number" value={formData.height_cm} onChange={handleChange} className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Weight (kg)</label>
                <input name="weight_kg" type="number" value={formData.weight_kg} onChange={handleChange} className="pr-input" />
              </div>
            </div>

            {/* Planned Modalities & Custom Entry */}
            <div className="pr-field" style={{ marginTop: 18 }}>
              <label className="pr-label">Planned Modalities</label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "6px 0" }}>
                {["CT", "MRI", "X-RAY", "USG", "MAMO", "DEXA", "PET-CT", "SPECT", "FLOURO"].map((mod) => {
                  const isSelected = (formData.modalities || []).includes(mod);
                  return (
                    <button
                      key={mod}
                      type="button"
                      style={{
                        padding: "6px 14px",
                        borderRadius: "20px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: isSelected ? "1px solid #0284c7" : "1px solid #cbd5e1",
                        background: isSelected ? "#e0f2fe" : "#ffffff",
                        color: isSelected ? "#0369a1" : "#475569",
                        cursor: "pointer"
                      }}
                      onClick={() => {
                        const current = formData.modalities || [];
                        const updated = isSelected ? current.filter((m) => m !== mod) : [...current, mod];
                        setFormData((prev) => ({ ...prev, modalities: updated }));
                      }}
                    >
                      {isSelected ? "✓ " : "+ "}{mod}
                    </button>
                  );
                })}

                <button
                  type="button"
                  style={{ padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: 600, border: "1px solid #a855f7", background: "#faf5ff", color: "#7e22ce", cursor: "pointer" }}
                  onClick={() => setShowCustomModality(!showCustomModality)}
                >
                  <PlusCircle size={12} style={{ display: "inline", marginRight: 4 }} /> Custom Modality
                </button>
              </div>

              {showCustomModality && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input
                    placeholder="Enter Custom Modality Code (e.g., OPG, ECHO, ANGIOGRAPHY)"
                    value={customModalityInput}
                    onChange={(e) => setCustomModalityInput(e.target.value)}
                    className="pr-input"
                  />
                  <button
                    type="button"
                    className="pr-btn-next"
                    style={{ fontSize: "12px", whiteSpace: "nowrap" }}
                    onClick={() => {
                      if (!customModalityInput.trim()) return;
                      const code = customModalityInput.trim().toUpperCase();
                      const current = formData.modalities || [];
                      if (!current.includes(code)) {
                        setFormData((prev) => ({ ...prev, modalities: [...current, code] }));
                      }
                      setCustomModalityInput("");
                      setShowCustomModality(false);
                      toast.success(`Added custom modality: ${code}`);
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
            </div>

            <div className="pr-grid pr-grid-2" style={{ marginTop: 16 }}>
              <div className="pr-field">
                <label className="pr-label">Study / Clinical Description</label>
                <input name="study_type" value={formData.study_type} onChange={handleChange} placeholder="e.g. Brain MRI with Contrast / Chest X-Ray PA" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Serum Creatinine Level (mg/dL)</label>
                <input name="creatinine_level" type="number" step="0.1" value={formData.creatinine_level} onChange={handleChange} placeholder="e.g. 0.9" className="pr-input" />
              </div>
            </div>

            <div className="pr-grid pr-grid-2" style={{ marginTop: 16 }}>
              <div className="pr-field">
                <label className="pr-label">Allergies</label>
                <textarea name="allergies" value={formData.allergies} onChange={handleChange} className="pr-textarea" rows={2} placeholder="Known drug/food allergies" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Medical History</label>
                <textarea name="medical_history" value={formData.medical_history} onChange={handleChange} className="pr-textarea" rows={2} placeholder="Diabetes, Hypertension, Prior Surgeries" />
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="pr-card">
            <div className="pr-card-title"><Activity size={18} color="#0284c7" /> Patient Workflow & Placement</div>

            <div className="pr-grid pr-grid-3">
              <div className="pr-field">
                <label className="pr-label">Patient Type</label>
                <select
                  name="patient_type"
                  value={formData.patient_type}
                  onChange={(e) => {
                    const type = e.target.value;
                    const defaultVisit = type === "IPD" ? "ADMISSION" : type === "EMERGENCY" ? "EMERGENCY" : "NEW";
                    setFormData((prev) => ({ ...prev, patient_type: type, visit_type: defaultVisit }));
                  }}
                  className="pr-select"
                >
                  <option value="OPD">OPD (Outpatient)</option>
                  <option value="IPD">IPD (Inpatient)</option>
                  <option value="EMERGENCY">Emergency / Casualty</option>
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Standard Visit Type</label>
                <select name="visit_type" value={formData.visit_type} onChange={handleChange} className="pr-select">
                  {formData.patient_type === "IPD" ? (
                    <>
                      <option value="ADMISSION">Inpatient Admission (Standard IPD)</option>
                      <option value="WARD_TRANSFER">Ward / ICU Transfer</option>
                      <option value="BEDSIDE_PORTABLE">Bedside Portable Scan</option>
                      <option value="POST_OP">Post-Operative Check</option>
                      <option value="ICU_MONITORING">ICU Routine Monitoring</option>
                    </>
                  ) : formData.patient_type === "EMERGENCY" ? (
                    <>
                      <option value="EMERGENCY">Acute Emergency</option>
                      <option value="TRAUMA_RED">Trauma Red Code</option>
                      <option value="MEDICO_LEGAL">Medico-Legal Case (MLC)</option>
                    </>
                  ) : (
                    <>
                      <option value="NEW">New OPD Visit</option>
                      <option value="FOLLOW_UP">Follow Up Visit</option>
                      <option value="ROUTINE_CHECKUP">Routine Checkup</option>
                      <option value="SPECIALIST_CONSULT">Specialist Consultation</option>
                    </>
                  )}
                </select>
              </div>

              <div className="pr-field">
                <label className="pr-label">Department</label>
                <input name="department" value={formData.department} onChange={handleChange} className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Referring Doctor / Hospital</label>
                <input name="referring_doctor" value={formData.referring_doctor} onChange={handleChange} placeholder="Dr. Name / Clinic" className="pr-input" />
              </div>

              <div className="pr-field">
                <label className="pr-label">Accession Number</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <input name="accession_number" value={formData.accession_number} onChange={handleChange} placeholder="Auto Accession" className="pr-input" />
                  <button type="button" className="pr-btn-back" style={{ padding: "6px 12px", fontSize: "12px", whiteSpace: "nowrap" }} onClick={fetchNextAccession}>
                    Auto Acc
                  </button>
                </div>
              </div>

              {formData.patient_type === "IPD" && (
                <div className="pr-field">
                  <label className="pr-label">Ward / Room / Bed Allocation</label>
                  <input name="ward_room_bed" value={formData.ward_room_bed} onChange={handleChange} placeholder="e.g. ICU Ward A / Bed 12" className="pr-input" />
                </div>
              )}
            </div>
          </div>
        );

      case 5: {
        const currentGross = Number(formData.bill_amount) || 1500;
        const currentDiscount = Number(formData.discount_amount) || 0;
        const currentNet = Math.max(0, currentGross - currentDiscount);

        return (
          <div className="pr-card">
            <div className="pr-card-title">
              <CreditCard size={18} color="#0284c7" /> Patient Billing, Receipt & Payment Options
            </div>

            {/* PAYMENT STATUS TOGGLE BANNER */}
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: "14px 18px", borderRadius: 14, marginBottom: 20 }}>
              <label className="pr-label" style={{ marginBottom: 8, display: "block" }}>Payment Status</label>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: formData.payment_status === "PAID" ? "2px solid #059669" : "1px solid #cbd5e1",
                    background: formData.payment_status === "PAID" ? "#ecfdf5" : "#ffffff",
                    color: formData.payment_status === "PAID" ? "#047857" : "#475569",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8
                  }}
                  onClick={() => setFormData((prev) => ({ ...prev, payment_status: "PAID" }))}
                >
                  🟢 PAID (Full Payment Collected)
                </button>

                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: formData.payment_status === "PENDING" ? "2px solid #d97706" : "1px solid #cbd5e1",
                    background: formData.payment_status === "PENDING" ? "#fffbeb" : "#ffffff",
                    color: formData.payment_status === "PENDING" ? "#b45309" : "#475569",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8
                  }}
                  onClick={() => setFormData((prev) => ({ ...prev, payment_status: "PENDING" }))}
                >
                  🟡 PENDING / UNPAID (Pay Later at Dispatch)
                </button>
              </div>
            </div>

            {/* BILLING NUMBERS GRID */}
            <div className="pr-grid pr-grid-3">
              <div className="pr-field">
                <label className="pr-label">Gross Procedure Amount (₹)</label>
                <input
                  type="number"
                  name="bill_amount"
                  value={formData.bill_amount}
                  onChange={(e) => {
                    const gross = Number(e.target.value) || 0;
                    const disc = Number(formData.discount_amount) || 0;
                    setFormData((prev) => ({
                      ...prev,
                      bill_amount: gross,
                      grand_total: Math.max(0, gross - disc)
                    }));
                  }}
                  className="pr-input"
                  placeholder="1500"
                />
              </div>

              <div className="pr-field">
                <label className="pr-label">Discount Amount (₹)</label>
                <input
                  type="number"
                  name="discount_amount"
                  value={formData.discount_amount}
                  onChange={(e) => {
                    const disc = Number(e.target.value) || 0;
                    const gross = Number(formData.bill_amount) || 0;
                    setFormData((prev) => ({
                      ...prev,
                      discount_amount: disc,
                      grand_total: Math.max(0, gross - disc)
                    }));
                  }}
                  className="pr-input"
                  placeholder="0"
                />
              </div>

              <div className="pr-field">
                <label className="pr-label">Net Payable Amount (₹)</label>
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", padding: "8px 14px", borderRadius: 10, fontSize: "16px", fontWeight: 800, color: "#15803d" }}>
                  ₹{currentNet.toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            {/* PAYMENT METHOD SELECTOR */}
            <div style={{ marginTop: 20 }}>
              <label className="pr-label" style={{ marginBottom: 8, display: "block" }}>Payment Method</label>
              <div className="pr-grid pr-grid-4">
                {[
                  { key: "UPI_SCAN", label: "⚡ Instant UPI QR Code", sub: "GPay / PhonePe / BHIM" },
                  { key: "Self-Pay", label: "💵 Cash Payment", sub: "Desk Cash Receipt" },
                  { key: "CARD_POS", label: "💳 Credit / Debit Card", sub: "POS Swipe Machine" },
                  { key: "Insurance", label: "🛡️ Insurance / TPA / PMJAY", sub: "Govt / Corporate Scheme" }
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: formData.billing_category === item.key ? "2px solid #0284c7" : "1px solid #cbd5e1",
                      background: formData.billing_category === item.key ? "#f0f9ff" : "#ffffff",
                      textAlign: "left",
                      cursor: "pointer"
                    }}
                    onClick={() => setFormData((prev) => ({ ...prev, billing_category: item.key, payment_method: item.key }))}
                  >
                    <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{item.label}</div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: 2 }}>{item.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* LIVE UPI QR CODE GENERATOR */}
            {formData.billing_category === "UPI_SCAN" && (
              <div style={{ marginTop: 20, background: "#f0f9ff", border: "1px solid #bae6fd", padding: 16, borderRadius: 14, display: "flex", gap: 20, alignItems: "center" }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`upi://pay?pa=radiology@upi&pn=iPacx+Radiology+Center&am=${currentNet}&cu=INR&tn=Patient+${formData.patient_id || 'Scan'}`)}`}
                  alt="UPI QR Code"
                  style={{ width: 140, height: 140, borderRadius: 10, border: "2px solid #0284c7" }}
                />
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 800, color: "#0369a1" }}>⚡ Dynamic UPI QR Code Ready</div>
                  <div style={{ fontSize: "12px", color: "#334155", marginTop: 4 }}>VPA Account: <strong>radiology@upi</strong></div>
                  <div style={{ fontSize: "13px", color: "#334155", marginTop: 2 }}>Total Bill Amount: <strong style={{ color: "#047857", fontSize: 16 }}>₹{currentNet.toLocaleString('en-IN')} INR</strong></div>
                  <div style={{ fontSize: "11px", color: "#0284c7", marginTop: 8, fontWeight: 600 }}>Scan using Google Pay, PhonePe, Paytm, or BHIM app for instant confirmation.</div>
                </div>
              </div>
            )}

            {/* INSURANCE / TPA DETAILS */}
            {["Insurance", "PMJAY", "CGHS"].includes(formData.billing_category) && (
              <div className="pr-grid pr-grid-2" style={{ marginTop: 20 }}>
                <div className="pr-field">
                  <label className="pr-label">Insurance / TPA Scheme Provider</label>
                  <input
                    name="insurance_provider"
                    value={formData.insurance_provider}
                    onChange={handleChange}
                    placeholder="e.g. Star Health / PMJAY / CGHS"
                    className="pr-input"
                  />
                </div>

                <div className="pr-field">
                  <label className="pr-label">Pre-Auth / Policy / Member ID</label>
                  <input
                    name="insurance_id"
                    value={formData.insurance_id}
                    onChange={handleChange}
                    placeholder="e.g. POL-8847120"
                    className="pr-input"
                  />
                </div>
              </div>
            )}
          </div>
        );
      }


      case 6:
        return (
          <div className="pr-card">
            <div className="pr-card-title"><FileText size={18} color="#0284c7" /> Consent Declarations & Signature Options</div>

            <div className="pr-grid pr-grid-2">
              <div>
                <label className="pr-consent-card">
                  <input type="checkbox" name="data_privacy_accepted" checked={formData.data_privacy_accepted} onChange={handleChange} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a" }}>ABDM Data Privacy Acceptance</div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>Consent for digital health record storage as per ABDM norms.</div>
                  </div>
                </label>

                <label className="pr-consent-card">
                  <input type="checkbox" name="consent_image_sharing" checked={formData.consent_image_sharing} onChange={handleChange} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a" }}>Image Sharing & Tele-Radiology</div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>Consent to transmit scans via PACS network for specialist reporting.</div>
                  </div>
                </label>

                <label className="pr-consent-card">
                  <input type="checkbox" name="consent_telemedicine" checked={formData.consent_telemedicine} onChange={handleChange} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: "#0f172a" }}>Telemedicine Consultation</div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>Consent for remote tele-consultation services.</div>
                  </div>
                </label>
              </div>

              {/* Digital Signature Pad */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label className="pr-label">Digital Touch / Mouse Signature</label>
                  <button type="button" onClick={clearSignature} style={{ border: "none", background: "none", color: "#ef4444", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>
                    Clear Pad
                  </button>
                </div>
                <div style={{ border: "2px dashed #cbd5e1", borderRadius: 10, background: "#fafafa", height: 150, position: "relative" }}>
                  <canvas
                    ref={canvasRef}
                    width={420}
                    height={150}
                    style={{ width: "100%", height: "100%", cursor: "crosshair" }}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                  {!formData.digital_signature && !isDrawing && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", color: "#cbd5e1", pointerEvents: "none", fontSize: "13px", fontWeight: 600 }}>
                      Draw Digital Signature Here
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Paper Consent Form Options: Print or Upload Signed Physical Copy */}
            <div className="pr-print-consent-banner" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "14px", color: "#0369a1" }}>Paper Consent Form (Physical Paper Signature)</div>
                  <div style={{ fontSize: "12px", color: "#0284c7" }}>If patient or guardian cannot sign digitally, print paper form and upload the signed scan copy.</div>
                </div>

                <button
                  type="button"
                  className="pr-btn-next"
                  style={{ background: "#0284c7", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "12px", whiteSpace: "nowrap" }}
                  onClick={handlePrintPhysicalConsent}
                >
                  <Printer size={14} /> Print Paper Consent Form
                </button>
              </div>

              <div style={{ borderTop: "1px solid #bae6fd", paddingTop: 10, width: "100%", display: "flex", alignItems: "center", gap: 12 }}>
                <label className="pr-label" style={{ margin: 0, color: "#0369a1" }}>Upload Signed Paper Scan Copy:</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="pr-input"
                  style={{ width: "auto", fontSize: "12px" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setFormData((prev) => ({ ...prev, paper_consent_url: reader.result }));
                        toast.success("Paper consent file attached!");
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                />
                {formData.paper_consent_url && <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 700 }}>✓ Attached</span>}
              </div>
            </div>
          </div>
        );


      default:
        return null;
    }
  };

  return (
    <div className="pr-modal-overlay">
      <div className="pr-modal-container">
        {/* HEADER & STEP TRACKER BAR */}
        <div className="pr-header">
          <div className="pr-header-top">
            <div>
              <div className="pr-header-title">
                {initialData ? "Edit Patient Record" : "New Patient Registration"}
              </div>
              <div className="pr-header-sub">
                Step {step} of 6 — {STEPS[step - 1].title} | World Standard MRN & PACS Workflow
              </div>
            </div>
            <button className="pr-close-btn" onClick={onClose} title="Close Registration">
              <X size={18} />
            </button>
          </div>

          {/* STEP PROGRESS TRACKER */}
          <div className="pr-steps-bar">
            {STEPS.map((s) => {
              const isActive = step === s.id;
              const isCompleted = step > s.id;
              return (
                <div
                  key={s.id}
                  className={`pr-step-item ${isActive ? "active" : ""} ${isCompleted ? "completed" : ""}`}
                  onClick={() => setStep(s.id)}
                >
                  <div className="pr-step-circle">
                    {isCompleted ? <Check size={14} /> : s.id}
                  </div>
                  <div className="pr-step-label">{s.title}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* MODAL BODY */}
        <div className="pr-body" ref={bodyRef}>
          {renderStepContent()}
        </div>

        {/* FOOTER CONTROLS */}
        <div className="pr-footer">
          <button type="button" className="pr-btn-back" onClick={step === 1 ? onClose : prevStep}>
            {step === 1 ? "Cancel" : "◀ Back"}
          </button>

          <button
            type="button"
            className={step === 6 ? "pr-btn-complete" : "pr-btn-next"}
            onClick={step === 6 ? handleSubmit : nextStep}
            disabled={isSubmitting}
          >
            {step === 6 ? (isSubmitting ? "Saving Patient..." : "✓ Complete Registration") : "Next ▶"}
          </button>
        </div>
      </div>

      {/* WEBCAM CAMERA LIVE STREAM MODAL */}
      {showCameraModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 99999, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div style={{ background: "#fff", padding: "20px", borderRadius: "12px", maxWidth: "600px", width: "90%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "bold", color: "#0f172a" }}>📸 Patient Live Webcam Stream</h3>
            <div style={{ width: "100%", height: "340px", background: "#000", borderRadius: "8px", overflow: "hidden" }}>
              <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button type="button" className="pr-btn-complete" onClick={takePhotoSnapshot}>
                📸 Take Snapshot
              </button>
              <button
                type="button"
                className="pr-btn-back"
                onClick={() => {
                  const nextMode = facingMode === "user" ? "environment" : "user";
                  setFacingMode(nextMode);
                  startCamera(nextMode);
                }}
              >
                🔄 Switch Camera
              </button>
              <button type="button" className="pr-btn-back" style={{ color: "#ef4444" }} onClick={stopCamera}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
