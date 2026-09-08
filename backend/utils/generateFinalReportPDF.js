const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const pool = require("../db");

module.exports = async function generateFinalReportPDF(
  report,
  images = [],
  options = { printMode: false }
) {
  // Fetch clinic branding
  let clinicBranding = {
    name: "iPACX Diagnostic Center",
    header_text: "Department of Radio-Diagnosis & Imaging",
    footer_text: "Electronically Verified Diagnostic Report",
    logo_url: null,
  };

  try {
    const clinicId = report.clinic_id || 1;
    const clinicRes = await pool.query("SELECT * FROM clinics WHERE id = $1", [clinicId]);
    if (clinicRes.rows.length) {
      const c = clinicRes.rows[0];
      clinicBranding = {
        name: c.name || clinicBranding.name,
        header_text: c.header_text || clinicBranding.header_text,
        footer_text: c.footer_text || clinicBranding.footer_text,
        logo_url: c.logo_url || null,
      };
    }
  } catch (err) {
    console.warn("Failed to load clinic branding, using defaults:", err.message);
  }

  // Generate QR Code data URL buffer
  let qrImageBuffer = null;
  try {
    const verificationUrl = `http://localhost:3000/secure-report-sheet?uid=${encodeURIComponent(report.study_uid || "")}`;
    qrImageBuffer = await QRCode.toBuffer(verificationUrl, { margin: 1, width: 80 });
  } catch (err) {
    console.warn("QR code generation failed:", err.message);
  }

  return new Promise((resolve, reject) => {
    try {
      const outputDir = path.join(__dirname, "..", "generated_pdfs");
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const pdfPath = path.join(outputDir, `REPORT_${report.id}_${Date.now()}.pdf`);
      const doc = new PDFDocument({ size: "A4", margin: 40 });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      const pageWidth = 595;
      const pageHeight = 842;
      let currentY = 30;

      const filterAiTerms = (content) => {
        if (!content) return "";
        return String(content)
          .replace(/\b(AUTO\s*)?GENERATE(D)?\s*(BY\s*)?AI\b/gi, "")
          .replace(/\bAI\s*(ASSISTED|GENERATED|IMPRESSION|FINDINGS|SUMMARY|NOTE|RECOMMENDATION|DRAFT)\b/gi, "")
          .replace(/\b(AI ASSISTED|AI GENERATED)\b/gi, "")
          .replace(/\bAI:\s*/gi, "")
          .replace(/\[\s*AI\s*[^\]]*\]/gi, "")
          .replace(/\s{2,}/g, " ")
          .trim();
      };

      const stripHTML = (text) => {
        if (!text) return "-";
        const cleaned = filterAiTerms(text);
        return cleaned
          .replace(/<\/div>/g, "\n")
          .replace(/<div>/g, "")
          .replace(/<\/?p[^>]*>/g, "\n")
          .replace(/<br\s*\/?>/g, "\n")
          .replace(/&nbsp;/g, " ")
          .replace(/<[^>]+>/g, "")
          .replace(/\n\s*\n/g, "\n")
          .trim();
      };

      /* -----------------------------
         HEADER (Dynamic Clinic Branding)
      ----------------------------- */
      if (!options.printMode) {
        if (clinicBranding.logo_url && fs.existsSync(clinicBranding.logo_url)) {
          doc.image(clinicBranding.logo_url, 40, currentY, { width: 60 });
        }
        doc.font("Helvetica-Bold").fontSize(14).text(clinicBranding.name, 0, currentY, { align: "center" });
        currentY += 18;
        doc.font("Helvetica").fontSize(10).text(clinicBranding.header_text, { align: "center" });
        currentY += 20;
        doc.moveTo(40, currentY).lineTo(pageWidth - 40, currentY).stroke();
        currentY += 12;
      }

      /* -----------------------------
         PATIENT INFO TABLE
      ----------------------------- */
      const startX = 40;
      const totalWidth = 515;
      const colW = totalWidth / 3;

      const drawRow = (data) => {
        let maxRowHeight = 20;
        const valueOffset = 75;

        data.forEach((item) => {
          const height =
            doc.font("Helvetica").fontSize(9).heightOfString(String(item.value || "N/A"), { width: colW - valueOffset - 5 }) + 8;
          if (height > maxRowHeight) maxRowHeight = height;
        });

        data.forEach((item, i) => {
          const x = startX + i * colW;
          doc.rect(x, currentY, colW, maxRowHeight).stroke();
          doc.font("Helvetica-Bold").fontSize(9).text(item.label, x + 4, currentY + 5);
          doc.font("Helvetica").fontSize(9).text(String(item.value || "N/A"), x + valueOffset, currentY + 5, { width: colW - valueOffset - 5 });
        });

        currentY += maxRowHeight;
      };

      let rawName = (report.patient_name || "N/A").replace(/\^/g, " ").trim();
      let cleanName = rawName;
      let age = report.patient_age || report.age || "N/A";
      let gender = report.patient_gender || report.gender || "N/A";

      const studyDate = report.study_date || report.study_date_time || "N/A";

      drawRow([
        { label: "Patient Name:", value: cleanName },
        { label: "Age/Gender:", value: `${age}/${gender}` },
        { label: "Patient ID:", value: report.patient_id || "N/A" },
      ]);

      drawRow([
        { label: "Study Date:", value: studyDate },
        { label: "Ref. Doctor:", value: report.referring_doctor || "N/A" },
        { label: "Accession No:", value: report.accession_number || "N/A" },
      ]);

      drawRow([
        { label: "Reported Date:", value: new Date().toLocaleString("en-IN") },
        { label: "Modality:", value: report.modality || "N/A" },
        { label: "Body Part:", value: report.body_part || "N/A" },
      ]);

      currentY += 15;

      /* -----------------------------
         REPORT TITLE
      ----------------------------- */
      const reportTitle = (report.report_title || `${report.modality || ""} ${report.body_part || ""} REPORT`).toUpperCase();
      doc.font("Helvetica-Bold").fontSize(12).text(reportTitle, 40, currentY, { align: "center" });
      currentY = doc.y + 12;

      /* -----------------------------
         HISTORY + FINDINGS
      ----------------------------- */
      const sections = [
        { label: "History:", val: report.report_content?.history },
        { label: "Findings:", val: report.report_content?.findings },
      ];

      sections.forEach((s) => {
        if (s.val) {
          if (currentY > pageHeight - 150) {
            doc.addPage();
            currentY = 40;
          }
          doc.font("Helvetica-Bold").fontSize(11).text(s.label, 40, currentY);
          currentY += 14;
          doc.font("Helvetica").fontSize(10).text(stripHTML(s.val), 40, currentY, { width: totalWidth, lineGap: 3, align: "justify" });
          currentY = doc.y + 12;
        }
      });

      /* -----------------------------
         KEY DIAGNOSTIC IMAGES & SNAPSHOTS
      ----------------------------- */
      const keyImages = (Array.isArray(report.report_content?.snapshots) && report.report_content.snapshots.length > 0)
        ? report.report_content.snapshots
        : (Array.isArray(images) ? images : []);

      if (keyImages.length > 0) {
        if (currentY > pageHeight - 160) {
          doc.addPage();
          currentY = 40;
        }
        doc.font("Helvetica-Bold").fontSize(11).text("Key Diagnostic Images / Annotations:", 40, currentY);
        currentY += 18;

        let xPos = 40;
        keyImages.forEach((img, i) => {
          let rawPath = typeof img === "string" ? img : (img.preview_url || img.image_path || img.url || "");
          let captionText = typeof img === "object" ? (img.caption || `Key Image ${i + 1}`) : `Key Image ${i + 1}`;
          
          if (rawPath && rawPath.startsWith("/")) {
            rawPath = path.join(__dirname, "..", rawPath);
          }

          if (fs.existsSync(rawPath)) {
            if (xPos + 110 > pageWidth - 40) {
              xPos = 40;
              currentY += 115;
            }
            if (currentY > pageHeight - 160) {
              doc.addPage();
              currentY = 40;
              xPos = 40;
            }

            try {
              doc.image(rawPath, xPos, currentY, { width: 100, height: 85 });
              doc.font("Helvetica").fontSize(8).text(captionText, xPos, currentY + 88, { width: 100, align: "center" });
            } catch (e) {
              console.warn("PDF Image draw notice:", e.message);
            }

            xPos += 115;
          }
        });
        currentY += 115;
      }

      /* -----------------------------
         CONCLUSION
      ----------------------------- */
      if (report.report_content?.conclusion) {
        if (currentY > pageHeight - 180) {
          doc.addPage();
          currentY = 40;
        }
        doc.font("Helvetica-Bold").fontSize(11).text("Conclusion:", 40, currentY);
        currentY += 14;
        doc.font("Helvetica-Bold").fontSize(10).text(stripHTML(report.report_content?.conclusion), 40, currentY, { width: totalWidth, lineGap: 3, align: "justify" });
        currentY = doc.y + 25;
      }

      /* -----------------------------
         SIGNATURES & QR CODE VERIFICATION
      ----------------------------- */
      if (currentY > pageHeight - 160) {
        doc.addPage();
        currentY = 50;
      }

      const formatSignature = (sig) => {
        if (!sig) return null;
        return {
          imagePath: sig.signature_url ? path.join(__dirname, "..", sig.signature_url) : null,
          fullName: sig.full_name,
          qualification: sig.qualification,
          signedOn: sig.dateTime ? new Date(sig.dateTime).toLocaleString("en-IN") : "",
        };
      };

      const reported = formatSignature(report.reported_by_signature);
      const approved = formatSignature(report.approved_by_signature);

      if (reported) {
        doc.font("Helvetica-Bold").fontSize(9).text("Reported By:", 50, currentY);
        let sigY = currentY + 12;
        if (reported.imagePath && fs.existsSync(reported.imagePath)) {
          doc.image(reported.imagePath, 50, sigY, { width: 90, height: 35 });
          sigY += 40;
        }
        doc.font("Helvetica").fontSize(9).text(reported.fullName || "", 50, sigY);
        doc.text(reported.qualification || "", 50);
      }

      if (approved) {
        doc.font("Helvetica-Bold").fontSize(9).text("Approved By:", 220, currentY);
        let sigY = currentY + 12;
        if (approved.imagePath && fs.existsSync(approved.imagePath)) {
          doc.image(approved.imagePath, 220, sigY, { width: 90, height: 35 });
          sigY += 40;
        }
        doc.font("Helvetica").fontSize(9).text(approved.fullName || "", 220, sigY);
        doc.text(approved.qualification || "", 220);
      }

      if (qrImageBuffer) {
        doc.image(qrImageBuffer, 460, currentY - 5, { width: 60, height: 60 });
        doc.font("Helvetica").fontSize(7).text("Scan to Verify", 460, currentY + 58, { width: 60, align: "center" });
      }

      /* -----------------------------
         FOOTER
      ----------------------------- */
      if (!options.printMode) {
        const footerText = clinicBranding.footer_text || "Electronically Verified Diagnostic Report";
        doc.font("Helvetica-Oblique").fontSize(8).text(footerText, 0, pageHeight - 40, { align: "center" });
      }

      doc.end();
      stream.on("finish", () => resolve(pdfPath));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
};
