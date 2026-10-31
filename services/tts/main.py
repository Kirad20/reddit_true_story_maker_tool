"""HTTP API of the local TTS service. Run: uv run uvicorn main:app --port 8766"""

from __future__ import annotations

import io
import os
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from engine import Engine

app = FastAPI(title="TrueStoryMaker TTS")
engine = Engine()
OUTPUT_ROOT = Path(os.environ["TTS_OUTPUT_ROOT"]).resolve() if os.environ.get("TTS_OUTPUT_ROOT") else None


class SynthesizeRequest(BaseModel):
    texts: list[str] = Field(min_length=1)
    voice: str = "af_heart"
    lang: str = "en"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    out_path: str
    pause_sec: float = Field(default=0.35, ge=0, le=2)
    align_words: bool = True


class PreviewRequest(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    voice: str = "af_heart"
    lang: str = "en"
    speed: float = 1.0


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/voices")
def voices() -> dict:
    try:
        return {"voices": engine.voices()}
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


def safe_output(out_path: str) -> Path:
    """Only write inside TTS_OUTPUT_ROOT (the shared jobs volume) when it is configured."""
    path = Path(out_path).resolve()
    if OUTPUT_ROOT and not path.is_relative_to(OUTPUT_ROOT):
        raise HTTPException(400, f"out_path must be inside {OUTPUT_ROOT}")
    if path.suffix.lower() != ".wav":
        raise HTTPException(400, "out_path must be a .wav file")
    return path


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest) -> dict:
    texts = [t.strip() for t in req.texts if t.strip()]
    if not texts:
        raise HTTPException(400, "No text to synthesize")
    out_path = safe_output(req.out_path)
    try:
        result = engine.synthesize(
            texts, req.voice, req.lang, req.speed, out_path, req.pause_sec, req.align_words
        )
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, f"Synthesis failed: {exc}") from exc
    return {
        "duration": result.duration,
        "timing_source": result.timing_source,
        "blocks": [b.__dict__ for b in result.blocks],
        "words": [w.__dict__ for w in result.words],
    }


@app.post("/preview")
def preview(req: PreviewRequest) -> Response:
    try:
        samples, rate = engine.preview(req.text, req.voice, req.lang, req.speed)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV")
    return Response(buf.getvalue(), media_type="audio/wav")
