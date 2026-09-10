const patientRepository = require("../repositories/PatientRepository");
const reportRepository = require("../repositories/ReportRepository");
const patientService = require("../services/PatientService");
const reportService = require("../services/ReportService");

describe("Repository and Service Decoupling Tests", () => {
  it("PatientRepository methods should be defined", () => {
    expect(typeof patientRepository.getPatientColumns).toBe("function");
    expect(typeof patientRepository.findPatientByIdentifier).toBe("function");
    expect(typeof patientRepository.createPatient).toBe("function");
    expect(typeof patientRepository.getAllPatients).toBe("function");
    expect(typeof patientRepository.lookupPatients).toBe("function");
    expect(typeof patientRepository.deletePatientByUhid).toBe("function");
  });

  it("ReportRepository methods should be defined", () => {
    expect(typeof reportRepository.findStudyWithTenant).toBe("function");
    expect(typeof reportRepository.findLatestReport).toBe("function");
    expect(typeof reportRepository.getAllReports).toBe("function");
    expect(typeof reportRepository.insertFinalReport).toBe("function");
    expect(typeof reportRepository.deleteReport).toBe("function");
  });

  it("PatientService methods should be defined", () => {
    expect(typeof patientService.getNextId).toBe("function");
    expect(typeof patientService.createPatient).toBe("function");
    expect(typeof patientService.resequenceIds).toBe("function");
    expect(typeof patientService.getAllPatients).toBe("function");
    expect(typeof patientService.lookupPatients).toBe("function");
    expect(typeof patientService.getPatientDetails).toBe("function");
    expect(typeof patientService.deletePatient).toBe("function");
  });

  it("ReportService methods should be defined", () => {
    expect(typeof reportService.getStudyReportByUid).toBe("function");
    expect(typeof reportService.getAllReports).toBe("function");
    expect(typeof reportService.saveReport).toBe("function");
    expect(typeof reportService.getReportByStudyUid).toBe("function");
    expect(typeof reportService.saveAddendumReason).toBe("function");
    expect(typeof reportService.deleteReport).toBe("function");
  });
});
