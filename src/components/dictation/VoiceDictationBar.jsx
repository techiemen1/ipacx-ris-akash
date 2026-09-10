import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Settings, Zap, Activity, HelpCircle, X } from "lucide-react";
import "./VoiceDictationBar.css";

export default function VoiceDictationBar({
  isListening,
  interimTranscript,
  audioLevel = 0,
  microphones = [],
  selectedMic = "",
  setSelectedMic,
  hotkey = "F2",
  setHotkey,
  connectionStatus = "ready",
  latencyMs = 120,
  onToggleDictation,
  activeTargetField = "findings"
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const canvasRef = useRef(null);

  // Render animated real-time waveform on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animationId;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width;
      const height = canvas.height;

      if (!isListening) {
        ctx.fillStyle = "#475569";
        ctx.fillRect(0, height / 2 - 1, width, 2);
        return;
      }

      ctx.fillStyle = "#10b981";
      const bars = 16;
      const barWidth = 3;
      const gap = (width - bars * barWidth) / (bars - 1);

      for (let i = 0; i < bars; i++) {
        const randFactor = Math.sin(Date.now() * 0.01 + i) * 0.4 + 0.6;
        const h = Math.max(4, Math.min(height - 2, (audioLevel / 100) * height * randFactor));
        const x = i * (barWidth + gap);
        const y = (height - h) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, h, 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isListening, audioLevel]);

  return (
    <div className={`vdb-container ${isListening ? "vdb-active" : ""}`}>
      {/* Mic Status & Main Action Button */}
      <div className="vdb-main-group">
        <button
          type="button"
          onClick={() => onToggleDictation(activeTargetField)}
          className={`vdb-mic-btn ${isListening ? "vdb-mic-listening" : ""}`}
          title={isListening ? "Stop Dictation" : "Start Medical Dictation"}
        >
          {isListening ? <Mic className="vdb-icon-pulse" size={16} /> : <MicOff size={16} />}
          <span className="vdb-btn-text">
            {isListening ? "🎙️ Dictating..." : "🎙️ Medical Dictation"}
          </span>
        </button>

        {/* Real-Time Waveform Visualizer */}
        <div className="vdb-waveform-wrapper">
          <canvas ref={canvasRef} width={80} height={24} className="vdb-canvas" />
        </div>

        {/* Interim Speech Preview Pill */}
        {isListening && interimTranscript && (
          <div className="vdb-interim-preview">
            <Activity size={12} className="vdb-pulse-icon" />
            <span className="vdb-interim-text">"{interimTranscript}"</span>
          </div>
        )}
      </div>

      {/* Badges & Config Action Group */}
      <div className="vdb-status-group">
        {/* Latency / Connection Status Badge */}
        <span className={`vdb-status-badge vdb-status-${connectionStatus}`}>
          <Zap size={11} />
          {connectionStatus === "ready"
            ? `${latencyMs > 0 ? latencyMs : "<30"}ms WebSocket`
            : connectionStatus === "fallback"
            ? "Web Speech Fallback"
            : "Connecting..."}
        </span>

        {/* Target Field Indicator */}
        <span className="vdb-target-pill">
          Target: <strong>{activeTargetField === "findings" ? "Findings" : "Impression"}</strong>
        </span>

        {/* Hotkey Indicator */}
        <span className="vdb-hotkey-badge" title="Foot Pedal / Keyboard Hotkey">
          {hotkey} / FootPedal
        </span>

        {/* Action Buttons */}
        <button
          type="button"
          onClick={() => setShowConfig(!showConfig)}
          className="vdb-icon-btn"
          title="Microphone & Foot Pedal Settings"
        >
          <Settings size={14} />
        </button>

        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="vdb-icon-btn"
          title="Voice Commands & Dictation Cheat Sheet"
        >
          <HelpCircle size={14} />
        </button>
      </div>

      {/* Settings Modal Popover */}
      {showConfig && (
        <div className="vdb-popover">
          <div className="vdb-popover-header">
            <span>🎙️ Audio & Foot Pedal Configuration</span>
            <button type="button" onClick={() => setShowConfig(false)} className="vdb-close-btn"><X size={13} /></button>
          </div>
          <div className="vdb-popover-body">
            <label className="vdb-label">Microphone Input Device:</label>
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
              className="vdb-select"
            >
              {microphones.length === 0 ? (
                <option value="">Default System Microphone</option>
              ) : (
                microphones.map((m) => (
                  <option key={m.deviceId} value={m.deviceId}>
                    {m.label || `Microphone ${m.deviceId.slice(0, 5)}...`}
                  </option>
                ))
              )}
            </select>

            <label className="vdb-label" style={{ marginTop: 10 }}>Foot Pedal / Hotkey Shortcut:</label>
            <select
              value={hotkey}
              onChange={(e) => setHotkey(e.target.value)}
              className="vdb-select"
            >
              <option value="F2">F2 (Recommended for USB Foot Pedals)</option>
              <option value="ScrollLock">ScrollLock</option>
              <option value="Pause">Pause / Break</option>
              <option value="Alt">Alt Key</option>
            </select>
          </div>
        </div>
      )}

      {/* Help & Cheat Sheet Modal Popover */}
      {showHelp && (
        <div className="vdb-popover vdb-popover-wide">
          <div className="vdb-popover-header">
            <span>🗣️ Medical Dictation Voice Commands Cheat Sheet</span>
            <button type="button" onClick={() => setShowHelp(false)} className="vdb-close-btn"><X size={13} /></button>
          </div>
          <div className="vdb-popover-body vdb-cheat-grid">
            <div>
              <strong>Formatting:</strong>
              <ul>
                <li>"period" $\rightarrow$ <code>.</code></li>
                <li>"comma" $\rightarrow$ <code>,</code></li>
                <li>"colon" $\rightarrow$ <code>:</code></li>
                <li>"new line" $\rightarrow$ Line Break</li>
                <li>"new paragraph" $\rightarrow$ Paragraph Break</li>
              </ul>
            </div>
            <div>
              <strong>Anatomy & Measurements:</strong>
              <ul>
                <li>"l four l five" $\rightarrow$ <code>L4-L5</code></li>
                <li>"ten millimeters" $\rightarrow$ <code>10 mm</code></li>
                <li>"one hundred HU" $\rightarrow$ <code>100 HU</code></li>
                <li>"birads four" $\rightarrow$ <code>BI-RADS 4</code></li>
              </ul>
            </div>
            <div>
              <strong>Voice Macros & Edits:</strong>
              <ul>
                <li>"insert normal chest template"</li>
                <li>"go to impression"</li>
                <li>"go to findings"</li>
                <li>"scratch that" (Undo)</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
