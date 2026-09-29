const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    return null;
  }
  return String(secret);
}

/**
 * SECURITY: Exact paths that are completely public
 * These require NO authentication whatsoever
 * Examples: Login, public hospital info, health checks
 */
const PUBLIC_EXACT_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/auth/login",
  "/api/login",
  "/auth/login",
  "/login",
]);

/**
 * SECURITY: Prefix patterns for public routes
 * Limited to:
 * - /api/public/* (explicit public endpoints)
 * - /public/* (static public content)
 * 
 * REMOVED: /api/pacs/*, /api/reports/*/pdf - these require auth
 */
const PUBLIC_PREFIX_PATTERNS = [
  /^\/api\/v1\/public\//,
  /^\/api\/public\//,
  /^\/public\//,
];

/**
 * Determines if a request path requires authentication
 * @param {string} pathname - Express route path
 * @param {string} originalUrl - Original URL with query params
 * @returns {boolean} True if path is public (no auth required)
 */
function isPublicPath(pathname = "", originalUrl = "") {
  const cleanPath = String(pathname || "").split("?")[0].toLowerCase();
  const cleanOriginalUrl = String(originalUrl || "").split("?")[0].toLowerCase();

  // Check exact matches
  if (PUBLIC_EXACT_PATHS.has(cleanPath) || PUBLIC_EXACT_PATHS.has(cleanOriginalUrl)) {
    return true;
  }

  // Check prefix patterns
  for (const pattern of PUBLIC_PREFIX_PATTERNS) {
    if (pattern.test(cleanPath) || pattern.test(cleanOriginalUrl)) {
      return true;
    }
  }

  return false;
}

/**
 * CRITICAL SECURITY MIDDLEWARE
 * Enforces JWT authentication on all non-public routes
 * 
 * PROTECTED ROUTES (require authentication):
 * - /api/pacs/* (DICOM images & metadata) - HIPAA Protected
 * - /api/reports/* (Medical reports & PDFs) - HIPAA Protected
 * - /api/patients/* (Patient data) - HIPAA Protected
 * - /api/studies/* (Study information) - HIPAA Protected
 * - /api/ai/* (AI reports) - HIPAA Protected
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware
 * @returns {void}
 */
module.exports = function requireAuth(req, res, next) {
  // Allow public paths to bypass authentication
  if (isPublicPath(req.path, req.originalUrl)) {
    return next();
  }

  const secret = getJwtSecret();
  if (!secret) {
    return res.status(500).json({ 
      message: "Server configuration error: JWT_SECRET not set",
      timestamp: new Date().toISOString()
    });
  }

  // Attempt to extract token from Authorization header (Bearer scheme)
  const header = req.headers.authorization || "";
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;

  // Fallback: Check query parameter (for iframe/embed scenarios)
  // SECURITY NOTE: Query params are less secure (logged in URLs, browser history)
  // Only used as fallback when Authorization header is unavailable
  if (!token && req.query && req.query.token) {
    token = String(req.query.token);
    console.warn(`[Auth] Token extracted from query param for ${req.path} - consider using Authorization header`, {
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
  }

  if (!token) {
    return res.status(401).json({ 
      message: "Authorization token missing",
      detail: "Provide token in Authorization header (Bearer scheme) or ?token query param",
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Verify token signature and expiration
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    
    // Log successful authentication for audit
    console.log(`[Auth] Token verified for user: ${decoded.id || decoded.email || 'unknown'}`, {
      path: req.path,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
    
    return next();
  } catch (err) {
    // Token is invalid or expired
    return res.status(401).json({ 
      message: "Invalid or expired token",
      detail: err.message,
      timestamp: new Date().toISOString()
    });
  }
};
