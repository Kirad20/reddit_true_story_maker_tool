"""Download the Kokoro ONNX model files (~340 MB) into ./models."""

from __future__ import annotations

import os
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
MODELS_DIR = Path(os.environ.get("TTS_MODELS_DIR", Path(__file__).parent / "models"))


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = MODELS_DIR / name
        if target.exists() and target.stat().st_size > 0:
            print(f"ok  {name}")
            continue
        partial = target.with_suffix(target.suffix + ".part")
        print(f"get {name} ...", flush=True)
        urllib.request.urlretrieve(f"{BASE}/{name}", partial)
        partial.replace(target)
        print(f"ok  {name} ({target.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
