import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { Sparkles, FileText, Zap } from "lucide-react";

export default function AIReportingToolbar({
  study,
  findings,
  setFindings,
  conclusion,
  setConclusion,
  onApplyTemplate,
}) {
  const [loading, setLoading] = useState(false);

  const handleMatchTemplate = async () => {
    if (!study) return;
    setLoading(true);
    try {
      const res = await axios.post("/api/ai/match-template", {
        modality: study.modality || study.Modality,
        bodyPart: study.body_part || study.BodyPartExamined,
        studyDescription: study.study_description || study.StudyDescription,
      });
      if (res.data?.template) {
        toast.success(`Matched Template: ${res.data.template.template_name || res.data.template.name}`);
        if (onApplyTemplate) onApplyTemplate(res.data.template);
      } else {
        toast.error("No matching template found");
      }
    } catch (err) {
      toast.error("Template matching failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAutoFillDICOM = async () => {
    if (!study?.study_uid) return;
    setLoading(true);
    try {
      const res = await axios.get(`/api/dicom-data/measurements/${study.study_uid}`);
      if (res.data?.data?.measurements && Object.keys(res.data.data.measurements).length > 0) {
        const fillRes = await axios.post("/api/ai/auto-fill-measurements", {
          findings,
          measurements: res.data.data.measurements,
        });
        setFindings(fillRes.data.findings);
        toast.success("DICOM measurements auto-filled!");
      } else {
        toast("No DICOM measurements found for this study", { icon: "ℹ️" });
      }
    } catch (err) {
      toast.error("Failed to fetch DICOM measurements");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateImpression = async () => {
    if (!findings || findings.trim().length < 10) {
      toast.error("Please enter findings first to generate impression");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post("/api/ai/generate-impression", {
        findings,
        modality: study?.modality || study?.Modality || "",
        bodyPart: study?.body_part || study?.BodyPartExamined || "",
      });
      setConclusion(res.data.impression);
      toast.success("AI Impression generated!");
    } catch (err) {
      toast.error("AI impression generation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900 text-white rounded-lg mb-4 shadow-md border border-slate-800">
      <div className="flex items-center gap-1 text-amber-400 font-semibold text-sm mr-2">
        <Sparkles size={16} />
        <span>AI Suite</span>
      </div>

      <button
        type="button"
        disabled={loading}
        onClick={handleMatchTemplate}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition disabled:opacity-50"
      >
        <FileText size={14} />
        <span>Auto-Template</span>
      </button>

      <button
        type="button"
        disabled={loading}
        onClick={handleAutoFillDICOM}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition disabled:opacity-50"
      >
        <Zap size={14} />
        <span>Auto-Fill DICOM Data</span>
      </button>

      <button
        type="button"
        disabled={loading}
        onClick={handleGenerateImpression}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium transition disabled:opacity-50"
      >
        <Sparkles size={14} />
        <span>AI Impression</span>
      </button>
    </div>
  );
}
