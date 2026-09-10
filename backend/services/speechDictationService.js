const logger = require("../utils/logger");

function registerSpeechDictationHandlers(socket) {
  let audioBuffer = [];

  socket.on("dictation_ping", () => {
    socket.emit("dictation_pong");
  });

  socket.on("audio_chunk", (chunk) => {
    try {
      if (!chunk) return;
      audioBuffer.push(chunk);

      // Send periodic interim ping response to confirm active streaming
      if (audioBuffer.length % 5 === 0) {
        socket.emit("transcript_interim", {
          text: "...listening to medical audio stream..."
        });
      }
    } catch (err) {
      logger.error(`Error processing audio chunk for socket ${socket.id}:`, err);
    }
  });

  socket.on("end_dictation", () => {
    audioBuffer = [];
  });
}

module.exports = { registerSpeechDictationHandlers };
