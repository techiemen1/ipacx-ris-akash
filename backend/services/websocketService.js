const { Server } = require("socket.io");
const logger = require("../utils/logger");

let io = null;

const { registerSpeechDictationHandlers } = require("./speechDictationService");

function initWebSockets(server) {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    logger.info(`WebSocket Client Connected: ${socket.id}`);

    // Register Medical Speech Dictation handlers
    registerSpeechDictationHandlers(socket);

    socket.on("join-modality-room", (modality) => {
      socket.join(`modality-${modality}`);
      logger.info(`Socket ${socket.id} joined room modality-${modality}`);
    });

    socket.on("disconnect", () => {
      logger.info(`WebSocket Client Disconnected: ${socket.id}`);
    });
  });

  logger.info("Socket.io WebSocket server initialized.");
  return io;
}

function broadcastStudyNotification(studyData) {
  if (!io) return;
  io.emit("new-study-arrival", studyData);
  if (studyData.modality) {
    io.to(`modality-${studyData.modality}`).emit("modality-study-update", studyData);
  }
}

function broadcastReportStatusChange(reportData) {
  if (!io) return;
  io.emit("report-status-changed", reportData);
}

module.exports = { initWebSockets, broadcastStudyNotification, broadcastReportStatusChange };
