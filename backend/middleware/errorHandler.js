const logger = require("../utils/logger");

function normalizeDatabaseError(err) {
  if (!err || !err.code) return null;

  if (err.code === "23505") {
    return {
      statusCode: 409,
      code: "DUPLICATE_RECORD",
      message: "A record with this value already exists",
    };
  }

  if (err.code === "22P02") {
    return {
      statusCode: 400,
      code: "INVALID_VALUE",
      message: "One or more values are invalid",
    };
  }

  return null;
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const dbError = normalizeDatabaseError(err);
  const statusCode = dbError?.statusCode || err.statusCode || 500;
  const code = dbError?.code || err.code || "INTERNAL_SERVER_ERROR";
  const isOperational = Boolean(dbError) || err.isOperational;

  const isProd = process.env.NODE_ENV === "production";
  const clientMessage = isOperational || !isProd
    ? (dbError?.message || err.message || "Internal server error")
    : "An unexpected internal server error occurred";

  logger.error("Unhandled API Error", {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    code,
    message: err.message,
    stack: err.stack,
    ip: req.ip,
  });

  res.status(statusCode).json({
    success: false,
    error: clientMessage,
    code,
    ...(err.details && (!isProd || isOperational) ? { details: err.details } : {}),
  });
}

module.exports = errorHandler;
