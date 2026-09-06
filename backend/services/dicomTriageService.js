const logger = require("../utils/logger");

class DicomTriageService {
  /**
   * Evaluates DICOM Metadata and assigns study priority (STAT, URGENT, ROUTINE)
   * @param {Object} dicomMeta 
   * @returns {{ priority: string, routeTarget: string, slaMinutes: number }}
   */
  evaluateTriage(dicomMeta = {}) {
    const { modality = "", bodyPart = "", studyDescription = "", patientAge = "" } = dicomMeta;
    const cleanModality = String(modality).toUpperCase();
    const cleanBodyPart = String(bodyPart).toUpperCase();
    const cleanDesc = String(studyDescription).toUpperCase();

    // Critical STAT criteria (e.g. Brain CT trauma, Stroke, Chest X-Ray pneumothorax)
    if (
      (cleanModality === "CT" && (cleanBodyPart.includes("HEAD") || cleanBodyPart.includes("BRAIN") || cleanDesc.includes("STROKE") || cleanDesc.includes("TRAUMA"))) ||
      (cleanModality === "CR" && cleanDesc.includes("PNEUMOTHORAX"))
    ) {
      logger.info("DICOM Triage Rule Triggered: STAT Priority Assigned", { modality, bodyPart, studyDescription });
      return {
        priority: "STAT",
        routeTarget: "NEURO_EMERGENCY_DESK",
        slaMinutes: 15,
      };
    }

    // URGENT criteria (e.g. Abdominal US, MRI Spine)
    if (
      cleanModality === "MR" ||
      (cleanModality === "US" && (cleanBodyPart.includes("ABDOMEN") || cleanBodyPart.includes("PELVIS")))
    ) {
      return {
        priority: "URGENT",
        routeTarget: "GENERAL_RADIOLOGY_DESK",
        slaMinutes: 60,
      };
    }

    // Default ROUTINE
    return {
      priority: "ROUTINE",
      routeTarget: "STANDARD_WORKLIST_POOL",
      slaMinutes: 240,
    };
  }
}

module.exports = new DicomTriageService();
