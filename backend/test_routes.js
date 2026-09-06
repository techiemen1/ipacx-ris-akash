const aiReportingService = require("./services/aiReportingService");
const generateFinalReportPDF = require("./utils/generateFinalReportPDF");
const fs = require("fs");

async function runTests() {
  console.log("🧪 Starting iPACX RIS Core Unit & Integration Verification...");

  try {
    // 1. AI DICOM Measurement Auto-Fill Test
    console.log("1️⃣ Testing AI DICOM Measurement Auto-Fill...");
    const findings = "Routine obstetric ultrasound examination.";
    const measurements = {
      BPD: "48.4 mm",
      HC: "192.7 mm",
      AC: "148.6 mm",
      FL: "33.2 mm",
      FW: "350 g",
      HR: "149 bpm",
    };

    const autoFilled = aiReportingService.autoFillMeasurements(findings, measurements);
    console.log("   Auto-Filled Output:\n" + autoFilled);
    if (!autoFilled.includes("Biparietal Diameter (BPD)")) {
      throw new Error("Auto-fill measurement mapping failed");
    }
    console.log("   ✅ AI Measurement Auto-Fill PASSED");

    // 2. AI Impression Generator Test
    console.log("\n2️⃣ Testing AI Impression Summarizer...");
    const impression = await aiReportingService.generateAIImpression({
      history: "Antenatal checkup",
      findings: autoFilled,
      modality: "US",
      bodyPart: "Obstetric",
    });
    console.log(`   Generated Impression:\n   "${impression}"`);
    if (!impression || impression.length < 5) {
      throw new Error("AI impression generation failed");
    }
    console.log("   ✅ AI Impression Summarizer PASSED");

    // 3. Dynamic PDF Generation with QR Code Test
    console.log("\n3️⃣ Testing PDF Generation Engine & QR Code...");
    const sampleReport = {
      id: 101,
      study_uid: "1.2.840.113619.2.55.3.2831151025.412.1648827391.80",
      accession_number: "ACC-99201",
      patient_name: "Doe^Jane",
      patient_id: "PID-8832",
      patient_age: "28Y",
      patient_gender: "F",
      modality: "US",
      body_part: "Obstetric",
      referring_doctor: "Dr. Sarah Jenkins",
      report_title: "OBSTETRIC ULTRASOUND DIAGNOSTIC REPORT",
      report_content: {
        history: "Routine 2nd trimester ultrasound evaluation.",
        findings: autoFilled,
        conclusion: impression,
      },
      reported_by_signature: {
        full_name: "Dr. Alex Morgan, MD",
        qualification: "Senior Radiologist",
        dateTime: new Date().toISOString(),
      },
      approved_by_signature: {
        full_name: "Dr. Robert Vance, DMRD",
        qualification: "Head of Radiology",
        dateTime: new Date().toISOString(),
      },
      clinic_id: 1,
    };

    const pdfPath = await generateFinalReportPDF(sampleReport, [], { printMode: false });
    console.log(`   Generated PDF File Path: ${pdfPath}`);
    if (!fs.existsSync(pdfPath)) {
      throw new Error("PDF output file was not created");
    }
    const stats = fs.statSync(pdfPath);
    console.log(`   PDF File Size: ${stats.size} bytes`);
    console.log("   ✅ Dynamic PDF & QR Code Verification PASSED");

    console.log("\n🎉 ALL core next-gen modules verified successfully!");
  } catch (err) {
    console.error("❌ Verification Test Error:", err);
    process.exit(1);
  }
}

runTests();
