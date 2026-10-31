import fs from "node:fs/promises";
import path from "node:path";

export type EnvCheck = { level: "error" | "warn"; message: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Configuration problems that would make a deployment unsafe or broken. */
export function checkEnvironment(env: NodeJS.ProcessEnv): EnvCheck[] {
  const problems: EnvCheck[] = [];
  const production = env.NODE_ENV === "production";
  const password = env.APP_PASSWORD ?? "";

  if (production && !password) {
    problems.push({ level: "error", message: "APP_PASSWORD is required in production: the app holds your API keys and can publish to your accounts" });
  } else if (password && password.length < 12) {
    problems.push({ level: production ? "error" : "warn", message: "APP_PASSWORD must be at least 12 characters" });
  }

  const port = Number(env.API_PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push({ level: "error", message: `API_PORT is not a valid port: ${env.API_PORT}` });

  if (env.PUBLIC_URL) {
    let url: URL | null = null;
    try {
      url = new URL(env.PUBLIC_URL);
    } catch {
      problems.push({ level: "error", message: `PUBLIC_URL is not a valid URL: ${env.PUBLIC_URL}` });
    }
    if (url && url.protocol !== "https:" && !LOCAL_HOSTS.has(url.hostname)) {
      problems.push({ level: production ? "error" : "warn", message: "PUBLIC_URL must use https (OAuth providers reject plain http)" });
    }
  } else if (production) {
    problems.push({ level: "warn", message: "PUBLIC_URL is not set: OAuth redirects will point to localhost and publishing accounts cannot be connected" });
  }

  if (env.TTS_URL) {
    try {
      new URL(env.TTS_URL);
    } catch {
      problems.push({ level: "error", message: `TTS_URL is not a valid URL: ${env.TTS_URL}` });
    }
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
