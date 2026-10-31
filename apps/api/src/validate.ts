import fs from "node:fs/promises";
import path from "node:path";

export type EnvCheck = { level: "error" | "warn"; message: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * PUBLIC_URL, or the domain Coolify assigned to the "app" service (SERVICE_URL_* / SERVICE_FQDN_*).
 * Read directly instead of only through compose interpolation, which Coolify does not always resolve.
 */
export function resolvePublicUrl(env: NodeJS.ProcessEnv): string | null {
  const candidates: [string | undefined, boolean][] = [
    [env.PUBLIC_URL, false],
    [env.BETTER_AUTH_URL, false],
    [env.SERVICE_URL_APP_8787, true],
    [env.SERVICE_URL_APP, true],
    [env.SERVICE_FQDN_APP_8787, true],
    [env.SERVICE_FQDN_APP, true],
  ];
  const containerPort = String(env.API_PORT || 8787);
  for (const [raw, fromCoolify] of candidates) {
    // Coolify may hold several comma-separated domains; the first one is the primary.
    const value = raw?.split(",")[0]?.trim();
    // Skip compose placeholders that were left unresolved, like "${SERVICE_URL_APP_8787}".
    if (!value || value.includes("$")) continue;
    let url = (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/+$/, "");
    // A Coolify domain like "https://app.example.com:8787" means "route to container port 8787": the proxy
    // serves it on 443, so the port must not end up in public links or OAuth redirect URIs.
    if (fromCoolify) {
      try {
        const parsed = new URL(url);
        if (parsed.port === containerPort) {
          parsed.port = "";
          url = parsed.toString().replace(/\/+$/, "");
        }
      } catch {
        // checkEnvironment reports invalid URLs.
      }
    }
    return url;
  }
  return null;
}

/** Configuration problems that would make a deployment unsafe or broken. */
export function checkEnvironment(env: NodeJS.ProcessEnv): EnvCheck[] {
  const problems: EnvCheck[] = [];
  const production = env.NODE_ENV === "production";

  if (env.BETTER_AUTH_SECRET && !env.BETTER_AUTH_SECRET.includes("$") && env.BETTER_AUTH_SECRET.length < 32) {
    problems.push({ level: production ? "error" : "warn", message: "BETTER_AUTH_SECRET must be at least 32 characters (or leave it empty to generate one in data/)" });
  }
  if (env.SETUP_PASSWORD && env.SETUP_PASSWORD.length < 12) {
    problems.push({ level: production ? "error" : "warn", message: "SETUP_PASSWORD must be at least 12 characters (or leave it empty to get a random one in the logs)" });
  }
  if (env.APP_PASSWORD) {
    problems.push({ level: "warn", message: "APP_PASSWORD is no longer used: log in with the temporary setup user printed in the logs and create your users in Usuarios" });
  }

  const port = Number(env.API_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push({ level: "error", message: `API_PORT is not a valid port: ${env.API_PORT}` });

  const publicUrl = resolvePublicUrl(env);
  if (publicUrl) {
    let url: URL | null = null;
    try {
      url = new URL(publicUrl);
    } catch {
      problems.push({ level: "error", message: `PUBLIC_URL is not a valid URL: ${publicUrl}` });
    }
    if (url && url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
      problems.push({ level: production ? "error" : "warn", message: "PUBLIC_URL must use https (OAuth providers reject plain http)" });
    }
  } else if (production) {
    problems.push({ level: "warn", message: "PUBLIC_URL is not set (and Coolify gave no SERVICE_URL_APP_8787): OAuth redirects will point to localhost and publishing accounts cannot be connected" });
  }

  if (env.TTS_URL) {
    try {
      new URL(env.TTS_URL);
    } catch {
      problems.push({ level: "error", message: `TTS_URL is not a valid URL: ${env.TTS_URL}` });
    }
  }
  problems.push(...checkS3(env));
  return problems;
}

/** S3-compatible asset storage (SeaweedFS, MinIO, AWS): enabled by S3_BUCKET. */
function checkS3(env: NodeJS.ProcessEnv): EnvCheck[] {
  const problems: EnvCheck[] = [];
  const s3Vars = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PREFIX", "S3_REGION"].filter((k) => env[k]);
  if (!env.S3_BUCKET) {
    if (s3Vars.length) problems.push({ level: "warn", message: `${s3Vars.join(", ")} set but S3_BUCKET is empty: assets are read from the local assets/ folder` });
    return problems;
  }
  if (env.S3_ENDPOINT) {
    try {
      const url = new URL(env.S3_ENDPOINT);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    } catch {
      problems.push({ level: "error", message: `S3_ENDPOINT is not a valid http(s) URL: ${env.S3_ENDPOINT}` });
    }
  }
  if (!!env.S3_ACCESS_KEY_ID !== !!env.S3_SECRET_ACCESS_KEY) {
    problems.push({ level: "error", message: "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (or neither for an S3 server without authentication)" });
  }
  if (env.S3_FORCE_PATH_STYLE && !["true", "false"].includes(env.S3_FORCE_PATH_STYLE)) {
    problems.push({ level: "error", message: `S3_FORCE_PATH_STYLE must be "true" or "false": ${env.S3_FORCE_PATH_STYLE}` });
  }
  return problems;
}

/** Each directory must exist (it is created) and be writable. */
export async function checkWritable(dirs: string[]): Promise<EnvCheck[]> {
  const problems: EnvCheck[] = [];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.write-test-${process.pid}`);
      await fs.writeFile(probe, "ok");
      await fs.rm(probe);
    } catch (error) {
      problems.push({ level: "error", message: `${dir} is not writable (${(error as Error).message}); check the volume permissions` });
    }
  }
  return problems;
}

/** Log every problem; exit when any is an error so a bad deployment fails fast and visibly. */
export function reportOrExit(problems: EnvCheck[]): void {
  for (const p of problems) console[p.level === "error" ? "error" : "warn"](`[config] ${p.level.toUpperCase()}: ${p.message}`);
  if (problems.some((p) => p.level === "error")) {
    console.error("[config] Refusing to start. Fix the errors above.");
    process.exit(1);
  }
}
