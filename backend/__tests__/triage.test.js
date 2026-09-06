const dicomTriageService = require("../services/dicomTriageService");
const pdfSigner = require("../utils/pdfSigner");

describe("DICOM Triage Engine Tests", () => {
  test("Brain CT study should be assigned STAT priority", () => {
    const result = dicomTriageService.evaluateTriage({
      modality: "CT",
      bodyPart: "BRAIN",
      studyDescription: "Trauma Brain CT Scan",
    });
    expect(result.priority).toBe("STAT");
    expect(result.slaMinutes).toBe(15);
  });

  test("Routine Chest X-ray should be assigned ROUTINE priority", () => {
    const result = dicomTriageService.evaluateTriage({
      modality: "CR",
      bodyPart: "CHEST",
      studyDescription: "Routine Chest X-Ray",
    });
    expect(result.priority).toBe("ROUTINE");
    expect(result.slaMinutes).toBe(240);
  });
});

describe("PDF Cryptographic Digital Signer Tests", () => {
  test("Should generate valid SHA-256 digital signature seal", () => {
    const signature = pdfSigner.signPdfDocument("sample_pdf_content_stream", "DR_RADIOLOGIST_01");
    expect(signature.digitalSignature).toContain("SIG-IPACX-RSA256");
    expect(signature.algorithm).toBe("SHA256-RSA-PKCS1v15");
    expect(signature.checksum).toBeDefined();
  });
});
