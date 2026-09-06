const AppError = require("../utils/AppError");

/**
 * Tenant scoping middleware.
 * Attaches hospitalId and clinicId to request based on user session or fallback headers.
 */
module.exports = function tenantAuth(req, res, next) {
  const isAdmin = req.user && ["ADMIN", "SUPER_ADMIN"].includes(req.user.role);
  
  // Extract tenant info strictly from authenticated user token claims unless elevated Admin
  let rawHospitalId = req.user?.hospital_id;
  let rawClinicId = req.user?.clinic_id;

  if (isAdmin || (!rawHospitalId && !rawClinicId)) {
    rawHospitalId = rawHospitalId || req.headers["x-hospital-id"];
    rawClinicId = rawClinicId || req.headers["x-clinic-id"];
  }

  const hospitalId = Number(rawHospitalId || 1);
  const clinicId = Number(rawClinicId || 1);

  req.hospitalId = isNaN(hospitalId) ? 1 : hospitalId;
  req.clinicId = isNaN(clinicId) ? 1 : clinicId;

  /**
   * Generates SQL WHERE clause snippet and values array for tenant scoping
   * @param {number} paramOffset - Starting parameter index (e.g. 1 or 2)
   * @param {string} tableAlias - Optional table alias prefix (e.g. 'p.')
   */
  req.getTenantScope = (paramOffset = 1, tableAlias = "") => {
    const prefix = tableAlias ? `${tableAlias}.` : "";
    return {
      sql: `${prefix}clinic_id = $${paramOffset}`,
      values: [req.clinicId],
      nextOffset: paramOffset + 1,
    };
  };

  next();
};
