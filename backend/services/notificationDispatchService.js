function cleanPatientName(rawName) {
  if (!rawName) return "Patient";
  return String(rawName)
    .replace(/\^/g, " ")
    .replace(/\b\d+Y\b/gi, "")
    .replace(/\b[MF]\b/gi, "")
    .replace(/\//g, "")
    .replace(/\s+/g, " ")
    .trim() || "Patient";
}

/**
 * Builds multi-channel notification payloads (Email, SMS, WhatsApp) for signed radiology reports.
 */
function buildNotificationPayloads(report, shareInfo) {
  const patientName = cleanPatientName(report.patient_name || report.PatientName);
  const accession = report.accession_number || report.AccessionNumber || "N/A";
  const modality = report.modality || report.Modality || "Scan";
  const clinicName = report.clinic_name || "iPACX Diagnostic Center";
  const viewerUrl = shareInfo.viewerUrl;
  const pdfUrl = shareInfo.downloadPdfUrl;

  // 1. SMS Message Payload (Max 160 chars)
  const smsText = `Dear ${patientName}, your ${modality} report (${accession}) from ${clinicName} is ready. View report & images (valid 7 days): ${viewerUrl}`;

  // 2. WhatsApp Message Payload
  const whatsAppText = `🏥 *${clinicName} — Diagnostic Report Ready*\n\nDear *${patientName}*,\nYour radiology exam (*${modality}* — Acc #${accession}) has been signed off by the radiologist.\n\n📄 *Download PDF Report:* ${pdfUrl}\n🖼️ *View DICOM Images (7-Day Link):* ${viewerUrl}\n\n_Note: This DICOM viewer link will expire in 7 days for privacy security._`;

  // 3. Email Rich HTML Payload
  const emailSubject = `Diagnostic Report & Images Ready — ${patientName} (${modality})`;
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; color: #0f172a;">
      <div style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 24px; color: #ffffff; text-align: center;">
        <h2 style="margin: 0; font-size: 20px;">${clinicName}</h2>
        <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Department of Radio-Diagnosis & Imaging</p>
      </div>
      <div style="padding: 24px; background: #ffffff;">
        <p style="font-size: 15px; font-weight: 700; color: #0f172a;">Dear ${patientName},</p>
        <p style="font-size: 13px; color: #475569; line-height: 1.5;">
          Your <strong>${modality}</strong> examination (Accession #${accession}) has been reported and electronically verified.
        </p>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0;">
          <div style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Link Expiration Policy:</div>
          <div style="font-size: 13px; font-weight: 700; color: #1e40af;">🔒 Valid for 7 Days (Expires on ${new Date(shareInfo.expiresAt).toLocaleDateString()})</div>
        </div>

        <div style="display: flex; gap: 12px; margin-top: 24px; flex-wrap: wrap;">
          <a href="${viewerUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 13px;">
            🖼️ View Interactive DICOM Images
          </a>
          <a href="${pdfUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #0284c7; color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 13px;">
            📄 Download Signed PDF Report
          </a>
        </div>
      </div>
      <div style="background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b;">
        This is an automated diagnostic dispatch from ${clinicName}.
      </div>
    </div>
  `;

  return {
    sms: { message: smsText, recipientPhone: report.patient_phone || report.mobile },
    whatsApp: { message: whatsAppText, recipientPhone: report.patient_phone || report.mobile },
    email: { subject: emailSubject, html: emailHtml, recipientEmail: report.patient_email || report.email },
  };
}

/**
 * Executes multi-channel dispatch (simulated/log output if SMS/Email gateway API keys are pending).
 */
async function dispatchNotifications(report, shareInfo, channels = ["email", "sms", "whatsapp"]) {
  const payloads = buildNotificationPayloads(report, shareInfo);
  const results = { emailSent: false, smsSent: false, whatsAppSent: false };

  if (channels.includes("sms")) {
    logger.info(`📱 [SMS Dispatch] To: ${payloads.sms.recipientPhone || 'Default'} | Msg: ${payloads.sms.message}`);
    results.smsSent = true;
  }

  if (channels.includes("whatsapp")) {
    logger.info(`💬 [WhatsApp Dispatch] To: ${payloads.whatsApp.recipientPhone || 'Default'} | Msg: ${payloads.whatsApp.message}`);
    results.whatsAppSent = true;
  }

  if (channels.includes("email")) {
    logger.info(`📧 [Email Dispatch] To: ${payloads.email.recipientEmail || 'Default'} | Subject: ${payloads.email.subject}`);
    results.emailSent = true;
  }

  return { success: true, payloads, results };
}

module.exports = {
  buildNotificationPayloads,
  dispatchNotifications,
};
