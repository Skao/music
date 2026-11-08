"""Pianoscribe transcription service.

The phone records audio near the speaker and uploads it here. This service
runs a piano transcription model and returns the raw note events plus a tempo
estimate. It does NOT build sheet music: quantizing, hand splitting, key
detection and MusicXML all happen on the phone, so this stays a thin wrapper
around the model.

Run:  uvicorn pianoscribe_server:app --host 0.0.0.0 --port 8765
Env:  PIANOSCRIBE_TOKEN       shared secret; the app sends it as a Bearer token
      PIANOSCRIBE_MODEL       bytedance (default) | basicpitch
      PIANOSCRIBE_CHECKPOINT  path to the ByteDance checkpoint (downloaded on
                              first use when unset)
"""
from __future__ import annotations

import base64
import os
import subprocess
import tempfile
import threading
import time

import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

TOKEN = os.environ.get("PIANOSCRIBE_TOKEN", "")
MODEL = os.environ.get("PIANOSCRIBE_MODEL", "bytedance").lower()
MAX_SECONDS = float(os.environ.get("PIANOSCRIBE_MAX_SECONDS", "600"))

app = FastAPI(title="Pianoscribe", version="0.1.0")


# ---------------------------------------------------------------- audio prep

def to_wav(src: str, dst: str) -> None:
    """Decode whatever the phone sent (m4a, 3gp, wav...) to mono 44.1 kHz WAV."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "44100", dst],
        check=True,
    )


def wav_duration(path: str) -> float:
    import soundfile as sf  # dependency of librosa
    info = sf.info(path)
    return float(info.frames) / float(info.samplerate)


def estimate_tempo(path: str) -> float | None:
    """Beat-tracked BPM; the phone lets the user override it."""
    try:
        import librosa
        y, sr = librosa.load(path, sr=22050, mono=True)
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo)[0])
        if not (30 <= tempo <= 300):
            return None
        return round(tempo, 1)
    except Exception:
        return None


# -------------------------------------------------------------------- models

_bytedance = None
_unload_timer = None
IDLE_UNLOAD = float(os.environ.get("PIANOSCRIBE_IDLE_UNLOAD", "300"))


def _schedule_unload():
    """Drop the loaded model after IDLE_UNLOAD seconds without a request, so a small box
    shared with other services gets its memory back; the next request reloads it (~10 s)."""
    global _unload_timer
    if IDLE_UNLOAD <= 0:
        return
    if _unload_timer:
        _unload_timer.cancel()

    def unload():
        global _bytedance
        _bytedance = None
        import gc
        gc.collect()

    _unload_timer = threading.Timer(IDLE_UNLOAD, unload)
    _unload_timer.daemon = True
    _unload_timer.start()


def bytedance_notes(wav: str, midi_out: str):
    """ByteDance 'High-resolution piano transcription' (Kong et al. 2020)."""
    global _bytedance
    import librosa
    from piano_transcription_inference import PianoTranscription, sample_rate

    if _bytedance is None:
        _bytedance = PianoTranscription(
            device="cpu", checkpoint_path=os.environ.get("PIANOSCRIBE_CHECKPOINT")
        )
    # The package's own load_audio reaches into a librosa internal that no longer exists;
    # the input is already a clean WAV from ffmpeg, so librosa.load is all it needs.
    audio, _ = librosa.load(wav, sr=sample_rate, mono=True)
    out = _bytedance.transcribe(audio, midi_out)
    _schedule_unload()
    notes = [
        {
            "pitch": int(e["midi_note"]),
            "onset": round(float(e["onset_time"]), 4),
            "offset": round(float(e["offset_time"]), 4),
            "velocity": int(e["velocity"]),
        }
        for e in out["est_note_events"]
    ]
    pedal = [
        {"onset": round(float(e["onset_time"]), 4), "offset": round(float(e["offset_time"]), 4)}
        for e in out.get("est_pedal_events", [])
    ]
    return notes, pedal


def basicpitch_notes(wav: str, midi_out: str):
    """Spotify Basic Pitch: lighter, general-instrument, a notch less accurate on piano."""
    from basic_pitch.inference import predict

    _, midi_data, note_events = predict(wav)
    midi_data.write(midi_out)
    notes = [
        {
            "pitch": int(p),
            "onset": round(float(s), 4),
            "offset": round(float(e), 4),
            "velocity": int(round(float(a) * 127)),
        }
        for s, e, p, a, _bends in note_events
    ]
    return notes, []


MODELS = {"bytedance": bytedance_notes, "basicpitch": basicpitch_notes}


def run_model(src_path: str) -> dict:
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "in.wav")
        midi = os.path.join(d, "out.mid")
        to_wav(src_path, wav)
        duration = wav_duration(wav)
        if duration > MAX_SECONDS:
            raise HTTPException(413, f"recording is {duration:.0f}s; limit is {MAX_SECONDS:.0f}s")
        t0 = time.time()
        notes, pedal = MODELS[MODEL](wav, midi)
        notes.sort(key=lambda n: (n["onset"], n["pitch"]))
        midi_b64 = ""
        if os.path.exists(midi):
            with open(midi, "rb") as f:
                midi_b64 = base64.b64encode(f.read()).decode("ascii")
        return {
            "model": MODEL,
            "duration": round(duration, 3),
            "bpm": estimate_tempo(wav),
            "notes": notes,
            "pedal": pedal,
            "midi_base64": midi_b64,
            "seconds": round(time.time() - t0, 2),
        }


# ------------------------------------------------------------------- routes

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), authorization: str | None = Header(None)):
    if TOKEN and authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")
    if MODEL not in MODELS:
        raise HTTPException(500, f"unknown PIANOSCRIBE_MODEL {MODEL}")
    ext = os.path.splitext(file.filename or "")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        src = tmp.name
    try:
        return await run_in_threadpool(run_model, src)
    except subprocess.CalledProcessError:
        raise HTTPException(400, "ffmpeg could not decode the upload")
    finally:
        os.unlink(src)
