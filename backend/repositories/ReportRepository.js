const pool = require("../db");
const { getTenantScope } = require("../utils/tenantScope");

class ReportRepository {
  async findStudyWithTenant(uid, req) {
    const scope = getTenantScope(req, "s");
    const studyRes = await pool.query(
      `SELECT s.* FROM studies s WHERE s.study_uid=$1 AND ${scope.sql(2, 3)}`,
      [uid, scope.clinicId, scope.userId]
    );
    return studyRes.rows[0] || null;
  }

  async findLatestReport(uid, req) {
    const scope = getTenantScope(req, "r");
    const reportRes = await pool.query(
      `
      SELECT r.*
      FROM reports r
      WHERE r.study_uid = $1 AND ${scope.sql(2, 3)}
      ORDER BY (r.status = 'Addendum') DESC, r.created_at DESC
      LIMIT 1
      `,
      [uid, scope.clinicId, scope.userId]
    );
    return reportRes.rows[0] || null;
  }

  async findAddendumReason(reportId) {
    const addendumRes = await pool.query(
      `SELECT reason 
       FROM report_addendums 
       WHERE report_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [reportId]
    );
    return addendumRes.rows[0]?.reason || null;
  }

  async findReportImages(reportId) {
    const imagesRes = await pool.query(
      `SELECT image_path, caption, image_type, sort_order 
       FROM report_images 
       WHERE report_id=$1 
       ORDER BY sort_order`,
      [reportId]
    );
    return imagesRes.rows;
  }

  async getAllReports(req) {
    const scope = getTenantScope(req, "r");
    const result = await pool.query(
      `
      SELECT
        r.id,
        r.study_uid,
        r.accession_number,
        r.patient_id,
        r.patient_name,
        r.modality,
        r.status,
        r.reported_by_signature,
        r.approved_by_signature,
        r.created_at
      FROM reports r
      WHERE ${scope.sql(1, 2)}
      ORDER BY r.created_at DESC
      `,
      [scope.clinicId, scope.userId]
    );
    return result;
  }

  async findSignedReport(studyUid, req) {
    const scope = getTenantScope(req);
    const existingSigned = await pool.query(
      `SELECT id, status FROM reports
       WHERE study_uid = $1 AND status IN ('Final', 'Signed', 'Approved', 'FINAL', 'COMPLETED')
         AND ${scope.sql(2, 3)}
       ORDER BY updated_at DESC LIMIT 1`,
      [studyUid, scope.clinicId, scope.userId]
    );
    return existingSigned.rows[0] || null;
  }

  async findPreviousSignatures(studyUid, req) {
    const scope = getTenantScope(req);
    const prevReport = await pool.query(
      `SELECT reported_by_signature, approved_by_signature
       FROM reports
       WHERE study_uid=$1 AND ${scope.sql(2, 3)}
       ORDER BY updated_at DESC
       LIMIT 1`,
      [studyUid, scope.clinicId, scope.userId]
    );
    return prevReport.rows[0] || { reported_by_signature: null, approved_by_signature: null };
  }

  async insertAddendumReport(
    study_uid,
    accession_number,
    patient_id,
    patient_name,
    modality,
    reportContent,
    reportedSig,
    approvedSig,
    reportTitle,
    body_part,
    referring_doctor,
    clinicId
  ) {
    const result = await pool.query(
      `INSERT INTO reports (
        study_uid, accession_number, patient_id, patient_name,
        modality, report_content, reported_by_signature, approved_by_signature,
        status, report_title, body_part, referring_doctor, clinic_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Addendum',$9,$10,$11,$12)
      RETURNING id`,
      [
        study_uid,
        accession_number,
        patient_id,
        patient_name,
        modality,
        reportContent,
        reportedSig,
        approvedSig,
        reportTitle,
        body_part,
        referring_doctor,
        clinicId,
      ]
    );
    return result.rows[0].id;
  }

  async findDraftReport(studyUid, req) {
    const scope = getTenantScope(req);
    const draft = await pool.query(
      `SELECT id FROM reports
       WHERE study_uid=$1 AND status='Draft' AND ${scope.sql(2, 3)}
       ORDER BY updated_at DESC LIMIT 1`,
      [studyUid, scope.clinicId, scope.userId]
    );
    return draft.rows[0] || null;
  }

  async updateReportToFinal(reportContent, reportedSig, approvedSig, reportTitle, body_part, referring_doctor, draftId, req) {
    const scope = getTenantScope(req);
    const result = await pool.query(
      `UPDATE reports
       SET report_content=$1,
           reported_by_signature=$2,
           approved_by_signature=$3,
           status='Final',
           report_title=$4,
           body_part=$5,
           referring_doctor=$6,
           updated_at=NOW()
       WHERE id=$7 AND ${scope.sql(8, 9)}
       RETURNING id`,
      [
        reportContent,
        reportedSig,
        approvedSig,
        reportTitle,
        body_part,
        referring_doctor,
        draftId,
        scope.clinicId,
        scope.userId,
      ]
    );
    return result.rows[0].id;
  }

  async findFinalReport(studyUid, req) {
    const scope = getTenantScope(req);
    const final = await pool.query(
      `SELECT id FROM reports
       WHERE study_uid=$1 AND status='Final' AND ${scope.sql(2, 3)}
       ORDER BY updated_at DESC LIMIT 1`,
      [studyUid, scope.clinicId, scope.userId]
    );
    return final.rows[0] || null;
  }

  async updateFinalReport(reportContent, reportedSig, approvedSig, reportTitle, body_part, referring_doctor, finalId, req) {
    const scope = getTenantScope(req);
    const result = await pool.query(
      `UPDATE reports
       SET report_content=$1,
           reported_by_signature=$2,
           approved_by_signature=$3,
           report_title=$4,
           body_part=$5,
           referring_doctor=$6,
           updated_at=NOW()
       WHERE id=$7 AND ${scope.sql(8, 9)}
       RETURNING id`,
      [
        reportContent,
        reportedSig,
        approvedSig,
        reportTitle,
        body_part,
        referring_doctor,
        finalId,
        scope.clinicId,
        scope.userId,
      ]
    );
    return result.rows[0].id;
  }

  async insertFinalReport(study_uid, accession_number, patient_id, patient_name, modality, reportContent, reportedSig, approvedSig, reportTitle, body_part, referring_doctor, clinicId) {
    const result = await pool.query(
      `INSERT INTO reports (
        study_uid, accession_number, patient_id, patient_name,
        modality, report_content, reported_by_signature, approved_by_signature,
        status, report_title, body_part, referring_doctor, clinic_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Final',$9,$10,$11,$12)
      RETURNING id`,
      [
        study_uid,
        accession_number,
        patient_id,
        patient_name,
        modality,
        reportContent,
        reportedSig,
        approvedSig,
        reportTitle,
        body_part,
        referring_doctor,
        clinicId,
      ]
    );
    return result.rows[0].id;
  }

  async findDraftForUpdate(studyUid, req) {
    const scope = getTenantScope(req);
    const existingDraft = await pool.query(
      `SELECT id, reported_by_signature, approved_by_signature FROM reports
       WHERE study_uid=$1 AND status='Draft' AND ${scope.sql(2, 3)}
       ORDER BY updated_at DESC LIMIT 1`,
      [studyUid, scope.clinicId, scope.userId]
    );
    return existingDraft.rows[0] || null;
  }

  async updateDraftReport(reportContent, reportedSig, approvedSig, reportTitle, body_part, referring_doctor, draftId, req) {
    const scope = getTenantScope(req);
    const result = await pool.query(
      `UPDATE reports
       SET report_content=$1,
           reported_by_signature=$2,
           approved_by_signature=$3,
           report_title=$4,
           body_part=$5,
           referring_doctor=$6,
           updated_at=NOW()
       WHERE id=$7 AND ${scope.sql(8, 9)}
       RETURNING id`,
      [
        reportContent,
        reportedSig,
        approvedSig,
        reportTitle,
        body_part,
        referring_doctor,
        draftId,
        scope.clinicId,
        scope.userId,
      ]
    );
    return result.rows[0].id;
  }

  async insertDraftReport(study_uid, accession_number, patient_id, patient_name, modality, reportContent, reportedSig, approvedSig, reportTitle, body_part, referring_doctor, clinicId) {
    const result = await pool.query(
      `INSERT INTO reports (
        study_uid, accession_number, patient_id, patient_name,
        modality, report_content, reported_by_signature, approved_by_signature,
        status, report_title, body_part, referring_doctor, clinic_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft',$9,$10,$11,$12)
      RETURNING id`,
      [
        study_uid,
        accession_number,
        patient_id,
        patient_name,
        modality,
        reportContent,
        reportedSig,
        approvedSig,
        reportTitle,
        body_part,
        referring_doctor,
        clinicId,
      ]
    );
    return result.rows[0].id;
  }

  async replaceReportImages(reportId, snapshots) {
    await pool.query(`DELETE FROM report_images WHERE report_id=$1`, [reportId]);
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      await pool.query(
        `INSERT INTO report_images (report_id, image_path, caption, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [reportId, snap.preview_url, snap.caption || "Key Diagnostic Image", i + 1]
      );
    }
  }

  async findReportByIdOrStudy(reportId, studyUid, req) {
    const scope = getTenantScope(req, "r");
    const checkReport = await pool.query(
      `SELECT r.id, r.patient_id FROM reports r WHERE (r.id = $1 OR r.study_uid = $2) AND ${scope.sql(3, 4)} LIMIT 1`,
      [reportId, studyUid, scope.clinicId, scope.userId]
    );
    return checkReport.rows[0] || null;
  }

  async insertAddendumReason(reportId, studyUid, reason, createdBy) {
    const result = await pool.query(
      `INSERT INTO report_addendums 
       (report_id, study_uid, reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id`,
      [reportId, studyUid, reason, createdBy]
    );
    return result.rows[0].id;
  }

  async findReportForPdf(reportId, req) {
    const scope = getTenantScope(req, "r");
    const reportRes = await pool.query(
      `SELECT
          r.*,
          COALESCE(NULLIF(r.accession_number, ''), base.accession_number) AS accession_number,
          COALESCE(NULLIF(r.patient_id, ''), base.patient_id) AS patient_id,
          COALESCE(NULLIF(r.patient_name, ''), base.patient_name) AS patient_name,
          COALESCE(NULLIF(r.modality, ''), base.modality) AS modality,
          COALESCE(NULLIF(r.report_title, ''), base.report_title) AS report_title,
          COALESCE(NULLIF(r.body_part, ''), base.body_part) AS body_part,
          COALESCE(NULLIF(r.referring_doctor, ''), base.referring_doctor) AS referring_doctor,
          s.study_date,
          s.study_time,
          (SELECT reason
           FROM report_addendums
           WHERE report_id = r.id
           ORDER BY created_at DESC
           LIMIT 1) AS addendum_reason
       FROM reports r
       LEFT JOIN LATERAL (
         SELECT
           rb.accession_number,
           rb.patient_id,
           rb.patient_name,
           rb.modality,
           rb.report_title,
           rb.body_part,
           rb.referring_doctor
         FROM reports rb
         WHERE rb.study_uid = r.study_uid
           AND rb.id <> r.id
         ORDER BY (rb.status = 'Final') DESC, rb.updated_at DESC, rb.created_at DESC
         LIMIT 1
       ) base ON TRUE
       LEFT JOIN studies s ON r.study_uid = s.study_uid
       WHERE r.id = $1 AND ${scope.sql(2, 3)}`,
      [reportId, scope.clinicId, scope.userId]
    );
    return reportRes.rows[0] || null;
  }

  async findReportForStudyPdf(studyUid, requestedType, req) {
    const scope = getTenantScope(req, "r");
    let query = `
      SELECT
        r.*,
        COALESCE(NULLIF(r.accession_number, ''), base.accession_number) AS accession_number,
        COALESCE(NULLIF(r.patient_id, ''), base.patient_id) AS patient_id,
        COALESCE(NULLIF(r.patient_name, ''), base.patient_name) AS patient_name,
        COALESCE(NULLIF(r.modality, ''), base.modality) AS modality,
        COALESCE(NULLIF(r.report_title, ''), base.report_title) AS report_title,
        COALESCE(NULLIF(r.body_part, ''), base.body_part) AS body_part,
        COALESCE(NULLIF(r.referring_doctor, ''), base.referring_doctor) AS referring_doctor,
        s.study_date,
        s.study_time,
        (SELECT reason
         FROM report_addendums
         WHERE report_id = r.id
         ORDER BY created_at DESC
         LIMIT 1) AS addendum_reason
      FROM reports r
      LEFT JOIN LATERAL (
        SELECT
          rb.accession_number,
          rb.patient_id,
          rb.patient_name,
          rb.modality,
          rb.report_title,
          rb.body_part,
          rb.referring_doctor
        FROM reports rb
        WHERE rb.study_uid = r.study_uid
          AND rb.id <> r.id
        ORDER BY (rb.status = 'Final') DESC, rb.updated_at DESC, rb.created_at DESC
        LIMIT 1
      ) base ON TRUE
      LEFT JOIN studies s ON r.study_uid = s.study_uid
      WHERE r.study_uid = $1 AND ${scope.sql(2, 3)}
    `;

    const params = [studyUid, scope.clinicId, scope.userId];
    if (requestedType) {
      query += ` AND r.status = $4 ORDER BY r.created_at DESC LIMIT 1`;
      params.push(requestedType);
    } else {
      query += ` ORDER BY (r.status = 'Addendum') DESC, r.created_at DESC LIMIT 1`;
    }

    const reportRes = await pool.query(query, params);
    return reportRes.rows[0] || null;
  }

  async findReportCheckForDelete(id, req) {
    const scope = getTenantScope(req, "r");
    const reportCheck = await pool.query(
      `SELECT r.id, r.status, r.study_uid, r.patient_id FROM reports r WHERE r.id=$1 AND ${scope.sql(2, 3)}`,
      [id, scope.clinicId, scope.userId]
    );
    return reportCheck.rows[0] || null;
  }

  async deleteReport(id, req) {
    const scope = getTenantScope(req, "r");
    await pool.query("DELETE FROM report_images WHERE report_id=$1", [id]);
    await pool.query("DELETE FROM report_addendums WHERE report_id=$1", [id]);
    await pool.query(`DELETE FROM reports r WHERE r.id=$1 AND ${scope.sql(2, 3)}`, [
      id,
      scope.clinicId,
      scope.userId,
    ]);
  }

  async findPatientPriorStudies(patientId, currentStudyUid) {
    if (!patientId) return [];
    const result = await pool.query(
      `SELECT r.id, r.study_uid, r.patient_id, r.patient_name, r.modality, r.body_part, r.accession_number, r.status, r.report_title, r.report_content, r.created_at, r.updated_at
       FROM reports r
       WHERE r.patient_id = $1 AND r.study_uid <> $2
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [patientId, currentStudyUid || ""]
    );
    return result.rows;
  }
}

module.exports = new ReportRepository();
