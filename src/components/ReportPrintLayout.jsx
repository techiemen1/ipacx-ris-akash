import React, { useRef } from "react";

export default function ReportPrintLayout({ report }) {
  const printRef = useRef(null);

  if (!report) return null;

  return (
    <div
      style={{
        height: "100vh",
        overflowY: "auto",
        background: "#d9d9d9",
        padding: 20,
      }}
    >
      {/* ================= A4 PAGE ================= */}
      <div
        ref={printRef}
        id="print-area"
        style={{
          width: "210mm",
          minHeight: "297mm",
          margin: "auto",
          padding: "20mm",
          background: "#fff",
          fontFamily: "Times New Roman",
          fontSize: "12pt",
          color: "#000",
        }}
      >
        {/* ================= HEADER ================= */}
        <div style={{ textAlign: "center", marginBottom: 15 }}>
          <h2 style={{ margin: 0, fontWeight: "bold" }}>
            {report.hospital_name || "HOSPITAL NAME"}
          </h2>

          <div>{report.hospital_address || ""}</div>
          <div>Tel: {report.hospital_phone || ""}</div>

          {report.status && (
            <div
              style={{
                marginTop: 5,
                fontWeight: "bold",
                color: report.status === "FINAL" ? "green" : "orange",
              }}
            >
              {report.status} REPORT
            </div>
          )}
        </div>

        {/* ================= PATIENT INFO ================= */}
        <table
          width="100%"
          border="1"
          cellPadding="8"
          style={{
            borderCollapse: "collapse",
            marginBottom: 25,
          }}
        >
          <tbody>
            <tr>
              <td>
                <b>Patient Name:</b> {report.patient_name || "—"}
              </td>
              <td>
                <b>Age / Gender:</b>{" "}
                {report.age || "N/A"} / {report.gender || "N/A"}
              </td>
              <td>
                <b>Patient ID:</b> {report.patient_id || "—"}
              </td>
            </tr>

            <tr>
              <td>
                <b>Study Date / Time:</b>{" "}
                {report.study_datetime || report.study_date || "—"}

              </td>
              <td>
                <b>Ref. Doctor:</b>{" "}
                {report.referring_doctor || "—"}
              </td>
              <td>
                <b>Accession No:</b>{" "}
                {report.accession_number || "—"}
              </td>
            </tr>

            <tr>
              <td>
                <b>Reported Date / Time:</b>{" "}
                {report.reported_datetime || "—"}
              </td>
              <td>
                <b>Modality:</b> {report.modality || "—"}
              </td>
              <td>
                <b>Body Part:</b> {report.body_part || "—"}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ================= TITLE ================= */}
        <h3
          style={{
            textAlign: "center",
            textDecoration: "underline",
            marginBottom: 30,
          }}
        >
          RADIOLOGY REPORT
        </h3>

        {/* ================= HISTORY ================= */}
        <div style={{ marginBottom: 20 }}>
          <b>History:</b>
          <div
            dangerouslySetInnerHTML={{
              __html: report.history || "",
            }}
          />
        </div>

        {/* ================= FINDINGS ================= */}
        <div style={{ marginBottom: 20 }}>
          <b>Findings:</b>
          <div
            dangerouslySetInnerHTML={{
              __html: report.findings || "",
            }}
          />
        </div>

        {/* ================= CONCLUSION ================= */}
        <div style={{ marginBottom: 40 }}>
          <b>Conclusion:</b>
          <div
            dangerouslySetInnerHTML={{
              __html: report.conclusion || "",
            }}
          />
        </div>

        {/* ================= PAGE BREAK ================= */}
        <div className="page-break" />

        {/* ================= KEY IMAGES ================= */}
        {Array.isArray(report.images) && report.images.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <b>Key Images:</b>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 10,
              }}
            >
              {report.images.map((img, index) => (
                <img
                  key={index}
                  src={
                    img.startsWith("http")
                      ? img
                      : `http://localhost:5000${img}`
                  }
                  alt={`Key Image ${index + 1}`}
                  style={{
                    width: "45%",
                    border: "1px solid #000",
                    padding: 4,
                    pageBreakInside: "avoid",
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ================= ADDENDUM ================= */}
        {report.addendum_reason && (
          <>
            <div className="page-break" />
            <div
              style={{
                marginTop: 30,
                paddingTop: 15,
                borderTop: "2px solid #000",
              }}
            >
              <h4 style={{ textDecoration: "underline" }}>ADDENDUM</h4>
              <div
                dangerouslySetInnerHTML={{
                  __html: report.addendum_reason,
                }}
              />
            </div>
          </>
        )}

        {/* ================= FOOTER ================= */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 80,
          }}
        >
          <div>
            <b>Reported By:</b> {report.reported_by_signature || "N/A"}
          </div>
          <div>
       <b>Approved By:</b> {report.approved_by_signature || "N/A"}
          </div>
        </div>
      </div>

      {/* ================= PRINT CSS ================= */}
      <style>
        {`
          @media print {
            body {
              background: white !important;
            }
            #print-area {
              margin: 0 !important;
            }
            .page-break {
              page-break-before: always;
            }
          }
        `}
      </style>
    </div>
  );
}
