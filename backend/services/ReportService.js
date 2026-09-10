const path = require("path");
const fs = require("fs");
const reportRepository = require("../repositories/ReportRepository");
const generateFinalReportPDF = require("../utils/generateFinalReportPDF");
const { getTenantScope } = require("../utils/tenantScope");
const { logAction } = require("../utils/auditLogger");

const reportImagesDir = path.join(__dirname, "../uploads/report_images");
if (!fs.existsSync(reportImagesDir)) {
  fs.mkdirSync(reportImagesDir, { recursive: true });
}

function saveSnapshotToDisk(snapshotObj) {
  if (!snapshotObj) return null;
  const rawUrl = typeof snapshotObj === "string" 
    ? snapshotObj 
    : (snapshotObj.dataUrl || snapshotObj.preview_url || snapshotObj.previewUrl || snapshotObj.url || "");
  const caption = typeof snapshotObj === "object" ? (snapshotObj.caption || "Key Diagnostic Image") : "Key Diagnostic Image";
  
  if (!rawUrl) return null;

  const extraMeta = typeof snapshotObj === "object" ? {
    id: snapshotObj.id,
    instance_id: snapshotObj.instance_id,
    seriesDescription: snapshotObj.seriesDescription || snapshotObj.series_description,
    sliceNumber: snapshotObj.sliceNumber || snapshotObj.slice_number,
    sopInstanceUid: snapshotObj.sopInstanceUid || snapshotObj.sopInstanceUID,
    seriesInstanceUid: snapshotObj.seriesInstanceUid || snapshotObj.seriesInstanceUID,
    frameNumber: snapshotObj.frameNumber || snapshotObj.frameIndex || 1
  } : {};

  if (rawUrl.startsWith("data:image/")) {
    try {
      const matches = rawUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
        const base64Data = matches[2];
        const filename = `snap_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
        const filePath = path.join(reportImagesDir, filename);

        if (!fs.existsSync(reportImagesDir)) {
          fs.mkdirSync(reportImagesDir, { recursive: true });
        }

        fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
        return {
          ...extraMeta,
          preview_url: `/uploads/report_images/${filename}`,
          url: `/uploads/report_images/${filename}`,
          caption: caption
        };
      }
    } catch (err) {
      console.error("Failed saving base64 snapshot to disk:", err.message);
    }
  }

  return {
    ...extraMeta,
    preview_url: rawUrl,
    url: rawUrl,
    caption: caption
  };
}

function extractAgeFromName(name) {
  if (!name) return "N/A";
  const clean = String(name);
  const yearMatch = clean.match(/(\d{1,3})\s*\^?\s*Y\b/i);
  if (yearMatch) return yearMatch[1];
  const monthMatch = clean.match(/(\d{1,2})\s*\^?\s*(MONTH|M)\b/i);
  if (monthMatch) return `${monthMatch[1]} Months`;
  return "N/A";
}

function formatStudyDateTime(date, time) {
  if (!date) return "—";
  const yyyy = date.slice(0, 4);
  const mm = date.slice(4, 6);
  const dd = date.slice(6, 8);
  let result = `${dd}-${mm}-${yyyy}`;
  if (time && time.length >= 4) {
    const hh = time.slice(0, 2);
    const min = time.slice(2, 4);
    result += ` ${hh}:${min}`;
  }
  return result;
}

class ReportService {
  async getStudyReportByUid(req, uid) {
    const scope = getTenantScope(req);
    const study = await reportRepository.findStudyWithTenant(uid, req);
    if (!study) {
      throw { statusCode: 404, message: "Study not found" };
    }

    const report = await reportRepository.findLatestReport(uid, req);
    if (report) {
      report.addendum_reason = await reportRepository.findAddendumReason(report.id);
    }

    let images = [];
    if (report) {
      images = await reportRepository.findReportImages(report.id);
    }

    await logAction(req, {
      event: "READ_REPORT_DETAILS",
      page: `/api/study-report/${uid}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_REPORT_DETAILS",
        target_patient_id: study.patient_id,
        study_uid: uid,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      study: {
        ...study,
        study_datetime: formatStudyDateTime(study.study_date, study.study_time),
        age: study.patient_age || extractAgeFromName(study.patient_name),
        gender: study.patient_sex,
      },
      report: report
        ? {
            ...report,
            reported_by: report.reported_by_signature
              ? `${report.reported_by_signature.full_name || ""} ${report.reported_by_signature.qualification || ""}`.trim()
              : "N/A",
            approved_by: report.approved_by_signature
              ? `${report.approved_by_signature.full_name || ""} ${report.approved_by_signature.designation || ""}`.trim()
              : "N/A",
            study_datetime: formatStudyDateTime(study.study_date, study.study_time),
            reported_datetime: report.created_at ? new Date(report.created_at).toLocaleString() : "—",
            images,
            addendum_reason: report.addendum_reason,
          }
        : null,
    };
  }

  async getAllReports(req) {
    const scope = getTenantScope(req);
    const result = await reportRepository.getAllReports(req);

    await logAction(req, {
      event: "READ_REPORT_LIST",
      page: "/api/reports",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_REPORT_LIST",
        count: result.rowCount,
        timestamp: new Date().toISOString(),
      },
    });

    return result.rows;
  }

  async saveReport(req) {
    const scope = getTenantScope(req);
    const userRole = String(req.user?.role || "").toUpperCase();
    const canSaveReport = ["ADMIN", "RADIOLOGIST", "DOCTOR", "SUPERVISOR"].includes(userRole);
    if (req.user?.role && !canSaveReport) {
      throw {
        statusCode: 403,
        message: `🔒 Access Denied: Users logged in with role '${userRole}' are not authorized to create, edit, or save diagnostic reports. Report editing is restricted to Radiologists and Physicians.`
      };
    }
    const {
      study_uid,
      accession_number,
      patient_id,
      patient_name,
      modality,
      reported_by_signature,
      approved_by_signature,
      status,
      body_part,
      referring_doctor,
      isAddendum,
      reportTitle,
      conclusion,
    } = req.body;

    const history = req.body.history ?? req.body.report_content?.history ?? "";
    const findings = req.body.findings ?? req.body.report_content?.findings ?? "";
    const snapshots = req.body.snapshots ?? req.body.report_content?.snapshots ?? [];

    const processedSnapshots = [];
    if (Array.isArray(snapshots)) {
      for (const s of snapshots) {
        const processed = saveSnapshotToDisk(s);
        if (processed && processed.preview_url) {
          processedSnapshots.push(processed);
        }
      }
    }

    const reportContent = {
      history,
      findings,
      conclusion,
      title: reportTitle,
      snapshots: processedSnapshots,
    };

    const existingSigned = await reportRepository.findSignedReport(study_uid, req);
    if (existingSigned && status !== "Addendum" && !isAddendum && req.body.allowAdminOverride !== true) {
      throw {
        statusCode: 403,
        message:
          "🔒 This radiology report has been FINALLY SIGNED OFF and is legally locked from direct modification. Please select 'Create Addendum' to record an official addendum.",
      };
    }

    let existingSignatures = { reported_by_signature: null, approved_by_signature: null };
    if (status === "Final" || status === "Addendum" || isAddendum) {
      existingSignatures = await reportRepository.findPreviousSignatures(study_uid, req);
    }

    const finalReportedSignature = reported_by_signature || existingSignatures.reported_by_signature;
    const finalApprovedSignature = approved_by_signature || existingSignatures.approved_by_signature;

    let reportId;

    if (status === "Addendum" || isAddendum) {
      const previousReport = (await reportRepository.findLatestReport(study_uid, req)) || {};
      const resolvedAccession = accession_number || previousReport.accession_number || null;
      const resolvedPatientId = patient_id || previousReport.patient_id || null;
      const resolvedPatientName = patient_name || previousReport.patient_name || null;
      const resolvedModality = modality || previousReport.modality || null;
      const resolvedTitle = reportTitle || previousReport.report_title || null;
      const resolvedBodyPart = body_part || previousReport.body_part || null;
      const resolvedRefDoctor = referring_doctor || previousReport.referring_doctor || null;

      reportId = await reportRepository.insertAddendumReport(
        study_uid,
        resolvedAccession,
        resolvedPatientId,
        resolvedPatientName,
        resolvedModality,
        reportContent,
        finalReportedSignature,
        finalApprovedSignature,
        resolvedTitle,
        resolvedBodyPart,
        resolvedRefDoctor,
        scope.clinicId
      );
    } else if (status === "Final") {
      const draft = await reportRepository.findDraftReport(study_uid, req);
      if (draft) {
        reportId = await reportRepository.updateReportToFinal(
          reportContent,
          finalReportedSignature,
          finalApprovedSignature,
          reportTitle,
          body_part,
          referring_doctor,
          draft.id,
          req
        );
      } else {
        const finalRep = await reportRepository.findFinalReport(study_uid, req);
        if (finalRep) {
          reportId = await reportRepository.updateFinalReport(
            reportContent,
            finalReportedSignature,
            finalApprovedSignature,
            reportTitle,
            body_part,
            referring_doctor,
            finalRep.id,
            req
          );
        } else {
          reportId = await reportRepository.insertFinalReport(
            study_uid,
            accession_number,
            patient_id,
            patient_name,
            modality,
            reportContent,
            finalReportedSignature,
            finalApprovedSignature,
            reportTitle,
            body_part,
            referring_doctor,
            scope.clinicId
          );
        }
      }
    } else {
      const existingDraft = await reportRepository.findDraftForUpdate(study_uid, req);
      if (existingDraft) {
        const draftReportedSignature = reported_by_signature || existingDraft.reported_by_signature;
        const draftApprovedSignature = approved_by_signature || existingDraft.approved_by_signature;
        reportId = await reportRepository.updateDraftReport(
          reportContent,
          draftReportedSignature,
          draftApprovedSignature,
          reportTitle,
          body_part,
          referring_doctor,
          existingDraft.id,
          req
        );
      } else {
        reportId = await reportRepository.insertDraftReport(
          study_uid,
          accession_number,
          patient_id,
          patient_name,
          modality,
          reportContent,
          reported_by_signature,
          approved_by_signature,
          reportTitle,
          body_part,
          referring_doctor,
          scope.clinicId
        );
      }
    }

    if (processedSnapshots.length > 0) {
      await reportRepository.replaceReportImages(reportId, processedSnapshots);
    }

    const eventName =
      status === "Final"
        ? "REPORT_FINAL_SAVED"
        : status === "Addendum" || isAddendum
        ? "REPORT_ADDENDUM_SAVED"
        : "REPORT_DRAFT_SAVED";

    await logAction(req, {
      event: eventName,
      page: "/api/reports/save",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: eventName,
        target_patient_id: patient_id,
        report_id: reportId,
        study_uid,
        accession_number,
        patient_name,
        modality,
        report_title: reportTitle || null,
        timestamp: new Date().toISOString(),
      },
    });

    return reportId;
  }

  async getReportByStudyUid(req, uid) {
    const scope = getTenantScope(req);
    const report = await reportRepository.findLatestReport(uid, req);
    if (!report) return null;

    report.addendum_reason = await reportRepository.findAddendumReason(report.id);

    if (!report.reported_by_signature || !report.approved_by_signature) {
      const prevFinalSigs = await reportRepository.findPreviousSignatures(uid, req);
      report.reported_by_signature = report.reported_by_signature || prevFinalSigs.reported_by_signature;
      report.approved_by_signature = report.approved_by_signature || prevFinalSigs.approved_by_signature;
    }

    const imagesRes = await reportRepository.findReportImages(report.id);

    let content = report.report_content || {};
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        content = {};
      }
    }

    const loadedSnapshots = imagesRes.map((img, i) => ({
      id: `snap_${img.sort_order || i}`,
      instance_id: `img_${i}`,
      preview_url: img.image_path,
      caption: img.caption || `Key Diagnostic Image ${i + 1}`,
    }));

    const finalSnapshots =
      Array.isArray(content.snapshots) && content.snapshots.length > 0 ? content.snapshots : loadedSnapshots;

    await logAction(req, {
      event: "READ_REPORT_BY_STUDY",
      page: `/api/reports/by-study/${uid}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "READ_REPORT_BY_STUDY",
        target_patient_id: report.patient_id,
        study_uid: uid,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      id: report.id,
      study_uid: report.study_uid,
      status: report.status,
      report_content: content,
      snapshots: finalSnapshots,
      history: content.history || "",
      findings: content.findings || "",
      conclusion: content.conclusion || "",
      report_title: content.title || report.report_title || "",
      title: content.title || report.report_title || "",
      body_part: report.body_part,
      referring_doctor: report.referring_doctor,
      reported_by_signature: report.reported_by_signature,
      approved_by_signature: report.approved_by_signature,
      addendum_reason: report.addendum_reason,
      images: imagesRes,
    };
  }

  async saveAddendumReason(req) {
    const scope = getTenantScope(req);
    const { report_id, study_uid, reason, created_by } = req.body;

    if (!report_id || !reason) {
      throw { statusCode: 400, message: "Missing data" };
    }

    const checkReport = await reportRepository.findReportByIdOrStudy(report_id, study_uid, req);
    if (!checkReport) {
      throw { statusCode: 403, message: "Unauthorized or report not found" };
    }

    const addendumId = await reportRepository.insertAddendumReason(report_id, study_uid, reason, created_by);

    await logAction(req, {
      event: "SAVE_ADDENDUM_REASON",
      page: "/api/addendum/save-reason",
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "SAVE_ADDENDUM_REASON",
        target_patient_id: checkReport.patient_id,
        report_id,
        study_uid,
        timestamp: new Date().toISOString(),
      },
    });

    return addendumId;
  }

  async generateReportPdf(req, reportId, printMode = false) {
    const scope = getTenantScope(req);
    const report = await reportRepository.findReportForPdf(reportId, req);

    if (!report) {
      throw { statusCode: 404, message: "Report not found" };
    }

    const imagesRes = await reportRepository.findReportImages(reportId);
    const pdfPath = await generateFinalReportPDF(report, imagesRes, { printMode });

    const eventName = printMode ? "PRINT_REPORT_PDF" : "GENERATE_REPORT_PDF";
    await logAction(req, {
      event: eventName,
      page: `/api/reports/${reportId}/pdf${printMode ? "/print" : ""}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: eventName,
        target_patient_id: report.patient_id,
        report_id: reportId,
        timestamp: new Date().toISOString(),
      },
    });

    return pdfPath;
  }

  async generateStudyReportPdf(req, studyUid, requestedType) {
    const scope = getTenantScope(req);
    const report = await reportRepository.findReportForStudyPdf(studyUid, requestedType, req);

    if (!report) {
      throw { statusCode: 404, message: "No report found for this study" };
    }

    const imagesRes = await reportRepository.findReportImages(report.id);
    const pdfPath = await generateFinalReportPDF(report, imagesRes, { printMode: false });

    await logAction(req, {
      event: "GENERATE_STUDY_REPORT_PDF",
      page: `/api/reports/study/${studyUid}/pdf`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "GENERATE_STUDY_REPORT_PDF",
        target_patient_id: report.patient_id,
        study_uid: studyUid,
        timestamp: new Date().toISOString(),
      },
    });

    return pdfPath;
  }

  async deleteReport(req, id) {
    const scope = getTenantScope(req);
    const rep = await reportRepository.findReportCheckForDelete(id, req);

    if (!rep) {
      throw { statusCode: 404, message: "Report not found or unauthorized" };
    }

    const isSigned = ["Final", "Signed", "Approved", "FINAL", "COMPLETED"].includes(rep.status);
    if (isSigned && req.user?.role !== "ADMIN" && req.query.adminOverride !== "true") {
      throw {
        statusCode: 403,
        message: "🔒 Signed radiology reports are legally locked and cannot be deleted per medical-legal compliance requirements.",
      };
    }

    await reportRepository.deleteReport(id, req);

    await logAction(req, {
      event: "DELETE_REPORT",
      page: `/api/reports/${id}`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "DELETE_REPORT",
        target_patient_id: rep.patient_id,
        report_id: id,
        study_uid: rep.study_uid,
        status: rep.status,
        timestamp: new Date().toISOString(),
      },
    });
  }

  async saveKeyImagesForStudy(req, studyUid, keyImages = []) {
    const scope = getTenantScope(req);
    const study = await reportRepository.findStudyWithTenant(studyUid, req);
    if (!study) {
      throw { statusCode: 404, message: "Study not found or access denied" };
    }

    const processedSnapshots = [];
    if (Array.isArray(keyImages)) {
      for (const img of keyImages) {
        const processed = saveSnapshotToDisk(img);
        if (processed && processed.preview_url) {
          processedSnapshots.push({
            ...processed,
            sopInstanceUid: img.sopInstanceUid || img.sopInstanceUID || null,
            seriesInstanceUid: img.seriesInstanceUid || img.seriesInstanceUID || null,
            frameNumber: img.frameNumber || img.frameIndex || 1
          });
        }
      }
    }

    const report = await reportRepository.findLatestReport(studyUid, req);
    if (report && processedSnapshots.length > 0) {
      await reportRepository.replaceReportImages(report.id, processedSnapshots);
    }

    await logAction(req, {
      event: "SAVE_STUDY_KEY_IMAGES",
      page: `/api/studies/${studyUid}/key-images`,
      details: {
        user_id: scope.userId,
        clinic_id: scope.clinicId,
        action: "SAVE_STUDY_KEY_IMAGES",
        study_uid: studyUid,
        count: processedSnapshots.length,
        timestamp: new Date().toISOString(),
      },
    });

    return processedSnapshots;
  }
}

module.exports = new ReportService();
