# TrueStoryMaker app: API + built web UI + Remotion renderer (Chrome Headless Shell).
FROM node:24-bookworm-slim

# Chrome Headless Shell runtime libraries (Remotion), fonts for captions/emoji, curl for healthchecks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 \
    libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 \
    fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first for layer caching.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/video/package.json packages/video/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

# Fail the build on type errors, then build the web UI and fetch the headless browser for rendering.
# Remotion keeps the browser in <nearest package.json>/node_modules/.remotion of the process cwd; the API
# runs from apps/api (npm start -w), so download it there or rendering tries again at runtime (read-only).
RUN npm run typecheck \
  && npm run build -w @tsm/web \
  && cd apps/api && npx remotion browser ensure

RUN mkdir -p /app/data /app/jobs /app/assets/backgrounds /app/assets/music \
  && chown -R node:node /app/data /app/jobs /app/assets

ENV NODE_ENV=production \
    API_PORT=8787 \
    TTS_URL=http://tts:8766

USER node
EXPOSE 8787
VOLUME ["/app/data", "/app/jobs", "/app/assets"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8787/api/health || exit 1

CMD ["npm", "run", "start", "-w", "@tsm/api"]
