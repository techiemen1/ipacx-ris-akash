/**
 * Helper to build verified tenant scoping SQL condition and parameters.
 * Strictly uses verified user claims from req.user (not untrusted client headers).
 */
function getTenantScope(req, tableAlias = "") {
  const prefix = tableAlias ? `${tableAlias}.` : "";
  const userId = Number(req.user?.id || req.user?.user_id || 0);
  const verifiedClinicId = Number(req.user?.clinic_id || req.clinicId || 1);

  return {
    userId,
    clinicId: verifiedClinicId,
    /**
     * Returns parameterized SQL fragment ensuring strict multi-tenant isolation.
     * Checks both primary verified clinic_id and multi-clinic assignments in user_clinics.
     * @param {number} p1Index - Parameter position for primary clinicId
     * @param {number} p2Index - Parameter position for userId
     */
    sql: (p1Index, p2Index) =>
      `(${prefix}clinic_id = $${p1Index} OR ${prefix}clinic_id IN (SELECT clinic_id FROM user_clinics WHERE user_id = $${p2Index}))`,
  };
}

module.exports = { getTenantScope };
