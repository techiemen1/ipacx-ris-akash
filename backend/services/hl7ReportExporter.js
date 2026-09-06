const VT = "\x0b";
const FS = "\x1c";
const CR = "\x0d";

function formatHl7Timestamp(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}${h}${min}${s}`;
}

function sanitizeHl7Field(text) {
  return String(text || "")
    .replace(/\|/g, "\\F\\")
    .replace(/\^/g, "\\S\\")
    .replace(/\&/g, "\\T\\")
    .replace(/~/g, "\\R\\")
    .replace(/\r?\n|\r/g, " ");
}

/**
 * Formats a signed radiology report into an HL7 ORU^R01 Observation Result ER7 string.
 */
function buildHl7OruR01(reportData, options = {}) {
  const ts = formatHl7Timestamp(new Date());
  const controlId = `ORU_${reportData.id || Date.now()}`;
  const sendingApp = options.sendingApp || "iPACX_RIS";
  const sendingFacility = options.sendingFacility || "MAIN_CLINIC";
  const receivingApp = options.receivingApp || "HIS";
  const receivingFacility = options.receivingFacility || "HOSPITAL";

  const msh = `MSH|^~\\&|${sendingApp}|${sendingFacility}|${receivingApp}|${receivingFacility}|${ts}||ORU^R01|${controlId}|P|2.3.1`;
  const pid = `PID|1||${sanitizeHl7Field(reportData.patient_id)}||${sanitizeHl7Field(reportData.patient_name)}||||||||||||`;
  const obr = `OBR|1|${sanitizeHl7Field(reportData.accession_number)}|${sanitizeHl7Field(reportData.accession_number)}|RADIOLOGY_REPORT^${sanitizeHl7Field(reportData.report_title || "Radiology Report")}|||${ts}|||||||||${sanitizeHl7Field(reportData.referring_doctor || "")}||||||||F`;

  const findingsText = typeof reportData.report_content === "string" 
    ? reportData.report_content 
    : (reportData.findings || reportData.report_content?.text || "");

  const obx1 = `OBX|1|TX|FINDINGS^Findings||${sanitizeHl7Field(findingsText)}||||||F`;
  const obx2 = `OBX|2|TX|IMPRESSION^Conclusion||${sanitizeHl7Field(reportData.conclusion || reportData.impression || "Unremarkable scan.")}||||||F`;
  
  const pacsViewerUrl = options.pacsViewerUrl || `http://localhost:3000/pacspage?studyUID=${reportData.study_uid || ''}`;
  const obx3 = `OBX|3|RP|PACS_LINK^PACS Web Viewer||${sanitizeHl7Field(pacsViewerUrl)}||||||F`;

  const er7 = [msh, pid, obr, obx1, obx2, obx3].join(CR) + CR;
  const mllpFramed = `${VT}${er7}${FS}${CR}`;

  return {
    controlId,
    er7,
    mllpFramed,
  };
}

module.exports = {
  buildHl7OruR01,
  formatHl7Timestamp,
  sanitizeHl7Field,
};
