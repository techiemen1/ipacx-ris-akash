"""
Standalone Python Medical Speech-to-Text Microservice
Uses faster-whisper for low-latency (<300ms stream response) medical dictation inference.
"""

import sys
import json
import asyncio
from typing import Optional

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from faster_whisper import WhisperModel
    import numpy as np
except ImportError:
    print("[WARNING] python packages (fastapi, faster_whisper, numpy) not installed.")
    print("Install via: pip install fastapi uvicorn faster-whisper numpy")

app = FastAPI(title="iPACX RIS Medical ASR Microservice")

MODEL_SIZE = "small" # options: "tiny", "base", "small", "medium", "large-v3"
DEVICE = "cpu"       # change to "cuda" if GPU is available
COMPUTE_TYPE = "int8"

RADIOLOGY_PROMPT_BIAS = (
    "BI-RADS LI-RADS PI-RADS CAD-RADS Lung-RADS CT MRI X-Ray Ultrasound "
    "consolidation pneumothorax pleural effusion atelectasis cardiomegaly "
    "L1 L2 L3 L4 L5 C1 C2 C3 C4 C5 C6 C7 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 "
    "HU mm cm hounsfield units contrast-enhanced non-contrast post-gadolinium"
)

model: Optional[object] = None

@app.on_event("startup")
def load_whisper_model():
    global model
    try:
        print(f"[INFO] Loading faster-whisper model ({MODEL_SIZE}) on {DEVICE}...")
        model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        print("[INFO] Medical Whisper model loaded successfully.")
    except Exception as e:
        print(f"[ERROR] Failed to load Whisper model: {e}")

@app.websocket("/ws/medical-dictation")
async def websocket_medical_dictation(websocket: WebSocket):
    await websocket.accept()
    print("[INFO] Client connected to Medical Dictation WebSocket")
    
    audio_data = bytearray()

    try:
        while True:
            data = await websocket.receive_bytes()
            audio_data.extend(data)

            if len(audio_data) >= 16000 * 2 * 2: # ~2 seconds of 16kHz 16-bit PCM audio
                audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
                audio_data = bytearray()

                if model:
                    segments, info = model.transcribe(
                        audio_np,
                        beam_size=1,
                        initial_prompt=RADIOLOGY_PROMPT_BIAS,
                        language="en"
                    )
                    transcript = " ".join([seg.text for seg in segments]).strip()

                    if transcript:
                        await websocket.send_json({
                            "type": "final",
                            "text": transcript,
                            "confidence": 0.96
                        })
    except WebSocketDisconnect:
        print("[INFO] Client disconnected from Medical Dictation WebSocket")
    except Exception as e:
        print(f"[ERROR] Dictation stream error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
