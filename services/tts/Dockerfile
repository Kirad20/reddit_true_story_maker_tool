# TrueStoryMaker voice service: Kokoro TTS + faster-whisper word timings.
FROM python:3.12-slim-bookworm

# Same uv version that wrote uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    TTS_MODELS_DIR=/models/kokoro \
    HF_HOME=/models/hf \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project

COPY *.py ./

# Bake the models into the image so the service starts offline and fast.
RUN python download_models.py \
  && python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# Same uid as the app container's "node" user, so both can write to the shared jobs volume.
RUN useradd --uid 1000 --create-home tts \
  && mkdir -p /app/jobs && chown -R tts:tts /app/jobs \
  && chmod -R a+rX /models

USER tts
EXPOSE 8766

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8766/health', timeout=4)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8766"]
