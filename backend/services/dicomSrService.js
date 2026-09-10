/**
 * DICOM Structured Reporting (DICOM SR) Service
 * Builds DICOM SR (TID 1500 Measurement / Text Report & TID 2000 Key Object Selection)
 * for international PACS interoperability.
 */

class DicomSrService {
  /**
   * Build DICOM SR JSON metadata representation for a radiology report
   */
  createDicomSrMetadata(report, study, snapshots = []) {
    const reportId = String(report.id);
    const studyUid = String(study.study_uid || report.study_uid);
    const patientId = String(study.patient_id || report.patient_id || "UNKNOWN");
    const patientName = String(study.patient_name || report.patient_name || "UNKNOWN");

    const findingsText = typeof report.report_content === "object"
      ? report.report_content.findings || ""
      : String(report.report_content || "");

    const conclusionText = typeof report.report_content === "object"
      ? report.report_content.conclusion || ""
      : String(report.conclusion || "");

    const keyImageItems = (snapshots || []).map((snap, idx) => ({
      relationshipType: "CONTAINS",
      valueType: "IMAGE",
      conceptNameCodeSequence: {
        codingScheme: "DCM",
        codeValue: "121180",
        codeMeaning: "Key Image Selection"
      },
      referencedSopSequence: {
        referencedSopClassUid: snap.sopClassUid || "1.2.840.10008.5.1.4.1.1.2", // Default CT Image Storage
        referencedSopInstanceUid: snap.sopInstanceUid || snap.instance_id || `1.2.840.10008.5.1.4.1.1.2.${Date.now()}.${idx + 1}`
      },
      caption: snap.caption || `Key Image ${idx + 1}`
    }));

    return {
      sopClassUid: "1.2.840.10008.5.1.4.1.1.88.33", // Comprehensive SR Storage
      sopInstanceUid: `1.2.840.10008.5.1.4.1.1.88.33.${reportId}.${Date.now()}`,
      studyInstanceUid: studyUid,
      seriesInstanceUid: `1.2.840.10008.5.1.4.1.1.88.33.series.${reportId}`,
      patientId: patientId,
      patientName: patientName,
      modality: "SR",
      seriesNumber: 99,
      instanceNumber: 1,
      documentTitle: {
        codeValue: "11528-7",
        codingScheme: "LN",
        codeMeaning: report.report_title || "Radiology Report"
      },
      completionFlag: String(report.status).toLowerCase() === "final" ? "COMPLETE" : "PARTIAL",
      verificationFlag: report.approved_by_signature ? "VERIFIED" : "UNVERIFIED",
      contentTree: {
        relationshipType: "HAS CONCEPT MOD",
        valueType: "CONTAINER",
        conceptNameCodeSequence: {
          codeValue: "121070",
          codingScheme: "DCM",
          codeMeaning: "Diagnostic Imaging Report"
        },
        children: [
          {
            relationshipType: "CONTAINS",
            valueType: "CONTAINER",
            conceptNameCodeSequence: {
              codeValue: "121071",
              codingScheme: "DCM",
              codeMeaning: "Findings"
            },
            value: findingsText
          },
          {
            relationshipType: "CONTAINS",
            valueType: "CONTAINER",
            conceptNameCodeSequence: {
              codeValue: "121073",
              codingScheme: "DCM",
              codeMeaning: "Impression"
            },
            value: conclusionText
          },
          ...keyImageItems
        ]
      }
    };
  }
}

module.exports = new DicomSrService();
