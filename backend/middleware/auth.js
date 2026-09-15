const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    return null;
  }
  return String(secret);
}

const PUBLIC_EXACT_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/auth/login",
  "/api/login",
  "/auth/login",
  "/login",
]);

const PUBLIC_PREFIX_PATTERNS = [
  /^\/api\/v1\/public\//,
  /^\/api\/public\//,
  /^\/public\//,
  /^\/api\/pacs\/instance-preview\//,
  /^\/api\/pacs\/instance-tags\//,
  /^\/api\/pacs\/dicom-tags\//,
  /^\/api\/pacs\/mobile-study\//,
  /^\/api\/pacs\/study-series-instances\//,
  /^\/api\/pacs\/export\//,
  /^\/api\/reports\/.*\/pdf/,
];

function isPublicPath(pathname = "", originalUrl = "") {
  const cleanPath = String(pathname || "").split("?")[0].toLowerCase();
  const cleanOriginalUrl = String(originalUrl || "").split("?")[0].toLowerCase();

  if (PUBLIC_EXACT_PATHS.has(cleanPath) || PUBLIC_EXACT_PATHS.has(cleanOriginalUrl)) {
    return true;
  }

  for (const pattern of PUBLIC_PREFIX_PATTERNS) {
    if (pattern.test(cleanPath) || pattern.test(cleanOriginalUrl)) {
      return true;
    }
  }

  return false;
}

module.exports = function requireAuth(req, res, next) {
  if (isPublicPath(req.path, req.originalUrl)) return next();

  const secret = getJwtSecret();
  if (!secret) {
    return res.status(500).json({ message: "JWT_SECRET is not configured" });
  }

  const header = req.headers.authorization || "";
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token && req.query && req.query.token) {
    token = String(req.query.token);
  }

  if (!token) {
    return res.status(401).json({ message: "Authorization token missing" });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
