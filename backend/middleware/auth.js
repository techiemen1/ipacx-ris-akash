const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !String(secret).trim()) {
    return null;
  }
  return String(secret);
}

function isPublicPath(pathname = "", originalUrl = "") {
  const p1 = String(pathname || "").toLowerCase();
  const p2 = String(originalUrl || "").toLowerCase();
  return (
    p1.includes("/login") || p2.includes("/login") ||
    p1.includes("/logout") || p2.includes("/logout") ||
    p1.includes("/verify") || p2.includes("/verify") ||
    p1.includes("/public") || p2.includes("/public")
  );
}

module.exports = function requireAuth(req, res, next) {
  if (isPublicPath(req.path, req.originalUrl)) return next();

  const secret = getJwtSecret();
  if (!secret) {
    return res.status(500).json({ message: "JWT_SECRET is not configured" });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
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
