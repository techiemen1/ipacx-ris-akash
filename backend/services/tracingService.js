const logger = require("../utils/logger");

let isTracingActive = false;

function initTracing() {
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const sdk = new NodeSDK({});
    sdk.start();
    isTracingActive = true;
    logger.info("OpenTelemetry distributed tracing initialized successfully.");
  } catch (err) {
    logger.warn("OpenTelemetry SDK startup skipped or running in lightweight mode", { error: err.message });
  }
}

module.exports = { initTracing, isTracingActive: () => isTracingActive };
