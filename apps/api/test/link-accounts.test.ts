import { toNodeHandler } from "better-auth/node";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.SETUP_PASSWORD = "setup-password-for-tests";
const { AUTH_BASE_PATH, SETUP_EMAIL, auth, initAuth } = await import("../src/auth");
const { loadAIConfig, setSecrets } = await import("../src/aiconfig");
const { accounts } = await import("../src/publish/accounts");
const { accountStatuses, onPlatformLinked, publishers } = await import("../src/publish");
const { tokenSource } = await import("../src/publish/tokens");

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;
let tokenCalls = 0;

/** Fake TikTok: token endpoint (code and refresh grants) and user info. Local requests pass through. */
function fakeTikTok(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
  if (url.startsWith("https://open.tiktokapis.com/v2/oauth/token")) {
    tokenCalls++;
    const body = new URLSearchParams(String(init?.body ?? ""));
    expect(body.get("client_key")).toBe("ck");
    const refreshed = body.get("grant_type") === "refresh_token";
    return json({ access_token: refreshed ? "TT-2" : "TT-1", refresh_token: "RT", expires_in: 86400, open_id: "open-1", token_type: "Bearer" });
  }
  if (url.startsWith("https://open.tiktokapis.com/v2/user/info")) return json({ data: { user: { open_id: "open-1", display_name: "Mi TikTok" } } });
  return realFetch(input, init);
}

beforeAll(async () => {
  await loadAIConfig();
  await setSecrets({ tiktok_client_key: "ck", tiktok_client_secret: "cs" });
  await initAuth();
  vi.stubGlobal("fetch", fakeTikTok);
  const app = express();
  app.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  vi.unstubAllGlobals();
  server.close();
});

/** Minimal cookie jar. */
const jar = new Map<string, string>();
const remember = (res: Response) => res.headers.getSetCookie().forEach((c) => jar.set(c.split("=")[0], c.split(";")[0]));
const cookie = () => [...jar.values()].join("; ");

describe("linking publishing accounts through Better Auth", () => {
  it("links TikTok to the logged-in user and makes it the publishing account", async () => {
    remember(
      await fetch(`${base}${AUTH_BASE_PATH}/sign-in/email`, {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ email: SETUP_EMAIL, password: "setup-password-for-tests" }),
      }),
    );

    // Step 1: the browser asks for the provider URL (authClient.linkSocial).
    const start = await fetch(`${base}${AUTH_BASE_PATH}/link-social`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json", cookie: cookie() },
      body: JSON.stringify({ provider: "tiktok", callbackURL: "/?tab=settings&connected=tiktok" }),
    });
    remember(start);
    const { url } = (await start.json()) as { url: string };
    const authorize = new URL(url);
    expect(authorize.hostname).toBe("www.tiktok.com");
    expect(authorize.searchParams.get("scope")).toBe("user.info.basic,video.publish");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${process.env.API_ORIGIN ?? "http://localhost:8787"}${AUTH_BASE_PATH}/callback/tiktok`);

    // Step 2: TikTok redirects back with a code.
    const linked = new Promise((resolve) => onPlatformLinked(resolve));
    const callback = await fetch(`${base}${AUTH_BASE_PATH}/callback/tiktok?code=abc&state=${authorize.searchParams.get("state")}`, {
      headers: { cookie: cookie() },
      redirect: "manual",
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("connected=tiktok");
    expect(await linked).toMatchObject({ platform: "tiktok", ok: true });

    expect(accounts.get().tiktok).toMatchObject({ accountName: "Mi TikTok", linkedBy: "Usuario temporal" });
    expect(accountStatuses().find((a) => a.platform === "tiktok")).toMatchObject({ connected: true, configured: true });
    expect(await tokenSource.accessToken("tiktok")).toBe("TT-1");
  });

  it("refreshes an expired token with the provider's refresh token", async () => {
    const ctx = await auth.$context;
    await ctx.internalAdapter.updateAccount(accounts.get().tiktok!.accountId, { accessTokenExpiresAt: new Date(Date.now() - 1000) });
    const before = tokenCalls;
    expect(await tokenSource.accessToken("tiktok")).toBe("TT-2");
    expect(tokenCalls).toBe(before + 1);
  });

  it("asks Google for YouTube upload with a refresh token, and Facebook for Page publishing", async () => {
    await setSecrets({ youtube_client_id: "gid", youtube_client_secret: "gs", facebook_app_id: "fid", facebook_app_secret: "fs" });
    const authorize = async (provider: string) => {
      const res = await fetch(`${base}${AUTH_BASE_PATH}/link-social`, {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json", cookie: cookie() },
        body: JSON.stringify({ provider, callbackURL: "/" }),
      });
      return new URL(((await res.json()) as { url: string }).url).searchParams;
    };
    const google = await authorize("google");
    expect(google.get("client_id")).toBe("gid");
    expect(google.get("scope")).toContain("https://www.googleapis.com/auth/youtube.upload");
    expect(google.get("access_type")).toBe("offline");
    expect(google.get("prompt")).toBe("consent");
    const facebook = await authorize("facebook");
    expect(facebook.get("client_id")).toBe("fid");
    expect(facebook.get("scope")).toContain("pages_manage_posts");
  });

  it("does not allow signing in with a social account", async () => {
    const res = await fetch(`${base}${AUTH_BASE_PATH}/sign-in/social`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "tiktok" }),
    });
    expect(res.status).toBe(403);
  });

  it("disconnects by deleting the linked account", async () => {
    await publishers.tiktok.disconnect();
    expect(accounts.get().tiktok).toBeNull();
    expect(accountStatuses().find((a) => a.platform === "tiktok")?.connected).toBe(false);
    await expect(tokenSource.accessToken("tiktok")).rejects.toMatchObject({ retryable: false });
  });
});
