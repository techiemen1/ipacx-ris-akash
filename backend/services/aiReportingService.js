const pool = require("../db");

class AiReportingService {
  /**
   * Finds the best matching report template based on Modality, BodyPart, and Study Description
   */
  async matchBestTemplate({ modality, bodyPart, studyDescription, clinicId = 1 }) {
    let query = `
      SELECT * FROM report_templates
      WHERE (clinic_id = $1 OR clinic_id IS NULL)
        AND is_active = true
    `;
    const params = [clinicId];

    if (modality) {
      query += ` AND UPPER(modality) = UPPER($${params.length + 1})`;
      params.push(modality);
    }

    if (bodyPart) {
      query += ` AND UPPER(body_part) LIKE UPPER($${params.length + 1})`;
      params.push(`%${bodyPart}%`);
    }

    query += " ORDER BY is_default DESC, id DESC LIMIT 1";

    const result = await pool.query(query, params);
    if (result.rows.length) return result.rows[0];

    // Fallback: match by modality only
    const fallback = await pool.query(
      `SELECT * FROM report_templates WHERE UPPER(modality) = UPPER($1) AND is_active = true ORDER BY is_default DESC LIMIT 1`,
      [modality || "US"]
    );

    return fallback.rows[0] || null;
  }

  /**
   * Auto-fills template findings with extracted DICOM measurements (US Fetal, Cardiac, CT, etc.)
   */
  autoFillMeasurements(findingsText = "", measurements = {}) {
    let updated = findingsText;

    if (!measurements || typeof measurements !== "object") return updated;

    // Common measurement map replacements
    const measurementMap = {
      BPD: "Biparietal Diameter (BPD)",
      HC: "Head Circumference (HC)",
      AC: "Abdominal Circumference (AC)",
      FL: "Femur Length (FL)",
      FW: "Estimated Fetal Weight (FW)",
      HR: "Fetal Heart Rate (HR)",
      PSV: "Peak Systolic Velocity (PSV)",
      EDV: "End Diastolic Velocity (EDV)",
      RI: "Resistivity Index (RI)",
    };

    let measurementLines = "\n\n--- AUTO-FILLED DICOM MEASUREMENTS ---\n";
    let hasValues = false;

    for (const [key, val] of Object.entries(measurements)) {
      if (val) {
        hasValues = true;
        const label = measurementMap[key] || key;
        measurementLines += `• ${label}: ${val}\n`;
      }
    }

    if (hasValues && !updated.includes("AUTO-FILLED DICOM MEASUREMENTS")) {
      updated += measurementLines;
    }

    return updated;
  }

  /**
   * AI Impression Generator: Summarizes findings into a clear clinical impression
   */
  async generateAIImpression({ history = "", findings = "", modality = "", bodyPart = "" }) {
    if (!findings || findings.trim().length < 10) {
      return "No significant abnormality noted on current evaluation.";
    }

    const cleanFindings = findings
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Deterministic Smart Impression Engine
    const impressionPoints = [];

    if (/normal|unremarkable|no significant/i.test(cleanFindings) && !/abnormal|mass|lesion|fracture/i.test(cleanFindings)) {
      return `Unremarkable ${modality || ""} evaluation of the ${bodyPart || "target region"}. No acute abnormalities identified.`;
    }

    // Extract key findings sentences
    const sentences = cleanFindings.split(/(?<=[.!?])\s+/);
    sentences.forEach((sentence) => {
      if (/(mild|moderate|severe|mass|lesion|fracture|effusion|opacity|stenosis|dilation|calculus|nodule)/i.test(sentence)) {
        impressionPoints.push(sentence.trim());
      }
    });

    if (impressionPoints.length > 0) {
      return `1. ${impressionPoints.join("\n2. ")}\n\nClinical correlation recommended.`;
    }

    return `Structured ${modality || ""} examination completed. ${cleanFindings.slice(0, 150)}...`;
  }
}

module.exports = new AiReportingService();
