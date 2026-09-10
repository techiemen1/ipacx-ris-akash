const pool = require("../db");
const { getTenantScope } = require("../utils/tenantScope");

class PatientRepository {
  async getPatientColumns() {
    const result = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'patients'
      `
    );
    return new Set(result.rows.map((r) => r.column_name));
  }

  async findPatientByIdentifier(identifier, req = null) {
    const patientColumns = await this.getPatientColumns();
    const searchableColumns = ["uhid", "patient_id", "mrn", "id"].filter((col) =>
      patientColumns.has(col)
    );

    if (searchableColumns.length === 0) {
      return null;
    }

    const where = searchableColumns.map((col) => `${col}::text = $1`).join(" OR ");
    let query = `SELECT * FROM patients WHERE (${where})`;
    let params = [String(identifier)];

    if (req) {
      const scope = getTenantScope(req);
      query += ` AND ${scope.sql(2, 3)}`;
      params.push(scope.clinicId, scope.userId);
    }

    query += ` LIMIT 1`;
    const result = await pool.query(query, params);
    return result.rows[0] || null;
  }

  async getMRNConfig(clinicId) {
    if (!clinicId) return null;
    const cRes = await pool.query(
      "SELECT mrn_prefix, mrn_format, mrn_next_seq FROM clinics WHERE id = $1 LIMIT 1",
      [clinicId]
    );
    return cRes.rows[0] || null;
  }

  async incrementMRNSeq(clinicId) {
    if (!clinicId) return;
    await pool.query("UPDATE clinics SET mrn_next_seq = mrn_next_seq + 1 WHERE id = $1", [clinicId]);
  }

  async getMaxPatientId() {
    const pRes = await pool.query("SELECT MAX(id) as max_id FROM patients");
    return pRes.rows?.[0]?.max_id || 0;
  }

  async createPatient(record) {
    const patientColumns = await this.getPatientColumns();
    const insertCols = Object.keys(record).filter((col) => patientColumns.has(col));
    const insertValues = insertCols.map((col) => record[col]);
    const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");

    if (insertCols.length === 0) {
      throw new Error("Patients table has no compatible columns");
    }

    const result = await pool.query(
      `INSERT INTO patients (${insertCols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      insertValues
    );
    return result.rows[0];
  }

  async createInvoice(invoiceNumber, uhid, gross, discount, grandTotal, paymentStatus, paymentCategory) {
    return await pool.query(
      `INSERT INTO invoices (invoice_number, patient_id, total_amount, discount_amount, grand_total, payment_status, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceNumber, uhid, gross, discount, grandTotal, paymentStatus, paymentCategory]
    );
  }

  async findDuplicatePatient(idType, idNumber) {
    if (!idType || !idNumber) return null;
    const existing = await pool.query(
      `
      SELECT *
      FROM patients
      WHERE id_type = $1 AND id_number = $2
      LIMIT 1
      `,
      [idType, idNumber]
    );
    return existing.rows[0] || null;
  }

  async findPatientsForResequence(clinicId, userId) {
    const patientColumns = await this.getPatientColumns();
    const hasPatientId = patientColumns.has("patient_id");
    const hasUhid = patientColumns.has("uhid");
    const hasCreatedAt = patientColumns.has("created_at");
    const hasId = patientColumns.has("id");

    if (!hasPatientId && !hasUhid) {
      throw new Error("Neither patient_id nor uhid column exists in patients table");
    }

    const keyColumn = hasId ? "id" : hasUhid ? "uhid" : "patient_id";
    const orderExpr = hasCreatedAt
      ? "created_at ASC, id ASC"
      : hasId
      ? "id ASC"
      : "patient_id ASC NULLS LAST";

    const rows = await pool.query(
      `
      SELECT ${keyColumn} AS row_key${hasCreatedAt ? ", created_at" : ""}
      FROM patients
      WHERE (clinic_id = $1 OR clinic_id IN (SELECT clinic_id FROM user_clinics WHERE user_id = $2))
      ORDER BY ${orderExpr}
      `,
      [clinicId, userId]
    );

    return {
      rows: rows.rows,
      keyColumn,
      hasPatientId,
      hasUhid,
      hasCreatedAt,
    };
  }

  async updatePatientIdForResequence(keyColumn, hasPatientId, hasUhid, rowKey, newId, clinicId, userId) {
    if (hasPatientId && hasUhid) {
      await pool.query(
        `UPDATE patients SET patient_id = $1, uhid = $1 WHERE ${keyColumn}::text = $2 AND (clinic_id = $3 OR clinic_id IN (SELECT clinic_id FROM user_clinics WHERE user_id = $4))`,
        [newId, String(rowKey), clinicId, userId]
      );
    } else if (hasPatientId) {
      await pool.query(
        `UPDATE patients SET patient_id = $1 WHERE ${keyColumn}::text = $2 AND (clinic_id = $3 OR clinic_id IN (SELECT clinic_id FROM user_clinics WHERE user_id = $4))`,
        [newId, String(rowKey), clinicId, userId]
      );
    } else {
      await pool.query(
        `UPDATE patients SET uhid = $1 WHERE ${keyColumn}::text = $2 AND (clinic_id = $3 OR clinic_id IN (SELECT clinic_id FROM user_clinics WHERE user_id = $4))`,
        [newId, String(rowKey), clinicId, userId]
      );
    }
  }

  async getAllPatients(req) {
    const scope = getTenantScope(req, "p");
    const patientColumns = await this.getPatientColumns();
    const orderBy = patientColumns.has("created_at")
      ? "created_at DESC"
      : patientColumns.has("id")
      ? "id DESC"
      : patientColumns.has("patient_id")
      ? "patient_id DESC"
      : patientColumns.has("uhid")
      ? "uhid DESC"
      : "first_name ASC";

    const result = await pool.query(
      `
      SELECT 
        p.*,
        COALESCE(
          (SELECT payment_status FROM invoices WHERE patient_id = p.uhid OR patient_id = p.patient_id ORDER BY created_at DESC LIMIT 1),
          'PAID'
        ) as billing_status,
        (SELECT status FROM reports WHERE (patient_id = p.uhid OR patient_id = p.patient_id) AND ${scope.sql(1, 2)} ORDER BY updated_at DESC LIMIT 1) as report_status
      FROM patients p 
      WHERE ${scope.sql(1, 2)}
      ORDER BY p.${orderBy}
    `,
      [scope.clinicId, scope.userId]
    );

    return result;
  }

  async lookupPatients(field, q, limit, req) {
    const scope = getTenantScope(req);
    const patientColumns = await this.getPatientColumns();
    const orderBy = patientColumns.has("created_at")
      ? "created_at DESC NULLS LAST, id DESC"
      : patientColumns.has("id")
      ? "id DESC"
      : "uhid DESC NULLS LAST";

    let queryText = "";
    let queryParams = [];

    if (field === "mobile") {
      const digits = q.replace(/\D/g, "");
      queryText = `
        SELECT
          id, uhid, patient_id, mrn, full_name, first_name, last_name, gender, dob, mobile, abha_number, id_number
        FROM patients
        WHERE (
          regexp_replace(COALESCE(mobile::text, ''), '\\D', '', 'g') LIKE $1
          OR regexp_replace(COALESCE(phone::text, ''), '\\D', '', 'g') LIKE $1
        ) AND ${scope.sql(2, 3)}
        ORDER BY ${orderBy}
        LIMIT $4
      `;
      queryParams = [`%${digits}%`, scope.clinicId, scope.userId, limit];
    } else if (field === "abha_number") {
      queryText = `
        SELECT
          id, uhid, patient_id, mrn, full_name, first_name, last_name, gender, dob, mobile, abha_number, id_number
        FROM patients
        WHERE COALESCE(abha_number::text, '') ILIKE $1 AND ${scope.sql(2, 3)}
        ORDER BY ${orderBy}
        LIMIT $4
      `;
      queryParams = [`%${q}%`, scope.clinicId, scope.userId, limit];
    } else {
      queryText = `
        SELECT
          id, uhid, patient_id, mrn, full_name, first_name, last_name, gender, dob, mobile, abha_number, id_number
        FROM patients
        WHERE (
          COALESCE(id_number::text, '') ILIKE $1
          OR COALESCE(voter_id::text, '') ILIKE $1
        ) AND ${scope.sql(2, 3)}
        ORDER BY ${orderBy}
        LIMIT $4
      `;
      queryParams = [`%${q}%`, scope.clinicId, scope.userId, limit];
    }

    return await pool.query(queryText, queryParams);
  }

  async updatePatientByIdentifier(identifier, updates, req) {
    const scope = getTenantScope(req);
    const patientColumns = await this.getPatientColumns();
    const validCols = Object.keys(updates).filter((col) => patientColumns.has(col));

    if (validCols.length === 0) return null;

    const setClause = validCols.map((c, i) => `${c} = $${i + 1}`).join(", ");
    const values = validCols.map((c) => updates[c]);
    values.push(String(identifier));
    values.push(scope.clinicId);
    values.push(scope.userId);

    const searchableColumns = ["uhid", "patient_id", "mrn", "id"].filter((col) =>
      patientColumns.has(col)
    );
    const whereSearch = searchableColumns.map((col) => `${col}::text = $${values.length - 2}`).join(" OR ");

    const query = `
      UPDATE patients
      SET ${setClause}
      WHERE (${whereSearch}) AND ${scope.sql(values.length - 1, values.length)}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  async deletePatientByUhid(uhid, req) {
    const scope = getTenantScope(req);
    const result = await pool.query(
      `DELETE FROM patients WHERE uhid = $1 AND ${scope.sql(2, 3)} RETURNING *`,
      [uhid, scope.clinicId, scope.userId]
    );
    return result.rows[0] || null;
  }
}

module.exports = new PatientRepository();
