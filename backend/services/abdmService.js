/**
 * ABDM (Ayushman Bharat Digital Mission) FHIR R4 Interoperability Service
 * Builds compliant FHIR R4 Bundle resources (DiagnosticReport, Patient, ImagingStudy, Media, DocumentReference)
 * following Indian EHR 2016 and ABDM M1/M2/M3 standards.
 */

function compactObject(obj) {
  if (Array.isArray(obj)) return obj.filter(item => item !== null && item !== undefined && item !== "");
  if (obj && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, val]) => val !== null && val !== undefined && val !== "")
        .map(([k, val]) => [k, compactObject(val)])
    );
  }
  return obj;
}

class AbdmService {
  /**
   * Verify and format ABDM 14-digit ABHA (Ayushman Bharat Health Account) Number / Address
   */
  formatAbhaId(abhaNumber) {
    if (!abhaNumber) return null;
    const clean = String(abhaNumber).replace(/[^0-9]/g, "");
    if (clean.length === 14) {
      return `${clean.slice(0, 2)}-${clean.slice(2, 6)}-${clean.slice(6, 10)}-${clean.slice(10, 14)}`;
    }
    return abhaNumber;
  }

  /**
   * Generate an ABDM compliant FHIR R4 Bundle for a Diagnostic Report
   */
  createDiagnosticReportBundle(report, study, patient, snapshots = []) {
    const reportId = String(report.id);
    const patientId = String(patient.patient_id || patient.uhid || patient.id || "PATIENT-01");
    const studyUid = String(study.study_uid || report.study_uid);
    const abhaId = this.formatAbhaId(patient.abha_id || patient.health_id);

    // 1. Patient Resource
    const patientResource = compactObject({
      resourceType: "Patient",
      id: patientId,
      meta: {
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"]
      },
      identifier: [
        abhaId ? { system: "https://healthid.ndhm.gov.in", value: abhaId } : null,
        patient.uhid ? { system: "urn:ipacx:uhid", value: String(patient.uhid) } : null,
        patient.patient_id ? { system: "urn:ipacx:patient-id", value: String(patient.patient_id) } : null
      ],
      name: [
        {
          text: patient.full_name || patient.patient_name || [patient.first_name, patient.last_name].filter(Boolean).join(" "),
          given: patient.first_name ? [patient.first_name] : undefined,
          family: patient.last_name || undefined
        }
      ],
      gender: String(patient.gender || patient.patient_sex || "unknown").toLowerCase().startsWith("m")
        ? "male"
        : String(patient.gender || patient.patient_sex || "unknown").toLowerCase().startsWith("f")
        ? "female"
        : "unknown",
      birthDate: patient.dob ? String(patient.dob).slice(0, 10) : undefined,
      telecom: patient.mobile ? [{ system: "phone", value: String(patient.mobile), use: "mobile" }] : undefined
    });

    // 2. ImagingStudy Resource
    const imagingStudyResource = compactObject({
      resourceType: "ImagingStudy",
      id: studyUid,
      meta: {
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/ImagingStudy"]
      },
      identifier: [{ system: "urn:dicom:uid", value: studyUid }],
      status: "available",
      subject: { reference: `Patient/${patientId}`, display: patientResource.name[0]?.text },
      started: study.study_date ? `${study.study_date.slice(0, 4)}-${study.study_date.slice(4, 6)}-${study.study_date.slice(6, 8)}` : undefined,
      modality: study.modality ? [{ system: "http://dicom.nema.org/resources/ontology/DCM", code: study.modality }] : undefined,
      description: study.study_description || report.report_title || "Radiology Imaging Study"
    });

    // 3. Key Image Media Resources
    const mediaResources = (snapshots || []).map((snap, idx) => {
      const mediaId = `media-snap-${idx + 1}`;
      return compactObject({
        resourceType: "Media",
        id: mediaId,
        meta: {
          profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Media"]
        },
        status: "completed",
        type: {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/media-type", code: "image", display: "Image" }
          ]
        },
        subject: { reference: `Patient/${patientId}` },
        content: {
          contentType: "image/jpeg",
          url: snap.preview_url || snap.url || snap.image_path,
          title: snap.caption || `Key Diagnostic Image ${idx + 1}`
        }
      });
    });

    // 4. DiagnosticReport Resource
    const reportContentText = typeof report.report_content === "string"
      ? report.report_content
      : (report.report_content?.findings || "") + "\n\n" + (report.report_content?.conclusion || "");

    const diagnosticReportResource = compactObject({
      resourceType: "DiagnosticReport",
      id: reportId,
      meta: {
        profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab"]
      },
      identifier: [
        { system: "urn:ipacx:report-id", value: reportId },
        report.accession_number ? { system: "urn:ipacx:accession", value: String(report.accession_number) } : null
      ],
      status: String(report.status || "Final").toLowerCase() === "final" ? "final" : "registered",
      category: [
        {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/v2-0074", code: "RAD", display: "Radiology" }
          ]
        }
      ],
      code: {
        coding: [
          { system: "http://loinc.org", code: "11528-7", display: "Radiology Report" }
        ],
        text: report.report_title || study.study_description || `${report.modality || "Radiology"} Report`
      },
      subject: { reference: `Patient/${patientId}`, display: patientResource.name[0]?.text },
      imagingStudy: [{ reference: `ImagingStudy/${studyUid}` }],
      media: mediaResources.map(m => ({ link: { reference: `Media/${m.id}` } })),
      effectiveDateTime: report.created_at || new Date().toISOString(),
      issued: report.created_at || new Date().toISOString(),
      performer: [
        {
          display: report.reported_by_signature
            ? typeof report.reported_by_signature === "object"
              ? report.reported_by_signature.full_name
              : String(report.reported_by_signature)
            : report.reported_by || "Radiologist"
        }
      ],
      conclusion: report.conclusion || report.report_content?.conclusion || "Normal Diagnostic Study",
      presentedForm: [
        {
          contentType: "text/html",
          data: Buffer.from(reportContentText || "").toString("base64")
        }
      ]
    });

    // Assemble Bundle
    const bundleEntries = [
      { fullUrl: `Patient/${patientId}`, resource: patientResource },
      { fullUrl: `ImagingStudy/${studyUid}`, resource: imagingStudyResource },
      ...mediaResources.map(m => ({ fullUrl: `Media/${m.id}`, resource: m })),
      { fullUrl: `DiagnosticReport/${reportId}`, resource: diagnosticReportResource }
    ];

    return {
      resourceType: "Bundle",
      id: `abdm-bundle-${reportId}`,
      meta: {
        lastUpdated: new Date().toISOString()
      },
      type: "document",
      timestamp: new Date().toISOString(),
      entry: bundleEntries
    };
  }
}

module.exports = new AbdmService();
