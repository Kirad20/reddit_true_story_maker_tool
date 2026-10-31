import { toNodeHandler } from "better-auth/node";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.SETUP_PASSWORD = "setup-password-for-tests";
const { AUTH_BASE_PATH, SETUP_EMAIL, auth, initAuth, requireSession } = await import("../src/auth");

let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  await initAuth();
  const app = express();
  app.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  app.use(requireSession());
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/me", (_req, res) => res.json(res.locals.user));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const origin = () => ({ Origin: base, "Content-Type": "application/json" });

async function signIn(email: string, password: string): Promise<string | null> {
  const res = await fetch(`${base}${AUTH_BASE_PATH}/sign-in/email`, { method: "POST", headers: origin(), body: JSON.stringify({ email, password }) });
  if (!res.ok) return null;
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

describe("auth", () => {
  it("protects the API but not health", async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it("does not allow public sign-up", async () => {
    const res = await fetch(`${base}${AUTH_BASE_PATH}/sign-up/email`, {
      method: "POST",
      headers: origin(),
      body: JSON.stringify({ email: "intruder@example.com", password: "whatever-123", name: "x" }),
    });
    expect(res.ok).toBe(false);
  });

  it("logs in with the temporary user, which is deleted once a real admin exists", async () => {
    const cookie = await signIn(SETUP_EMAIL, "setup-password-for-tests");
    expect(cookie).toBeTruthy();
    const me = await (await fetch(`${base}/api/me`, { headers: { cookie: cookie! } })).json();
    expect(me).toMatchObject({ email: SETUP_EMAIL, role: "admin", temporary: true });

    // Creating a plain user keeps the temporary admin.
    const create = (body: object) =>
      fetch(`${base}${AUTH_BASE_PATH}/admin/create-user`, { method: "POST", headers: { ...origin(), cookie: cookie! }, body: JSON.stringify(body) });
    expect((await create({ email: "editor@example.com", password: "editor-pass-123", name: "Editor", role: "user" })).ok).toBe(true);
    expect(await signIn(SETUP_EMAIL, "setup-password-for-tests")).toBeTruthy();

    // Creating a real admin removes the temporary user and its sessions.
    expect((await create({ email: "owner@example.com", password: "owner-pass-123", name: "Owner", role: "admin" })).ok).toBe(true);
    expect((await fetch(`${base}/api/me`, { headers: { cookie: cookie! } })).status).toBe(401);
    expect(await signIn(SETUP_EMAIL, "setup-password-for-tests")).toBeNull();

    const owner = await signIn("owner@example.com", "owner-pass-123");
    expect(owner).toBeTruthy();
    const list = await (await fetch(`${base}${AUTH_BASE_PATH}/admin/list-users`, { headers: { cookie: owner! } })).json();
    expect(list.users.map((u: { email: string }) => u.email).sort()).toEqual(["editor@example.com", "owner@example.com"]);

    // Restarting does not bring the temporary user back.
    await initAuth();
    expect(await signIn(SETUP_EMAIL, "setup-password-for-tests")).toBeNull();
  });

  it("forbids user management to non-admins", async () => {
    const editor = await signIn("editor@example.com", "editor-pass-123");
    const res = await fetch(`${base}${AUTH_BASE_PATH}/admin/list-users`, { headers: { cookie: editor! } });
    expect(res.status).toBe(403);
  });
});
