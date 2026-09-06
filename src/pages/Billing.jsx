import React, { useState, useEffect } from "react";
import MainLayout from "../layout/MainLayout";
import api from "../api/axios";
import { toast } from "react-hot-toast";
import "./Billing.css";
import { 
  Search, 
  Printer, 
  CreditCard, 
  Plus, 
  Trash2, 
  CheckCircle, 
  IndianRupee, 
  Clock, 
  QrCode, 
  ShieldCheck, 
  FileText, 
  RefreshCw,
  Wallet
} from "lucide-react";

export default function Billing() {
  const [patients, setPatients] = useState([]);
  const [prices, setPrices] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [billingItems, setBillingItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("UPI_SCAN");
  const [paymentStatus, setPaymentStatus] = useState("PAID");
  const [searchTerm, setSearchTerm] = useState("");
  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadPatients();
    loadPrices();
    loadInvoices();
  }, []);

  const loadPatients = async () => {
    try {
      const res = await api.get("/api/patients");
      setPatients(Array.isArray(res.data) ? res.data : (res.data.patients || []));
    } catch (err) {
      console.error("Failed to load patients");
    }
  };

  const loadPrices = async () => {
    try {
      const res = await api.get("/api/billing/prices");
      if (res.data?.success && Array.isArray(res.data.data)) {
        setPrices(res.data.data);
      }
    } catch (err) {
      console.error("Failed to load prices");
    }
  };

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/patients");
      const pList = Array.isArray(res.data) ? res.data : (res.data.patients || []);
      
      const invoicePromises = pList.slice(0, 30).map(async (p) => {
        try {
          const invRes = await api.get(`/api/billing/invoices/${p.uhid || p.patient_id}`);
          if (invRes.data?.success && Array.isArray(invRes.data.data)) {
            return invRes.data.data.map(inv => ({ ...inv, patient_name: `${p.first_name || ""} ${p.last_name || ""} ${p.full_name || ""}`.trim() }));
          }
        } catch (e) {
          console.warn("Failed to fetch patient invoice:", e.message);
        }
        return [];
      });
      const allInvoices = (await Promise.all(invoicePromises)).flat();
      allInvoices.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      setInvoices(allInvoices);
    } catch (err) {
      console.error("Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPatient = (p) => {
    setSelectedPatient(p);
    if (p.modality || p.modalities || p.study_type) {
      const modStr = p.modality || (Array.isArray(p.modalities) ? p.modalities.join(", ") : "");
      const autoItem = {
        id: Date.now(),
        description: p.study_type || `${modStr} Examination`,
        modality: modStr || "Radiology",
        body_part: p.study_type || "Diagnostic Scan",
        price: 1500,
        gst_percent: 0
      };
      setBillingItems([autoItem]);
    } else {
      setBillingItems([]);
    }
  };

  const addItem = (priceObj) => {
    setBillingItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        description: `${priceObj.modality} - ${priceObj.body_part}`,
        modality: priceObj.modality,
        body_part: priceObj.body_part,
        price: parseFloat(priceObj.price || 1500),
        gst_percent: parseFloat(priceObj.gst_percent || 0)
      }
    ]);
  };

  const addCustomItem = () => {
    const desc = prompt("Enter Procedure Description (e.g. Brain MRI Contrast):", "Diagnostic Radiology Scan");
    if (!desc) return;
    const priceInput = prompt("Enter Amount (₹):", "1500");
    const priceVal = parseFloat(priceInput) || 1500;
    setBillingItems((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        description: desc,
        modality: "Radiology",
        body_part: desc,
        price: priceVal,
        gst_percent: 0
      }
    ]);
  };

  const removeItem = (id) => {
    setBillingItems((prev) => prev.filter((item) => item.id !== id));
  };

  const calculateSubtotal = () => billingItems.reduce((acc, item) => acc + parseFloat(item.price || 0), 0);
  const calculateTax = () => billingItems.reduce((acc, item) => acc + (parseFloat(item.price || 0) * (parseFloat(item.gst_percent || 0) / 100)), 0);
  const calculateGrandTotal = () => Math.max(0, calculateSubtotal() + calculateTax() - parseFloat(discount || 0));

  const handleGenerateInvoice = async () => {
    if (!selectedPatient) return toast.error("Please select a patient first");
    if (billingItems.length === 0) return toast.error("Please add at least one procedure billing item");

    try {
      setGenerating(true);
      const payload = {
        patient_id: selectedPatient.uhid || selectedPatient.patient_id,
        items: billingItems.map(i => ({
          description: i.description || `${i.modality} - ${i.body_part}`,
          price: i.price,
          gst_percent: i.gst_percent
        })),
        discount_amount: parseFloat(discount || 0),
        payment_method: paymentMethod,
        payment_status: paymentStatus
      };

      const res = await api.post("/api/billing/invoice", payload);
      if (res.data?.success) {
        toast.success("Invoice generated & payment saved successfully!");
        setSelectedPatient(null);
        setBillingItems([]);
        setDiscount(0);
        loadInvoices();
      }
    } catch (err) {
      console.error("Generate invoice error:", err);
      toast.error("Failed to generate invoice");
    } finally {
      setGenerating(false);
    }
  };

  const handlePrintReceipt = async (patientId) => {
    try {
      toast.loading("Generating printable billing receipt PDF...", { id: "print-bill" });
      const res = await api.get(`/api/billing/print/${encodeURIComponent(patientId)}`, {
        responseType: "blob"
      });
      toast.dismiss("print-bill");
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank");
    } catch (err) {
      toast.dismiss("print-bill");
      toast.error("Failed to generate receipt PDF");
    }
  };

  const totalRevenue = invoices.filter(i => i.payment_status === "PAID").reduce((acc, curr) => acc + parseFloat(curr.grand_total || curr.total_amount || 0), 0);
  const pendingRevenue = invoices.filter(i => i.payment_status === "PENDING").reduce((acc, curr) => acc + parseFloat(curr.grand_total || curr.total_amount || 0), 0);

  return (
    <MainLayout>
      <div className="bl-container">
        {/* HEADER BAR */}
        <header className="bl-header">
          <div className="bl-title-section">
            <span className="bl-tag">Universal RIS Billing Suite</span>
            <h1 className="bl-title">Billing, Invoicing & Cashier Gateway</h1>
          </div>

          <div className="bl-header-actions">
            <button onClick={loadInvoices} className="bl-btn bl-btn-outline">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Sync Invoices
            </button>
          </div>
        </header>

        {/* REVENUE KPI CARDS */}
        <div className="bl-kpi-grid">
          <div className="bl-kpi-card">
            <div className="bl-kpi-icon emerald"><IndianRupee /></div>
            <div className="bl-kpi-info">
              <span className="bl-kpi-label">Total Collected Revenue</span>
              <span className="bl-kpi-value">₹{totalRevenue.toLocaleString('en-IN')}</span>
              <span className="bl-kpi-sub">PAID Receipts</span>
            </div>
          </div>

          <div className="bl-kpi-card">
            <div className="bl-kpi-icon amber"><Clock /></div>
            <div className="bl-kpi-info">
              <span className="bl-kpi-label">Pending Outstanding</span>
              <span className="bl-kpi-value">₹{pendingRevenue.toLocaleString('en-IN')}</span>
              <span className="bl-kpi-sub">Pay Later / Uncollected</span>
            </div>
          </div>

          <div className="bl-kpi-card">
            <div className="bl-kpi-icon indigo"><FileText /></div>
            <div className="bl-kpi-info">
              <span className="bl-kpi-label">Total Invoices Created</span>
              <span className="bl-kpi-value">{invoices.length}</span>
              <span className="bl-kpi-sub">Processed Records</span>
            </div>
          </div>
        </div>

        {/* MAIN TWO-COLUMN WORKSPACE */}
        <div className="bl-main-grid">
          {/* LEFT COLUMN: PATIENT SELECTOR */}
          <div className="bl-card" style={{ height: 600, display: 'flex', flexDirection: 'column' }}>
            <div className="bl-card-title">1. Select Patient for Billing</div>
            
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <Search style={{ position: 'absolute', left: 12, top: 12, color: '#94a3b8' }} size={16} />
              <input 
                className="bl-input"
                style={{ paddingLeft: 36 }}
                placeholder="Search by MRN, Patient Name..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
              {patients.filter(p => {
                const s = searchTerm.toLowerCase();
                const name = `${p.first_name || ""} ${p.last_name || ""} ${p.full_name || ""}`.toLowerCase();
                const id = String(p.uhid || p.patient_id || "").toLowerCase();
                return !s || name.includes(s) || id.includes(s);
              }).map(p => {
                const isSelected = selectedPatient?.uhid === p.uhid || selectedPatient?.patient_id === p.patient_id;
                return (
                  <div 
                    key={p.uhid || p.patient_id}
                    onClick={() => handleSelectPatient(p)}
                    className={`bl-patient-item ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="bl-patient-name">
                      {`${p.first_name || ""} ${p.last_name || ""}`.trim() || p.full_name || "Patient"}
                    </div>
                    <div className="bl-patient-sub">
                      MRN: {p.uhid || p.patient_id} | Mod: {p.modality || p.modalities || "General"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT COLUMN: BILLING INVOICE BUILDER */}
          <div className="bl-card">
            {selectedPatient ? (
              <div>
                <div style={{ background: '#1e1b4b', color: '#ffffff', padding: 16, borderRadius: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', color: '#a5b4fc' }}>Drafting Invoice Receipt</div>
                  <h2 style={{ fontSize: 18, fontWeight: 900, margin: '4px 0 0 0' }}>
                    {`${selectedPatient.first_name || ""} ${selectedPatient.last_name || ""}`.trim() || selectedPatient.full_name}
                  </h2>
                  <div style={{ fontSize: 12, color: '#c7d2fe', marginTop: 4 }}>
                    MRN: <strong>{selectedPatient.uhid || selectedPatient.patient_id}</strong> | Ref: <strong>{selectedPatient.referring_doctor || 'Self'}</strong>
                  </div>
                </div>

                {/* LINE ITEMS TABLE */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 900, textTransform: 'uppercase', color: '#475569' }}>Bill Line Items</span>
                    <button type="button" onClick={addCustomItem} className="bl-btn bl-btn-outline" style={{ padding: '4px 10px', fontSize: 11 }}>
                      + Custom Item
                    </button>
                  </div>

                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <th style={{ padding: 8, textAlign: 'left' }}>Description</th>
                        <th style={{ padding: 8, textAlign: 'right' }}>Price (₹)</th>
                        <th style={{ padding: 8, textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingItems.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: 8, fontWeight: 700 }}>{item.description}</td>
                          <td style={{ padding: 8, textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>₹{item.price}</td>
                          <td style={{ padding: 8, textAlign: 'center' }}>
                            <button onClick={() => removeItem(item.id)} style={{ color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer' }}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* FINANCIAL SUMMARY */}
                <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0', marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 900, color: '#0f172a' }}>
                    <span>Net Grand Total Payable:</span>
                    <span style={{ color: '#059669', fontFamily: 'monospace' }}>₹{calculateGrandTotal().toFixed(2)}</span>
                  </div>
                </div>

                {/* PAYMENT METHOD SELECTOR */}
                <div style={{ marginBottom: 20 }}>
                  <label className="bl-label">Payment Method</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {["UPI_SCAN", "CASH", "CARD"].map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        className={`bl-btn ${paymentMethod === m ? 'bl-btn-primary' : 'bl-btn-outline'}`}
                        style={{ padding: '8px 12px', fontSize: 11, justifyContent: 'center' }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={handleGenerateInvoice}
                  disabled={generating}
                  className="bl-btn bl-btn-primary"
                  style={{ width: '100%', padding: 14, justifyContent: 'center', fontSize: 14 }}
                >
                  <CheckCircle size={18} /> {generating ? "Saving Invoice..." : "Complete Billing & Generate Receipt"}
                </button>
              </div>
            ) : (
              <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>
                <CreditCard size={48} style={{ opacity: 0.3, margin: '0 auto 12px auto' }} />
                <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>No Patient Selected</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Select a patient from the list on the left to start drafting an invoice.</div>
              </div>
            )}
          </div>
        </div>

        {/* RECENT INVOICES LEDGER TABLE */}
        <div className="bl-table-card">
          <div style={{ padding: 20, borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>Recent Invoices & Payment Ledger</h3>
          </div>

          <table className="bl-table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Patient ID</th>
                <th>Patient Name</th>
                <th>Payment Method</th>
                <th>Grand Total</th>
                <th>Status</th>
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => (
                <tr key={inv.id || inv.invoice_number}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 800, color: '#4338ca' }}>{inv.invoice_number}</td>
                  <td style={{ fontFamily: 'monospace' }}>{inv.patient_id}</td>
                  <td style={{ fontWeight: 800 }}>{inv.patient_name || "Patient"}</td>
                  <td>{inv.payment_method || "CASH"}</td>
                  <td style={{ fontFamily: 'monospace', fontWeight: 900 }}>₹{parseFloat(inv.grand_total || inv.total_amount || 0).toLocaleString('en-IN')}</td>
                  <td><span className="bl-badge-paid">{inv.payment_status || "PAID"}</span></td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => handlePrintReceipt(inv.patient_id)} className="bl-btn bl-btn-outline" style={{ padding: '4px 10px', fontSize: 11 }}>
                      <Printer size={12} /> Receipt PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}
