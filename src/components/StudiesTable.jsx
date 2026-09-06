import React from "react";
export default function StudiesTable({
  studies = [],
  mode = "pacs", // "pacs" | "report"
  navigate,
  currentPage,
  rowsPerPage,
}) {
  const openViewer = (study) => {
    if (!study?.StudyInstanceUID) return;
    
    // Use the new local OHIF viewer service
    // Relative path ensures it works on localhost or production domain
    window.open(
      `/viewer/viewer/dicomweb?StudyInstanceUIDs=${study.StudyInstanceUID}`,
      "_blank"
    );
  };

  return (
    <tbody>
      {studies.length === 0 ? (
        <tr>
          <td colSpan="10" className="no-data-row">
            No matching studies found
          </td>
        </tr>
      ) : (
        studies.map((s, idx) => (
          <tr key={s.StudyInstanceUID || idx} className={`mod-row-${(s.Modality || 'cr').toLowerCase()}`}>
            <td>{(currentPage - 1) * rowsPerPage + idx + 1}</td>

            <td>{s.PatientID || "-"}</td>
            <td>{s.PatientName || "-"}</td>
            <td>{s.AccessionNumber || "-"}</td>
            <td>{s.StudyDescription || "No Description"}</td>
            <td>{s.StudyDate || "-"}</td>
            <td>{s.Modality || "-"}</td>
            <td>{s.PatientSex || "-"}</td>
            <td>{s.PatientAge || "-"}</td>

            {/* ACTIONS */}
            
            <td className="actions">
  <div className="action-button-group">
    {mode === "pacs" && (
      <>
        <button
          className="icon-btn"
          title="View Study"
          onClick={() => openViewer(s)}
        >
          👁️
        </button>

        <button
          className="icon-btn"
          title="Create Report"
          onClick={() => navigate(`/create-report?study=${s.StudyInstanceUID}`)}
        >
          📝
        </button>

        <button
          className="icon-btn"
          title="Add / Update Patient"
          onClick={() => navigate("/add-patient", { state: { editEntry: s } })}
        >
          📤
        </button>
      </>
    )}
    
    {mode === "report" && (
      <button
        className="icon-btn"
        title="Open Report Panel"
        onClick={() => navigate(`/report-panel?study=${s.StudyInstanceUID}`)}
      >
        📝
      </button>
    )}
  </div>
</td>
          </tr>
        ))
      )}
    </tbody>
  );
}