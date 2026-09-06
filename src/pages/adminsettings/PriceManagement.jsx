import React, { useState, useEffect } from "react";
import MainLayout from "../../layout/MainLayout";
import api from "../../api/axios";
import { toast } from "react-hot-toast";
import { Plus, Trash2, Edit2, Check, X, IndianRupee, Tag, Activity } from "lucide-react";
import "./AdminManagement.css";

export default function PriceManagement() {
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newPrice, setNewPrice] = useState({ modality: "CT", body_part: "", price: "", gst_percent: "0" });

  useEffect(() => {
    loadPrices();
  }, []);

  const loadPrices = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/billing/prices");
      if (res.data?.success) {
        setPrices(res.data.data);
      }
    } catch (err) {
      console.error("Failed to load prices:", err);
      toast.error("Failed to load price list");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newPrice.modality || !newPrice.body_part || !newPrice.price) {
      return toast.error("Please fill all required fields");
    }
    const tid = toast.loading("Saving resource price rate...");
    try {
      const res = await api.post("/api/billing/prices", newPrice);
      if (res.data?.success) {
        toast.success("Price rate added successfully!", { id: tid });
        setIsAdding(false);
        setNewPrice({ modality: "CT", body_part: "", price: "", gst_percent: "0" });
        loadPrices();
      }
    } catch (err) {
      console.error("Failed to add price:", err);
      toast.error("Failed to add resource price", { id: tid });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this resource rate?")) return;
    const tid = toast.loading("Deleting price rate...");
    try {
      const res = await api.delete(`/api/billing/prices/${id}`);
      if (res.data?.success) {
        toast.success("Price rate deleted", { id: tid });
        loadPrices();
      }
    } catch (err) {
      console.error("Failed to delete price:", err);
      toast.error("Failed to delete price rate", { id: tid });
    }
  };

  return (
    <MainLayout>
      <div className="adm-container">
        {/* HEADER HERO BAR */}
        <header className="adm-header">
          <div className="adm-title-box">
            <div className="adm-icon-wrapper">
              <IndianRupee size={24} />
            </div>
            <div>
              <span className="adm-badge">Billing & Master Price List</span>
              <h1 className="adm-title">Resource & Diagnostic Test Rate Tariff</h1>
              <p className="adm-subtitle">
                Configure diagnostic test base rates, body part study prices, and GST tax percentages for automated invoicing.
              </p>
            </div>
          </div>

          <button onClick={() => setIsAdding(true)} className="adm-add-btn">
            <Plus size={16} /> Add New Tariff Rate
          </button>
        </header>

        {/* KPI STATS STRIP */}
        <div className="adm-stats-grid">
          <div className="adm-stat-card">
            <div className="adm-stat-icon indigo">
              <Tag size={20} />
            </div>
            <div>
              <div className="adm-stat-value">{prices.length}</div>
              <div className="adm-stat-label">Tariff Rates</div>
            </div>
          </div>

          <div className="adm-stat-card">
            <div className="adm-stat-icon emerald">
              <IndianRupee size={20} />
            </div>
            <div>
              <div className="adm-stat-value">Automated</div>
              <div className="adm-stat-label">Billing Invoicing</div>
            </div>
          </div>
        </div>

        {/* TARIFF PRICE TABLE CARD */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-slate-500 font-bold">
              <Activity size={28} className="animate-spin text-indigo-600 inline-block mb-2" /><br />
              Loading Master Resource Prices...
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-4">Modality</th>
                    <th className="p-4">Description / Body Part</th>
                    <th className="p-4">Base Rate (₹)</th>
                    <th className="p-4">GST %</th>
                    <th className="p-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isAdding && (
                    <tr className="bg-indigo-50/40">
                      <td className="p-3">
                        <select
                          className="w-full p-2 text-xs border rounded-lg font-bold bg-white"
                          value={newPrice.modality}
                          onChange={(e) => setNewPrice({ ...newPrice, modality: e.target.value })}
                        >
                          <option value="CT">CT Scan</option>
                          <option value="MR">MRI</option>
                          <option value="US">Ultrasound</option>
                          <option value="CR">X-Ray</option>
                          <option value="XA">XA (Angio)</option>
                          <option value="MG">Mammography</option>
                          <option value="DEXA">DEXA</option>
                        </select>
                      </td>
                      <td className="p-3">
                        <input
                          className="w-full p-2 text-xs border rounded-lg bg-white"
                          placeholder="e.g. Brain Contrast Study"
                          value={newPrice.body_part}
                          onChange={(e) => setNewPrice({ ...newPrice, body_part: e.target.value })}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          className="w-full p-2 text-xs border rounded-lg bg-white font-mono font-bold"
                          placeholder="3500"
                          value={newPrice.price}
                          onChange={(e) => setNewPrice({ ...newPrice, price: e.target.value })}
                        />
                      </td>
                      <td className="p-3">
                        <input
                          type="number"
                          className="w-full p-2 text-xs border rounded-lg bg-white font-mono"
                          placeholder="18"
                          value={newPrice.gst_percent}
                          onChange={(e) => setNewPrice({ ...newPrice, gst_percent: e.target.value })}
                        />
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex gap-2 justify-center">
                          <button onClick={handleAdd} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold shadow-sm">
                            <Check size={14} className="inline mr-1" /> Save
                          </button>
                          <button onClick={() => setIsAdding(false)} className="px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold">
                            <X size={14} className="inline" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {prices.length === 0 && !isAdding ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center text-slate-400 font-medium">
                        No resource tariffs configured yet. Click "Add New Tariff Rate" to add pricing.
                      </td>
                    </tr>
                  ) : (
                    prices.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50 transition">
                        <td className="p-4 font-extrabold text-indigo-600 font-mono">{p.modality}</td>
                        <td className="p-4 font-medium text-slate-900">{p.body_part}</td>
                        <td className="p-4 font-mono font-extrabold text-slate-900">₹{p.price}</td>
                        <td className="p-4 font-mono text-slate-600 font-semibold">{p.gst_percent}%</td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="px-3 py-1 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-lg text-xs font-bold transition"
                          >
                            <Trash2 size={13} className="inline mr-1" /> Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
