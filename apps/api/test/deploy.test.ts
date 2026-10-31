import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { describe, expect, it } from "vitest";
import { basicAuth, isLoopback, parseBasicAuth } from "../src/security";
import { checkEnvironment, checkWritable } from "../src/validate";

const errors = (env: NodeJS.ProcessEnv) => checkEnvironment(env).filter((p) => p.level === "error").map((p) => p.message);

describe("checkEnvironment", () => {
  it("requires a strong APP_PASSWORD in production", () => {
    expect(errors({ NODE_ENV: "production", PUBLIC_URL: "https://x.example.com" })[0]).toMatch(/APP_PASSWORD is required/);
    expect(errors({ NODE_ENV: "production", APP_PASSWORD: "short", PUBLIC_URL: "https://x.example.com" })[0]).toMatch(/at least 12/);
    expect(errors({ NODE_ENV: "production", APP_PASSWORD: "a-long-enough-pass", PUBLIC_URL: "https://x.example.com" })).toEqual([]);
  });

  it("allows development without a password", () => {
    expect(errors({})).toEqual([]);
  });

  it("rejects plain-http public URLs in production except localhost", () => {
    const base = { NODE_ENV: "production", APP_PASSWORD: "a-long-enough-pass" };
    expect(errors({ ...base, PUBLIC_URL: "http://stories.example.com" })[0]).toMatch(/https/);
    expect(errors({ ...base, PUBLIC_URL: "http://localhost:8787" })).toEqual([]);
    expect(errors({ ...base, PUBLIC_URL: "not a url" })[0]).toMatch(/not a valid URL/);
  });

  it("warns when production has no public URL", () => {
    const checks = checkEnvironment({ NODE_ENV: "production", APP_PASSWORD: "a-long-enough-pass" });
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

describe("basic auth", () => {
  it("parses credentials, including passwords with colons", () => {
    const header = `Basic ${Buffer.from("admin:pa:ss").toString("base64")}`;
    expect(parseBasicAuth(header)).toEqual({ user: "admin", password: "pa:ss" });
    expect(parseBasicAuth("Bearer x")).toBeNull();
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopback("172.18.0.5")).toBe(false);
  });

  it("protects routes, exempts health and the in-container renderer", async () => {
    const app = express();
    app.use(basicAuth("admin", "correct-horse-battery"));
    app.get("/api/health", (_req, res) => res.json({ ok: true }));
    app.get("/api/secret", (_req, res) => res.json({ secret: true }));
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      // Node lowercases incoming header names.
      const auth = (user: string, pass: string) => ({ authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });
      // Requests from this test come from loopback, which the middleware trusts (the renderer).
      expect((await fetch(`http://127.0.0.1:${port}/api/secret`)).status).toBe(200);

      // Simulate a remote client by checking the middleware directly.
      const remote = (headers: Record<string, string>, p = "/api/secret") => {
        let status = 200;
        const res = { setHeader() {}, status: (s: number) => ((status = s), { send() {} }) } as never;
        let passed = false;
        basicAuth("admin", "correct-horse-battery")(
          { path: p, headers, socket: { remoteAddress: "172.18.0.5" } } as never,
          res,
          () => (passed = true),
        );
        return passed ? 200 : status;
      };
      expect(remote({})).toBe(401);
      expect(remote(auth("admin", "wrong"))).toBe(401);
      expect(remote(auth("admin", "correct-horse-battery"))).toBe(200);
      expect(remote({}, "/api/health")).toBe(200);
    } finally {
      server.close();
    }
  });
});
