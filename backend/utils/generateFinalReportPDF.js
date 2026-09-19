const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const pool = require("../db");

module.exports = async function generateFinalReportPDF(
  report,
  images = [],
  options = { printMode: false, pageSetup: {} }
) {
  // Fetch clinic branding
  let clinicBranding = {
    name: "AKASH MEDICAL COLLEGE AND HOSPITALS",
    header_text: "DEPARTMENT OF RADIO-DIAGNOSIS & ADVANCED IMAGING",
    address: "Prasannahalli Main Road, Devanahalli, Bengaluru, Karnataka 562110",
    phone: "+91 80 7115 9900 / +91 98865 17662",
    email: "info@akashmedical.edu.in",
    nabh_id: "NABH-H-2024-0891",
    nabl_id: "NABL-M-4821",
    registration_no: "KMC/MED/REG/48190",
    footer_text: "Electronically Verified Diagnostic Report • NABH & NABL Accredited",
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
        address: c.address || clinicBranding.address,
        phone: c.phone || clinicBranding.phone,
        email: c.email || clinicBranding.email,
        nabh_id: c.nabh_id || clinicBranding.nabh_id,
        nabl_id: c.nabl_id || clinicBranding.nabl_id,
        registration_no: c.registration_no || clinicBranding.registration_no,
        footer_text: c.footer_text || clinicBranding.footer_text,
        logo_url: c.logo_url || null,
      };
    }
  } catch (err) {
    console.warn("Failed to load clinic branding, using defaults:", err.message);
  }

  // Generate QR Code data URL buffer
  let qrImageBuffer = null;
  // Query DB Key Images if not passed
  let keyImages = (Array.isArray(report.report_content?.snapshots) && report.report_content.snapshots.length > 0)
    ? report.report_content.snapshots
    : (Array.isArray(images) && images.length > 0 ? images : []);

  if (keyImages.length === 0 && report.study_uid) {
    try {
      const dbKeyImgs = await pool.query(
        "SELECT * FROM public.study_key_images WHERE study_uid = $1 ORDER BY id ASC",
        [report.study_uid]
      );
      if (dbKeyImgs && dbKeyImgs.rows.length > 0) {
        keyImages = dbKeyImgs.rows;
      }
    } catch (e) {}
  }

  return new Promise((resolve, reject) => {
    try {
      const pageSetup = options.pageSetup || {};
      const paperSize = pageSetup.paperSize || "A4";
      const marginSize = pageSetup.margins === "compact" ? 30 : pageSetup.margins === "wide" ? 50 : 40;
      const isPrePrinted = !!pageSetup.prePrintedStationery;
      const showFooter = pageSetup.showFooter !== false;

      const outputDir = path.join(__dirname, "..", "generated_pdfs");
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const pdfPath = path.join(outputDir, `REPORT_${report.id}_${Date.now()}.pdf`);
      const doc = new PDFDocument({ size: paperSize, margin: marginSize });
      const stream = fs.createWriteStream(pdfPath);
      doc.pipe(stream);

      const pageWidth = paperSize === "Letter" ? 612 : 595;
      const pageHeight = paperSize === "Letter" ? 792 : 842;
      let currentY = marginSize;

      const filterAiTerms = (content) => {
        if (!content) return "";
        return String(content)
          .replace(/<div[^>]*>.*?🤖.*?<\/div>/gi, "")
          .replace(/<div[^>]*>.*?AI\s*(GENERATED|SUMMARY)?\s*IMPRESSION.*?<\/div>/gi, "")
          .replace(/<strong[^>]*>.*?🤖.*?<\/strong>/gi, "")
          .replace(/<strong[^>]*>.*?AI\s*(GENERATED|SUMMARY)?\s*IMPRESSION.*?<\/strong>/gi, "")
          .replace(/🤖\s*(AI GENERATED|AI SUMMARY)?\s*IMPRESSION:?/gi, "")
          .replace(/🤖\s*IMPRESSION:?/gi, "")
          .replace(/🤖/g, "")
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
      const drawHeader = (startY = marginSize) => {
        let y = startY;
        if (!options.printMode && !isPrePrinted) {
          if (clinicBranding.logo_url && fs.existsSync(clinicBranding.logo_url)) {
            doc.image(clinicBranding.logo_url, marginSize, y, { width: 60 });
          }
          doc.font("Helvetica-Bold").fontSize(13).text(clinicBranding.name.toUpperCase(), 0, y, { align: "center" });
          y += 16;
          doc.font("Helvetica-Bold").fontSize(9).text(clinicBranding.header_text.toUpperCase(), { align: "center" });
          y += 13;
          doc.font("Helvetica").fontSize(8).text(`${clinicBranding.address} • Helpline: ${clinicBranding.phone}`, { align: "center" });
          y += 16;
          doc.moveTo(marginSize, y).lineTo(pageWidth - marginSize, y).stroke();
          return y + 12;
        } else if (isPrePrinted) {
          return y + 60;
        }
        return y;
      };

      const addNewPage = () => {
        doc.addPage();
        currentY = drawHeader(marginSize);
      };

      currentY = drawHeader(marginSize);

      /* -----------------------------
         PATIENT INFO TABLE
      ----------------------------- */
      const startX = marginSize;
      const totalWidth = pageWidth - (marginSize * 2);
      const colW = totalWidth / 3;

      const drawRow = (data) => {
        let maxRowHeight = 18;
        const valueOffset = 75;

        data.forEach((item) => {
          const height =
            doc.font("Helvetica").fontSize(9).heightOfString(String(item.value || "N/A"), { width: colW - valueOffset - 5 }) + 6;
          if (height > maxRowHeight) maxRowHeight = height;
        });

        data.forEach((item, i) => {
          const x = startX + i * colW;
          doc.rect(x, currentY, colW, maxRowHeight).stroke();
          doc.font("Helvetica-Bold").fontSize(8.5).text(item.label, x + 4, currentY + 4);
          doc.font("Helvetica").fontSize(8.5).text(String(item.value || "N/A"), x + valueOffset, currentY + 4, { width: colW - valueOffset - 5 });
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
        { label: "Reported Date:", value: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) },
        { label: "Modality:", value: report.modality || "N/A" },
        { label: "Body Part:", value: report.body_part || "N/A" },
      ]);

      currentY += 12;

      /* -----------------------------
         REPORT TITLE
      ----------------------------- */
      const reportTitle = (report.report_title || `${report.modality || ""} ${report.body_part || ""} REPORT`).toUpperCase();
      doc.font("Helvetica-Bold").fontSize(11).text(reportTitle, marginSize, currentY, { align: "center" });
      currentY = doc.y + 10;

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
            addNewPage();
          }
          doc.font("Helvetica-Bold").fontSize(10).text(s.label, marginSize, currentY);
          currentY += 12;
          doc.font("Helvetica").fontSize(9.5).text(stripHTML(s.val), marginSize, currentY, { width: totalWidth, lineGap: 3, align: "justify" });
          currentY = doc.y + 10;
        }
      });

      /* -----------------------------
         KEY DIAGNOSTIC IMAGES & SNAPSHOTS (SUPPORT BASE64 DATA URLS & DB PERSISTED IMAGES)
      ----------------------------- */
      if (keyImages.length > 0) {
        if (currentY > pageHeight - 180) {
          addNewPage();
        }
        doc.font("Helvetica-Bold").fontSize(10).text("Key Diagnostic Images:", marginSize, currentY);
        currentY += 16;

        const imgWidth = 230;
        const imgHeight = 165;
        const gap = 20;

        let colIdx = 0;

        for (let i = 0; i < keyImages.length; i++) {
          const img = keyImages[i];
          let rawPath = typeof img === "string" ? img : (img.image_path || img.preview_url || img.previewUrl || img.url || "");
          let captionText = typeof img === "object" ? (img.caption || `Key Image ${i + 1}`) : `Key Image ${i + 1}`;
          
          let imgSource = null;
          if (rawPath.startsWith("data:image/")) {
            const base64Data = rawPath.split(",")[1];
            if (base64Data) {
              imgSource = Buffer.from(base64Data, "base64");
            }
          } else if (rawPath && rawPath.startsWith("/")) {
            const absPath = path.join(__dirname, "..", rawPath);
            if (fs.existsSync(absPath)) imgSource = absPath;
          } else if (rawPath && fs.existsSync(rawPath)) {
            imgSource = rawPath;
          }

          if (imgSource) {
            const xPos = marginSize + colIdx * (imgWidth + gap);

            if (currentY + imgHeight + 35 > pageHeight - marginSize) {
              addNewPage();
              doc.font("Helvetica-Bold").fontSize(10).text("Key Diagnostic Images (Cont.):", marginSize, currentY);
              currentY += 16;
              colIdx = 0;
            }

            try {
              doc.rect(xPos - 2, currentY - 2, imgWidth + 4, imgHeight + 4).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
              doc.image(imgSource, xPos, currentY, { width: imgWidth, height: imgHeight, fit: [imgWidth, imgHeight], align: 'center', valign: 'center' });
              doc.font("Helvetica").fontSize(8).fillColor("#334155").text(captionText, xPos, currentY + imgHeight + 4, { width: imgWidth, align: "center" });
            } catch (e) {
              console.warn("PDF Image draw notice:", e.message);
            }

            colIdx++;
            if (colIdx >= 2) {
              colIdx = 0;
              currentY += imgHeight + 30;
            }
          }
        }

        if (colIdx > 0) {
          currentY += imgHeight + 30;
        }
        currentY += 10;
        doc.fillColor("#000000"); // Reset fill color
      }

      /* -----------------------------
         CONCLUSION
      ----------------------------- */
      if (report.report_content?.conclusion) {
        if (currentY > pageHeight - 180) {
          addNewPage();
        }
        doc.font("Helvetica-Bold").fontSize(10).text("Conclusion:", marginSize, currentY);
        currentY += 12;
        doc.font("Helvetica-Bold").fontSize(9.5).text(stripHTML(report.report_content?.conclusion), marginSize, currentY, { width: totalWidth, lineGap: 3, align: "justify" });
        currentY = doc.y + 20;
      }

      /* -----------------------------
         SIGNATURES & QR CODE VERIFICATION
      ----------------------------- */
      if (showFooter) {
        if (currentY > pageHeight - 150) {
          addNewPage();
        }

        const formatSignature = (sig) => {
          if (!sig) return null;
          return {
            imagePath: sig.signature_url ? path.join(__dirname, "..", sig.signature_url) : null,
            fullName: sig.full_name,
            qualification: sig.qualification,
            signedOn: sig.dateTime ? new Date(sig.dateTime).toLocaleDateString("en-IN") : "",
          };
        };

        const reported = formatSignature(report.reported_by_signature);
        const approved = formatSignature(report.approved_by_signature);

        if (reported) {
          doc.font("Helvetica-Bold").fontSize(8.5).text("Reported By:", marginSize + 10, currentY);
          let sigY = currentY + 10;
          if (reported.imagePath && fs.existsSync(reported.imagePath)) {
            doc.image(reported.imagePath, marginSize + 10, sigY, { width: 80, height: 30 });
            sigY += 34;
          }
          doc.font("Helvetica").fontSize(8.5).text(reported.fullName || "", marginSize + 10, sigY);
          doc.text(reported.qualification || "", marginSize + 10);
        }

        if (approved) {
          doc.font("Helvetica-Bold").fontSize(8.5).text("Approved By:", 220, currentY);
          let sigY = currentY + 10;
          if (approved.imagePath && fs.existsSync(approved.imagePath)) {
            doc.image(approved.imagePath, 220, sigY, { width: 80, height: 30 });
            sigY += 34;
          }
          doc.font("Helvetica").fontSize(8.5).text(approved.fullName || "", 220, sigY);
          doc.text(approved.qualification || "", 220);
        }

        if (qrImageBuffer) {
          doc.image(qrImageBuffer, pageWidth - marginSize - 60, currentY - 5, { width: 55, height: 55 });
          doc.font("Helvetica").fontSize(6.5).text("Scan to Verify", pageWidth - marginSize - 60, currentY + 52, { width: 55, align: "center" });
        }
      }

      /* -----------------------------
         FOOTER
      ----------------------------- */
      if (!options.printMode && !isPrePrinted) {
        const footerText = clinicBranding.footer_text || "Electronically Verified Diagnostic Report";
        doc.font("Helvetica-Oblique").fontSize(7.5).text(footerText, 0, pageHeight - 30, { align: "center" });
      }

      doc.end();
      stream.on("finish", () => resolve(pdfPath));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
};
