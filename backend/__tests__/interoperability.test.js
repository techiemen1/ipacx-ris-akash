const abdmService = require("../services/abdmService");
const dicomSrService = require("../services/dicomSrService");
const { buildHl7OruR01 } = require("../services/hl7ReportExporter");

describe("Indian ABDM & International Interoperability Suite", () => {
  test("Should format 14-digit ABHA Health ID with hyphens", () => {
    const rawAbha = "12345678901234";
    const formatted = abdmService.formatAbhaId(rawAbha);
    expect(formatted).toBe("12-3456-7890-1234");
  });

  test("Should generate valid ABDM FHIR R4 Bundle with DiagnosticReport and Media resources", () => {
    const report = {
      id: 101,
      study_uid: "1.2.840.113619.2.55.1.1",
      patient_id: "PAT-9988",
      patient_name: "Ramesh Kumar",
      status: "Final",
      report_title: "CT Brain Plain",
      report_content: { findings: "Normal brain parenchyma", conclusion: "No acute infarct" },
      created_at: new Date().toISOString()
    };

    const study = {
      study_uid: "1.2.840.113619.2.55.1.1",
      study_date: "20260910",
      modality: "CT",
      study_description: "CT Head / Brain"
    };

    const patient = {
      patient_id: "PAT-9988",
      uhid: "UHID-1002",
      full_name: "Ramesh Kumar",
      gender: "Male",
      dob: "1985-05-15",
      mobile: "9876543210",
      abha_id: "12345678901234"
    };

    const snapshots = [
      { preview_url: "/uploads/report_images/snap_1.jpg", caption: "Key Slice 17/237" }
    ];

    const bundle = abdmService.createDiagnosticReportBundle(report, study, patient, snapshots);

    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("document");
    expect(bundle.entry.length).toBe(4); // Patient, ImagingStudy, Media, DiagnosticReport

    const diagnosticReport = bundle.entry.find(e => e.resource.resourceType === "DiagnosticReport")?.resource;
    expect(diagnosticReport).toBeDefined();
    expect(diagnosticReport.status).toBe("final");
    expect(diagnosticReport.category[0].coding[0].code).toBe("RAD");
  });

  test("Should generate valid DICOM SR Metadata with Key Image References", () => {
    const report = {
      id: 502,
      study_uid: "1.2.840.113619.2.55.1.2",
      patient_id: "PAT-5544",
      status: "Final",
      report_title: "HRCT Chest",
      report_content: { findings: "Clear lungs", conclusion: "Normal HRCT" },
      approved_by_signature: { full_name: "Dr. Sharma" }
    };

    const study = {
      study_uid: "1.2.840.113619.2.55.1.2",
      patient_name: "Anita Singh"
    };

    const snapshots = [
      {
        sopInstanceUid: "1.2.840.113619.2.55.1.2.999",
        caption: "Nodule Slice 45"
      }
    ];

    const sr = dicomSrService.createDicomSrMetadata(report, study, snapshots);

    expect(sr.sopClassUid).toBe("1.2.840.10008.5.1.4.1.1.88.33");
    expect(sr.completionFlag).toBe("COMPLETE");
    expect(sr.verificationFlag).toBe("VERIFIED");
    expect(sr.contentTree.children.length).toBe(3); // Findings, Impression, Key Image
  });

  test("Should generate valid HL7 ORU^R01 ER7 text message", () => {
    const reportData = {
      id: 88,
      patient_id: "P-101",
      patient_name: "Sunil^Verma",
      accession_number: "ACC-8801",
      modality: "CR",
      report_title: "Chest X-Ray PA",
      findings: "Normal lung fields.",
      conclusion: "No acute cardiopulmonary disease.",
      reported_by: "Dr. A. Gupta"
    };

    const hl7 = buildHl7OruR01(reportData);
    expect(hl7.er7).toContain("MSH|^~\\&");
    expect(hl7.er7).toContain("OBR|1|");
    expect(hl7.er7).toContain("OBX|1|TX|");
  });
});
