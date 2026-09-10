import React from "react";
import { useMedicalDictation } from "../../hooks/useMedicalDictation";
import VoiceDictationBar from "./VoiceDictationBar";

export default function VoiceDictationManager({
  onTranscript,
  onCommand,
  activeTargetField = "findings"
}) {
  const dictation = useMedicalDictation({
    onTranscript,
    onCommand,
    defaultTargetField: activeTargetField
  });

  return (
    <VoiceDictationBar
      isListening={dictation.isListening}
      interimTranscript={dictation.interimTranscript}
      audioLevel={dictation.audioLevel}
      microphones={dictation.microphones}
      selectedMic={dictation.selectedMic}
      setSelectedMic={dictation.setSelectedMic}
      hotkey={dictation.hotkey}
      setHotkey={dictation.setHotkey}
      connectionStatus={dictation.connectionStatus}
      latencyMs={dictation.latencyMs}
      onToggleDictation={dictation.toggleDictation}
      activeTargetField={activeTargetField}
    />
  );
}
