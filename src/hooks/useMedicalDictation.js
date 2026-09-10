import { useState, useEffect, useRef, useCallback } from "react";
import io from "socket.io-client";
import { normalizeMedicalText } from "../utils/textNormalizer";
import { parseVoiceCommand } from "../components/dictation/VoiceCommandInterpreter";

export function useMedicalDictation({ onTranscript, onCommand, defaultTargetField = "findings" } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const [microphones, setMicrophones] = useState([]);
  const [selectedMic, setSelectedMic] = useState("");
  const [hotkey, setHotkey] = useState("F2");
  const [connectionStatus, setConnectionStatus] = useState("disconnected"); // "disconnected" | "connecting" | "ready" | "fallback"
  const [latencyMs, setLatencyMs] = useState(0);

  const socketRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const activeFieldRef = useRef(defaultTargetField);
  const pingTimestampRef = useRef(0);

  activeFieldRef.current = defaultTargetField;

  // 1. Enumerate available audio input devices
  const getMicrophones = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(d => d.kind === "audioinput");
      setMicrophones(audioInputs);
      if (audioInputs.length > 0 && !selectedMic) {
        setSelectedMic(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.warn("Failed to enumerate microphones:", err);
    }
  }, [selectedMic]);

  useEffect(() => {
    getMicrophones();
  }, [getMicrophones]);

  // 2. Initialize WebSocket / Socket.io streaming connection to backend
  useEffect(() => {
    let socket = null;
    try {
      const backendUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;
      socket = io(backendUrl, {
        path: "/ws/medical-dictation",
        transports: ["websocket", "polling"],
        reconnectionAttempts: 3,
        timeout: 4000
      });

      socket.on("connect", () => {
        setConnectionStatus("ready");
        pingTimestampRef.current = Date.now();
        socket.emit("dictation_ping");
      });

      socket.on("dictation_pong", () => {
        const diff = Date.now() - pingTimestampRef.current;
        setLatencyMs(diff);
      });

      socket.on("transcript_interim", (data) => {
        if (data?.text) {
          setInterimTranscript(data.text);
        }
      });

      socket.on("transcript_final", (data) => {
        if (data?.text) {
          const raw = data.text;
          const normalized = normalizeMedicalText(raw);
          const commandRes = parseVoiceCommand(normalized);

          if (commandRes.isCommand) {
            if (onCommand) onCommand(commandRes);
          } else {
            setFinalTranscript(normalized);
            if (onTranscript) onTranscript(normalized, activeFieldRef.current);
          }
          setInterimTranscript("");
        }
      });

      socket.on("connect_error", () => {
        setConnectionStatus("fallback");
      });

      socketRef.current = socket;
    } catch (e) {
      setConnectionStatus("fallback");
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [onTranscript, onCommand]);

  // 3. AudioWorklet / ScriptProcessor 16kHz Downsampler & Volume Metering
  const startAudioCapture = async () => {
    try {
      const constraints = {
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      source.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate RMS volume for visual VU meter
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const volume = Math.min(100, Math.round(rms * 400));
        setAudioLevel(volume);

        // Stream PCM buffer to backend WebSocket if connected
        if (socketRef.current?.connected) {
          // Convert Float32Array to Int16Array (16-bit PCM)
          const pcmBuffer = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmBuffer[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          socketRef.current.emit("audio_chunk", pcmBuffer.buffer);
        }
      };
    } catch (err) {
      console.error("Audio capture failed:", err);
    }
  };

  const stopAudioCapture = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    setAudioLevel(0);
  };

  // 4. Native Browser Web Speech Fallback Engine
  const startBrowserSpeechFallback = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);

      if (final.trim()) {
        const normalized = normalizeMedicalText(final.trim());
        const commandRes = parseVoiceCommand(normalized);

        if (commandRes.isCommand) {
          if (onCommand) onCommand(commandRes);
        } else {
          setFinalTranscript(normalized);
          if (onTranscript) onTranscript(normalized, activeFieldRef.current);
        }
        setInterimTranscript("");
      }
    };

    recognition.onerror = (e) => {
      console.warn("Speech recognition error:", e);
    };

    recognition.onend = () => {
      if (isListening) {
        try { recognition.start(); } catch (e) { /* ignore */ }
      }
    };

    speechRecognitionRef.current = recognition;
    try { recognition.start(); } catch (e) { /* ignore */ }
  };

  const stopBrowserSpeechFallback = () => {
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (e) { /* ignore */ }
      speechRecognitionRef.current = null;
    }
  };

  // 5. Toggle Dictation State
  const toggleDictation = useCallback((targetField = "findings") => {
    activeFieldRef.current = targetField;

    setIsListening(prev => {
      const next = !prev;
      if (next) {
        startAudioCapture();
        startBrowserSpeechFallback();
      } else {
        stopAudioCapture();
        stopBrowserSpeechFallback();
        setInterimTranscript("");
      }
      return next;
    });
  }, []);

  // 6. Global Hotkey / Foot Pedal Key Listener (F2, ScrollLock, Pause)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore key events when typing inside normal inputs/textareas unless F2/ScrollLock
      if (e.key === hotkey || e.code === hotkey || e.key === "F2" || e.code === "F2") {
        e.preventDefault();
        toggleDictation(activeFieldRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkey, toggleDictation]);

  return {
    isListening,
    interimTranscript,
    finalTranscript,
    audioLevel,
    microphones,
    selectedMic,
    setSelectedMic,
    hotkey,
    setHotkey,
    connectionStatus,
    latencyMs,
    toggleDictation
  };
}
