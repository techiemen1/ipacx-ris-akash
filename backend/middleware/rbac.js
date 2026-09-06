const logger = require("../utils/logger");

const ROLES = {
  ADMIN: "ADMIN",
  RADIOLOGIST: "RADIOLOGIST",
  DOCTOR: "DOCTOR",
  TECHNICIAN: "TECHNICIAN",
  PATIENT: "PATIENT",
};

/**
 * Middleware factory restricting endpoint access to specific clinical roles
 * @param  {...string} allowedRoles 
 */
function checkRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }

    const userRole = String(req.user.role || "").toUpperCase();
    const normalizedAllowed = allowedRoles.map((r) => String(r).toUpperCase());

    // ADMIN legacy role bypass option
    if (userRole === "ADMIN" || userRole === "SUPERADMIN") {
      return next();
    }

    if (!normalizedAllowed.includes(userRole)) {
      logger.warn("Access Denied: Insufficient Clinical Role Permissions", {
        userId: req.user.id,
        userRole,
        requiredRoles: allowedRoles,
        path: req.originalUrl,
      });
      return res.status(403).json({
        success: false,
        error: "Access Denied: You do not have permission to access this resource",
      });
    }

    return next();
  };
}

module.exports = { checkRole, ROLES };
