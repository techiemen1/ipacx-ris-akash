const net = require("net");
const pool = require("../db");
const logger = require("../utils/logger");

const VT = "\x0b"; // MLLP Start Block (Vertical Tab)
const FS = "\x1c"; // MLLP End Block (File Separator)
const CR = "\x0d"; // Carriage Return

function parseHl7Er7(message) {
  const segments = String(message || "")
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("|"));

  if (!segments.length || segments[0][0] !== "MSH") {
    throw new Error("Invalid HL7 message: missing MSH header segment");
  }

  const getSegment = (name) => segments.find((segment) => segment[0] === name) || [];
  const msh = getSegment("MSH");
  const pid = getSegment("PID");
  const pv1 = getSegment("PV1");
  const obr = getSegment("OBR");

  const patientNameParts = String(pid[5] || "").split("^");
  const lastName = patientNameParts[0] || "";
  const firstName = patientNameParts[1] || "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  return {
    sendingApp: msh[2] || "HIS",
    sendingFacility: msh[3] || "HOSPITAL",
    messageType: msh[8] || "ORM^O01",
    controlId: msh[9] || `MSG_${Date.now()}`,
    patientId: pid[3] || pid[2] || `PAT_${Date.now()}`,
    firstName,
    lastName,
    fullName,
    dob: pid[7] || null,
    gender: pid[8] || "O",
    phone: pid[13] || null,
    accessionNumber: obr[3] || obr[2] || `ACC_${Date.now()}`,
    studyDescription: obr[4] || "Diagnostic Radiology Exam",
    modality: obr[24] || "CR",
    referringDoctor: pv1[7] || obr[16] || "",
    scheduledAt: obr[7] || new Date().toISOString(),
  };
}

function buildHl7Ack(parsed, ackCode = "AA", textMessage = "Message Processed Successfully") {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const msh = `MSH|^~\\&|iPACX_RIS|MAIN_CLINIC|${parsed.sendingApp}|${parsed.sendingFacility}|${timestamp}||ACK^O01|ACK_${Date.now()}|P|2.3.1`;
  const msa = `MSA|${ackCode}|${parsed.controlId}|${textMessage}`;
  return `${VT}${msh}${CR}${msa}${CR}${FS}${CR}`;
}

async function processIncomingHl7Order(parsed) {
  // 1. Ensure Patient Record Exists
  try {
    await pool.query(
      `INSERT INTO patients (patient_id, uhid, first_name, last_name, full_name, gender, dob, mobile, referring_doctor)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (patient_id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         gender = EXCLUDED.gender,
         mobile = COALESCE(EXCLUDED.mobile, patients.mobile)`,
      [
        parsed.patientId,
        parsed.firstName,
        parsed.lastName,
        parsed.fullName,
        parsed.gender,
        parsed.dob ? new Date(parsed.dob) : null,
        parsed.phone,
        parsed.referringDoctor,
      ]
    );
  } catch (err) {
    logger.warn("HL7 Patient UPSERT warning:", err.message);
  }

  // 2. Insert into DICOM Modality Worklist (MWL)
  try {
    await pool.query(
      `INSERT INTO mwl (PatientID, PatientName, PatientSex, AccessionNumber, StudyDescription, Modality, ReferringPhysician, SchedulingDate, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NEW')
       ON CONFLICT DO NOTHING`,
      [
        parsed.patientId,
        parsed.fullName,
        parsed.gender,
        parsed.accessionNumber,
        parsed.studyDescription,
        parsed.modality,
        parsed.referringDoctor,
        new Date(parsed.scheduledAt || Date.now()),
      ]
    );
    logger.info(`🟢 HL7 Order Processed: Patient ${parsed.patientId} / Acc #${parsed.accessionNumber} (${parsed.modality})`);
  } catch (err) {
    logger.error("HL7 MWL INSERT error:", err.message);
  }
}

function startHl7MllpServer(port = 6060) {
  const server = net.createServer((socket) => {
    logger.info(`🔌 HL7 MLLP Client Connected: ${socket.remoteAddress}:${socket.remotePort}`);
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");

      while (buffer.includes(VT) && buffer.includes(FS)) {
        const startIndex = buffer.indexOf(VT);
        const endIndex = buffer.indexOf(FS, startIndex);

        if (startIndex !== -1 && endIndex !== -1) {
          const rawMessage = buffer.substring(startIndex + 1, endIndex);
          buffer = buffer.substring(endIndex + 1);

          try {
            const parsed = parseHl7Er7(rawMessage);
            await processIncomingHl7Order(parsed);
            const ack = buildHl7Ack(parsed, "AA", "Order Accepted into iPACX RIS MWL");
            socket.write(ack);
          } catch (err) {
            logger.error("HL7 MLLP Parse/Ingest Error:", err.message);
            const dummyParsed = { sendingApp: "HIS", sendingFacility: "HOSPITAL", controlId: "UNKNOWN" };
            const errorAck = buildHl7Ack(dummyParsed, "AE", err.message);
            socket.write(errorAck);
          }
        } else {
          break;
        }
      }
    });

    socket.on("error", (err) => {
      logger.warn(`HL7 MLLP Socket Error: ${err.message}`);
    });

    socket.on("close", () => {
      logger.info("HL7 MLLP Connection Closed");
    });
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info(`🚀 iPACX HL7 MLLP TCP Ingest Server listening on 0.0.0.0:${port}`);
  });

  return server;
}

module.exports = {
  startHl7MllpServer,
  parseHl7Er7,
  buildHl7Ack,
  processIncomingHl7Order,
};
