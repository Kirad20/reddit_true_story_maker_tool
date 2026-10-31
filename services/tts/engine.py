"""Kokoro synthesis plus word timing for a list of script blocks."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from align import Word, align, proportional, script_tokens

MODELS_DIR = Path(os.environ.get("TTS_MODELS_DIR", Path(__file__).parent / "models"))
KOKORO_MODEL = MODELS_DIR / "kokoro-v1.0.onnx"
KOKORO_VOICES = MODELS_DIR / "voices-v1.0.bin"
WHISPER_SIZE = os.environ.get("WHISPER_MODEL", "base")

# Kokoro language codes per UI language.
LANG_CODES = {"en": "en-us", "es": "es"}


@dataclass
class BlockTiming:
    start: float
    end: float


@dataclass
class Synthesis:
    duration: float
    blocks: list[BlockTiming]
    words: list[Word]
    timing_source: str


class Engine:
    def __init__(self) -> None:
        self._kokoro = None
        self._whisper = None
        self._whisper_failed = False

    @property
    def kokoro(self):
        if self._kokoro is None:
            from kokoro_onnx import Kokoro

            if not KOKORO_MODEL.exists() or not KOKORO_VOICES.exists():
                raise RuntimeError(
                    f"Kokoro model files missing in {MODELS_DIR}. Run: uv run python download_models.py"
                )
            self._kokoro = Kokoro(str(KOKORO_MODEL), str(KOKORO_VOICES))
        return self._kokoro

    @property
    def whisper(self):
        if self._whisper is None and not self._whisper_failed:
            try:
                from faster_whisper import WhisperModel

                self._whisper = WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8")
            except Exception as exc:  # model download or runtime failure
                print(f"[tts] whisper unavailable, using proportional timing: {exc}")
                self._whisper_failed = True
        return self._whisper

    def voices(self) -> list[str]:
        return sorted(self.kokoro.get_voices())

    def synthesize(
        self,
        texts: list[str],
        voice: str,
        lang: str,
        speed: float,
        out_path: Path,
        pause_sec: float = 0.35,
        align_words: bool = True,
    ) -> Synthesis:
        lang_code = LANG_CODES.get(lang, lang)
        chunks: list[np.ndarray] = []
        blocks: list[BlockTiming] = []
        words: list[Word] = []
        sample_rate = 24000
        cursor = 0.0
        used_whisper = False

        for index, text in enumerate(texts):
            samples, sample_rate = self.kokoro.create(text, voice=voice, speed=speed, lang=lang_code)
            samples = np.asarray(samples, dtype=np.float32)
            length = len(samples) / sample_rate
            tokens = script_tokens(text)

            recognized = self._recognize(samples, sample_rate, lang) if align_words else []
            used_whisper = used_whisper or bool(recognized)
            local = align(tokens, recognized, 0.0, length) if recognized else proportional(tokens, 0.0, length)
            words.extend(Word(w.text, round(w.start + cursor, 3), round(w.end + cursor, 3)) for w in local)
            blocks.append(BlockTiming(round(cursor, 3), round(cursor + length, 3)))

            chunks.append(samples)
            cursor += length
            if index < len(texts) - 1:
                chunks.append(np.zeros(int(pause_sec * sample_rate), dtype=np.float32))
                cursor += pause_sec

        audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(out_path), audio, sample_rate)
        return Synthesis(
            duration=round(len(audio) / sample_rate, 3),
            blocks=blocks,
            words=words,
            timing_source="whisper" if used_whisper else "proportional",
        )

    def preview(self, text: str, voice: str, lang: str, speed: float) -> tuple[np.ndarray, int]:
        samples, sample_rate = self.kokoro.create(text, voice=voice, speed=speed, lang=LANG_CODES.get(lang, lang))
        return np.asarray(samples, dtype=np.float32), sample_rate

    def _recognize(self, samples: np.ndarray, sample_rate: int, lang: str) -> list[Word]:
        model = self.whisper
        if model is None:
            return []
        try:
            # Whisper wants 16 kHz mono float32; passing an array skips its file decoder.
            audio = resample(samples, sample_rate, WHISPER_RATE)
            segments, _ = model.transcribe(audio, language=lang, word_timestamps=True, beam_size=1)
            return [
                Word(w.word.strip(), float(w.start), float(w.end))
                for segment in segments
                for w in (segment.words or [])
                if w.word.strip()
            ]
        except Exception as exc:
            print(f"[tts] recognition failed, using proportional timing: {exc}")
            return []


WHISPER_RATE = 16000


def resample(samples: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    if src_rate == dst_rate or len(samples) == 0:
        return samples.astype(np.float32)
    duration = len(samples) / src_rate
    dst_len = int(round(duration * dst_rate))
    src_t = np.linspace(0, duration, num=len(samples), endpoint=False)
    dst_t = np.linspace(0, duration, num=dst_len, endpoint=False)
    return np.interp(dst_t, src_t, samples).astype(np.float32)
