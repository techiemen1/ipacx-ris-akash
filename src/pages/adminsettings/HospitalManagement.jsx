import React, { useState, useEffect } from "react";
import api from "../../api/axios";
import toast from "react-hot-toast";
import MainLayout from "../../layout/MainLayout";
import { Building2, Save, RefreshCw, Award, MapPin, Phone, Mail, Globe, FileText } from "lucide-react";
import "./AdminManagement.css";

export default function HospitalManagement() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    id: 1,
    code: "MAIN",
    name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
    header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
    address: "Prasannahalli Main Road, Near Airport, Devanahalli, Bengaluru, Karnataka 562110",
    phone: "+91 80 7115 9900 / +91 98865 17662",
    email: "radiology@akashmedical.edu.in",
    website: "https://akashhospital.in",
    nabh_id: "NABH-H-2024-0891",
    nabl_id: "NABL-M-4821",
    registration_no: "KMC/MED/REG/48190",
    footer_text: "Electronically Verified Diagnostic Report • NABH & NABL Accredited Center",
    logo_url: ""
  });

  const loadHospitalSettings = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/clinics/active");
      if (res.data) {
        setFormData(prev => ({
          ...prev,
          ...res.data,
          name: res.data.name || prev.name,
          header_text: res.data.header_text || prev.header_text,
          address: res.data.address || prev.address,
          phone: res.data.phone || prev.phone,
          email: res.data.email || prev.email,
          nabh_id: res.data.nabh_id || prev.nabh_id,
          nabl_id: res.data.nabl_id || prev.nabl_id,
          registration_no: res.data.registration_no || prev.registration_no,
          footer_text: res.data.footer_text || prev.footer_text
        }));
      }
    } catch (err) {
      console.error("Failed to load hospital profile:", err);
      toast.error("Using default hospital profile configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHospitalSettings();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const tid = toast.loading("Saving Master Hospital Profile & Report Letterhead...");
    try {
      const payload = {
        code: formData.code || "MAIN",
        name: formData.name,
        institution_name: formData.name,
        header_text: formData.header_text,
        address: formData.address,
        phone: formData.phone,
        email: formData.email,
        footer_text: formData.footer_text,
        nabh_id: formData.nabh_id,
        nabl_id: formData.nabl_id,
        registration_no: formData.registration_no,
        logo_url: formData.logo_url
      };

      await api.post("/api/clinics", payload);
      toast.success("Hospital Profile & Master Letterhead Updated Successfully!", { id: tid });
      loadHospitalSettings();
    } catch (err) {
      console.error("Failed to update hospital settings:", err);
      toast.error("Failed to update hospital settings: " + (err.response?.data?.error || err.message), { id: tid });
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout>
      <div className="adm-container">
        {/* HEADER HERO BAR */}
        <header className="adm-header">
          <div className="adm-title-box">
            <div className="adm-icon-wrapper" style={{ background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', color: '#fff' }}>
              <Building2 size={24} />
            </div>
            <div>
              <span className="adm-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>Single Hospital Master Setup</span>
              <h1 className="adm-title">Hospital Master Profile & Report Letterhead Settings</h1>
              <p className="adm-subtitle">
                Configure official Hospital details, full address, accreditation licenses, and report letterhead for diagnostic reports.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={loadHospitalSettings} disabled={loading} className="adm-btn-ghost flex items-center gap-1 text-slate-600 bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Reload Profile
            </button>
          </div>
        </header>

        {loading ? (
          <div className="py-16 text-center text-slate-500 font-bold">
            <RefreshCw size={32} className="animate-spin text-sky-600 inline-block mb-3" /><br />
            Loading Official Hospital Profile & Report Settings...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* CARD 1: PRIMARY HOSPITAL BRANDING */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-sky-100 text-sky-700 rounded-xl">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Hospital Identity & Department Subtitle</h3>
                  <p className="text-xs text-slate-500">Official hospital legal entity name and diagnostic department heading.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Hospital Full Legal Name *</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="e.g. AKASH MEDICAL COLLEGE AND HOSPITALS"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Radiology Department / Heading Subtitle *</label>
                  <input
                    type="text"
                    required
                    value={formData.header_text}
                    onChange={(e) => setFormData({ ...formData, header_text: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-bold text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="e.g. DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING"
                  />
                </div>
              </div>
            </div>

            {/* CARD 2: CONTACT & PHYSICAL ADDRESS */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                  <MapPin size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Physical Location, Address & Helplines</h3>
                  <p className="text-xs text-slate-500">Complete address and contact helplines printed on report headers and invoices.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Full Physical Hospital Address *</label>
                  <textarea
                    rows={2}
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="e.g. Prasannahalli Main Road, Devanahalli, Bengaluru, Karnataka 562110"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                      <Phone size={13} className="text-emerald-600" /> Helpline Phone Numbers
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                      placeholder="+91 80 7115 9900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                      <Mail size={13} className="text-sky-600" /> Official Email Address
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                      placeholder="info@akashhospital.in"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                      <Globe size={13} className="text-indigo-600" /> Website URL
                    </label>
                    <input
                      type="text"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                      placeholder="https://akashhospital.in"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 3: ACCREDITATIONS & MEDICAL LICENSES */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
                  <Award size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">NABH, NABL Accreditations & Medical Registration</h3>
                  <p className="text-xs text-slate-500">Regulatory licensing details required for NABH / NABL compliance on reports.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">NABH Accreditation No.</label>
                  <input
                    type="text"
                    value={formData.nabh_id}
                    onChange={(e) => setFormData({ ...formData, nabh_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="NABH-H-2024-0891"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">NABL Accreditation No.</label>
                  <input
                    type="text"
                    value={formData.nabl_id}
                    onChange={(e) => setFormData({ ...formData, nabl_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="NABL-M-4821"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Medical Registration / License No.</label>
                  <input
                    type="text"
                    value={formData.registration_no}
                    onChange={(e) => setFormData({ ...formData, registration_no: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                    placeholder="KMC/MED/REG/48190"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Report Footer Disclaimer & Legal Notice</label>
                <input
                  type="text"
                  value={formData.footer_text}
                  onChange={(e) => setFormData({ ...formData, footer_text: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
                  placeholder="Electronically Verified Diagnostic Report • NABH & NABL Accredited Center"
                />
              </div>
            </div>

            {/* LIVE LETTERHEAD PREVIEW BOX */}
            <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800 text-white space-y-3">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
                  <FileText size={14} /> Official Report Header Preview (Live Render)
                </span>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-800 font-bold">
                  NABH & NABL READY
                </span>
              </div>

              <div className="bg-white text-slate-900 p-5 rounded-xl border border-slate-300 font-serif">
                <div className="flex justify-between items-center border-b-2 border-slate-900 pb-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-950 font-sans tracking-tight m-0">{formData.name}</h2>
                    <p className="text-xs font-bold text-sky-700 font-sans mt-0.5 uppercase tracking-wide">{formData.header_text}</p>
                    <p className="text-[11px] text-slate-600 font-sans m-0">{formData.address} • Helpline: {formData.phone}</p>
                  </div>
                  <div className="text-right font-sans text-[11px] text-slate-700 leading-tight">
                    <div className="font-bold text-emerald-800">{formData.nabh_id ? `NABH ACCREDITED (${formData.nabh_id})` : 'NABH ACCREDITED'}</div>
                    <div>{formData.nabl_id ? `NABL LAB (${formData.nabl_id})` : 'NABL APPROVED'}</div>
                    <div className="text-[10px] text-slate-500">Reg: {formData.registration_no}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* SAVE BUTTON BAR */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-700 hover:to-blue-800 text-white px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2 shadow-lg shadow-sky-600/30 transition-all cursor-pointer"
              >
                <Save size={18} /> {saving ? "Saving Changes..." : "Save Hospital Master Settings"}
              </button>
            </div>
          </form>
        )}
      </div>
    </MainLayout>
  );
}
