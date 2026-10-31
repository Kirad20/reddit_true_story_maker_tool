import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePublicUrl } from "./validate";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, "../../..");
export const JOBS_DIR = path.join(ROOT_DIR, "jobs");
/** Settings, secrets and pipeline state. Tests point TSM_DATA_DIR at a temp folder. */
export const DATA_DIR = process.env.TSM_DATA_DIR ?? path.join(ROOT_DIR, "data");
export const ASSETS_DIR = path.join(ROOT_DIR, "assets");
export const BACKGROUNDS_DIR = path.join(ASSETS_DIR, "backgrounds");
export const MUSIC_DIR = path.join(ASSETS_DIR, "music");
/**
 * Backgrounds and music can live in an S3-compatible bucket (SeaweedFS, MinIO, AWS…) instead of assets/.
 * Enabled when S3_BUCKET is set; keys are stored under S3_PREFIX + "backgrounds/<category>/<file>" and
 * S3_PREFIX + "music/<file>", the same layout as the local folder.
 */
export const S3_ASSETS = process.env.S3_BUCKET
  ? {
      bucket: process.env.S3_BUCKET,
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || "us-east-1",
      accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
      prefix: normalizePrefix(process.env.S3_PREFIX ?? ""),
      // SeaweedFS and MinIO need path-style URLs (http://host:8333/bucket/key).
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    }
  : null;
export type S3AssetsConfig = NonNullable<typeof S3_ASSETS>;

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}
export const VIDEO_ENTRY = path.join(ROOT_DIR, "packages/video/src/index.ts");

export const IS_PRODUCTION = process.env.NODE_ENV === "production";
export const API_PORT = Number(process.env.API_PORT ?? 8787);
/** Origin the renderer uses to download job media from this server (always local). */
export const API_ORIGIN = process.env.API_ORIGIN ?? `http://localhost:${API_PORT}`;
/** Public URL of the deployment: PUBLIC_URL, or the domain Coolify assigned to the "app" service. */
export const PUBLIC_URL = resolvePublicUrl(process.env);
/** Base for OAuth redirect URIs: the public URL in production, the API itself in development. */
export const OAUTH_BASE = PUBLIC_URL ?? API_ORIGIN;
/** Where the browser UI lives (OAuth callbacks send the user back here). */
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? PUBLIC_URL ?? "http://localhost:5173";
export const TTS_URL = process.env.TTS_URL ?? "http://127.0.0.1:8766";
/** Built web app served by the API in production (apps/web/dist). */
export const WEB_DIST = process.env.WEB_DIST ?? path.join(ROOT_DIR, "apps/web/dist");
// Login and users are handled by Better Auth (see auth.ts); accounts live in data/auth.db.

// Model providers, per-agent models and service credentials live in Settings (see aiconfig.ts).

export const DEFAULT_VOICES: Record<"en" | "es", string> = { en: "af_heart", es: "ef_dora" };
