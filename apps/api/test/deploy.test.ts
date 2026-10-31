import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLoopback } from "../src/security";
import { checkEnvironment, checkWritable } from "../src/validate";

const errors = (env: NodeJS.ProcessEnv) => checkEnvironment(env).filter((p) => p.level === "error").map((p) => p.message);

describe("checkEnvironment", () => {
  it("rejects weak auth secrets and setup passwords in production", () => {
    const base = { NODE_ENV: "production", PUBLIC_URL: "https://x.example.com" };
    expect(errors(base)).toEqual([]);
    expect(errors({ ...base, BETTER_AUTH_SECRET: "short" })[0]).toMatch(/BETTER_AUTH_SECRET/);
    expect(errors({ ...base, SETUP_PASSWORD: "short" })[0]).toMatch(/SETUP_PASSWORD/);
    expect(errors({ ...base, BETTER_AUTH_SECRET: "x".repeat(32), SETUP_PASSWORD: "a-long-enough-pass" })).toEqual([]);
  });

  it("allows development without any secret", () => {
    expect(errors({})).toEqual([]);
  });

  it("rejects plain-http public URLs in production except localhost", () => {
    const base = { NODE_ENV: "production" };
    expect(errors({ ...base, PUBLIC_URL: "http://stories.example.com" })[0]).toMatch(/https/);
    expect(errors({ ...base, PUBLIC_URL: "http://localhost:8787" })).toEqual([]);
    expect(errors({ ...base, PUBLIC_URL: "not a url" })[0]).toMatch(/not a valid URL/);
  });

  it("warns when production has no public URL", () => {
    const checks = checkEnvironment({ NODE_ENV: "production" });
    expect(checks).toEqual([expect.objectContaining({ level: "warn", message: expect.stringMatching(/PUBLIC_URL/) })]);
  });

  it("validates ports and service URLs", () => {
    expect(errors({ API_PORT: "99999" })[0]).toMatch(/API_PORT/);
    expect(errors({ TTS_URL: "::" })[0]).toMatch(/TTS_URL/);
  });
});

describe("checkWritable", () => {
  it("creates missing folders and reports unwritable ones", async () => {
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tsm-w-")), "nested", "data");
    expect(await checkWritable([dir])).toEqual([]);
    const file = path.join(dir, "a-file");
    await fs.writeFile(file, "x");
    const problems = await checkWritable([path.join(file, "child")]);
    expect(problems[0].level).toBe("error");
  });
});

describe("loopback detection", () => {
  it("recognises in-container requests only", () => {
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("172.18.0.5")).toBe(false);
  });
});

describe("providers input", () => {
  it("treats an empty id as a new provider (the UI sends one before saving)", async () => {
    const { providersInput } = await import("../src/schema");
    const parsed = providersInput.parse({ providers: [{ id: "", name: "Anthropic", kind: "anthropic", baseUrl: null, apiKey: "sk-test" }] });
    expect(parsed.providers[0].id).toBeUndefined();
    expect(providersInput.parse({ providers: [{ id: "p_1", name: "x", kind: "openai", baseUrl: "https://a.b/v1/" }] }).providers[0]).toMatchObject({ id: "p_1", baseUrl: "https://a.b/v1" });
  });
});
