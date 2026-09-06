// src/pages/AddendumReport.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "../api/axios";

function AddendumReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const parentReport = location.state?.parentReport;
  const studyUID = parentReport?.study_uid;

  const [noteInput, setNoteInput] = useState(""); // new reason input
  const [addendumId, setAddendumId] = useState(null); // saved reason id
  const [history, setHistory] = useState("");
  const [findings, setFindings] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [study, setStudy] = useState({});
  const [loading, setLoading] = useState(true);
  const [existingAddendums, setExistingAddendums] = useState([]);

  // prefetch final report and existing addendums
  useEffect(() => {
    if (!parentReport) {
      alert("No parent report data found");
      navigate("/reporting");
      return;
    }

    // fetch report content
    const fetchReport = async () => {
      try {
        const res = await fetch(`${api.defaults.baseURL}/api/reports/by-study/${studyUID}`);
        const reportData = await res.json();
        if (reportData) {
          const content = reportData.report_content || {};
          setHistory(content.history || "");
          setFindings(content.findings || "");
          setConclusion(content.conclusion || "");
        }
      } catch (err) {
        console.error("Failed to fetch report:", err);
      }
    };

    // fetch existing addendum reasons
    const fetchAddendums = async () => {
      try {
        const res = await fetch(`${api.defaults.baseURL}/api/addendum/by-report/${parentReport.id}`);
        const data = await res.json();
        setExistingAddendums(data || []);
      } catch (err) {
        console.error("Failed to fetch addendums:", err);
      }
    };

    setStudy({
      Modality: parentReport.modality,
      BodyPartExamined: parentReport.body_part,
      ReferringPhysicianName: parentReport.referring_doctor,
      ReportedBy: parentReport.reported_by,
      ApprovedBy: parentReport.approved_by,
      PatientName: parentReport.patient_name,
      PatientID: parentReport.patient_id,
    });

    Promise.all([fetchReport(), fetchAddendums()]).finally(() => setLoading(false));
  }, [parentReport, studyUID, navigate]);

  // save reason
  const handleSaveReason = async () => {
    if (!noteInput.trim()) {
      alert("Please enter a reason for addendum");
      return;
    }

    try {
      const res = await fetch(`${api.defaults.baseURL}/api/addendum/save-reason`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_id: parentReport.id,
          study_uid: studyUID,
          reason: noteInput.trim(),
          created_by: "CurrentUser",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAddendumId(data.id);
        alert("Reason saved successfully!");
        setExistingAddendums((prev) => [...prev, { id: data.id, reason: noteInput.trim() }]);
        setNoteInput("");
      } else {
        alert("Failed to save reason");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving reason");
    }
  };

  // save addendum report
  const handleSaveAddendum = async () => {
    if (!addendumId) {
      alert("Please save reason first!");
      return;
    }

    const payload = {
      addendumId,
      report_content: { history, findings, conclusion },
      updated_by: study.ReportedBy || "CurrentUser",
    };

    try {
      const res = await fetch(`${api.defaults.baseURL}/api/addendum/save-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        alert("Addendum report saved!");
        navigate("/reporting");
      } else {
        alert("Failed to save addendum report");
      }
    } catch (err) {
      console.error(err);
      alert("Error saving addendum report");
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div style={{ padding: 12, fontFamily: "Arial, sans-serif" }}>
      <h2>Addendum Report for {study.PatientName}</h2>

      {/* Toolbar showing existing addendum reasons */}
      <div style={{ marginBottom: 16, padding: 8, border: "1px solid #ccc", borderRadius: 4 }}>
        <strong>Existing Addendum Reasons:</strong>
        {existingAddendums.length ? (
          <ul>
            {existingAddendums.map((a) => (
              <li key={a.id}>{a.reason}</li>
            ))}
          </ul>
        ) : (
          <p style={{ fontStyle: "italic" }}>No previous addendum reasons</p>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          Reason for Addendum:
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            style={{ width: "100%", padding: 6, marginTop: 4 }}
          />
        </label>
        <button onClick={handleSaveReason} style={{ marginTop: 8, padding: "6px 12px" }}>
          Save Reason
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          History:
          <textarea
            value={history}
            onChange={(e) => setHistory(e.target.value)}
            style={{ width: "100%", height: 80, padding: 6 }}
          />
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          Findings:
          <textarea
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
            style={{ width: "100%", height: 80, padding: 6 }}
          />
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          Conclusion:
          <textarea
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            style={{ width: "100%", height: 80, padding: 6 }}
          />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          onClick={handleSaveAddendum}
          style={{ padding: "8px 16px", backgroundColor: "#198754", color: "#fff", border: "none", borderRadius: 4 }}
        >
          Save Addendum Report
        </button>
      </div>
    </div>
  );
}

export default AddendumReport;
