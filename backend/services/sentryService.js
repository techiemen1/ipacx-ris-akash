const logger = require("../utils/logger");

function initSentry(app) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry DSN not provided; running Sentry in mock/disabled mode.");
    return {
      requestHandler: (req, res, next) => next(),
      errorHandler: (err, req, res, next) => next(err),
      captureException: (err) => logger.error("Sentry Exception Captured (Mock)", { error: err.message }),
    };
  }

  try {
    const Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: 1.0,
    });
    logger.info("Sentry Node SDK initialized successfully.");
    return {
      requestHandler: Sentry.Handlers?.requestHandler() || ((req, res, next) => next()),
      errorHandler: Sentry.Handlers?.errorHandler() || ((err, req, res, next) => next(err)),
      captureException: (err) => Sentry.captureException(err),
    };
  } catch (err) {
    logger.warn("Sentry initialization failed", { error: err.message });
    return {
      requestHandler: (req, res, next) => next(),
      errorHandler: (err, req, res, next) => next(err),
      captureException: (err) => logger.error("Captured Exception", { error: err.message }),
    };
  }
}

module.exports = initSentry;
