import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioService } from "../src/studio/application";
import { LlmContentGenerator } from "../src/studio/adapters/llmGenerator";
import { mapAnalytics } from "../src/studio/adapters/zernioMetrics";
import { studioRouter } from "../src/studio/adapters/http";
import type { Draft } from "../src/studio/domain";

const brand = { name: "Acme", niche: "n", voice: "v", audience: "a", language: "es" as const };

describe("LlmContentGenerator", () => {
  it("calls the studio agent with the brand and topic and returns typed content", async () => {
    const structured = vi.fn(async () => ({ variants: [{ platform: "tiktok", text: "hola", hashtags: ["a"] }] }));
    const gen = new LlmContentGenerator(structured as never);
    const post = await gen.post({ topic: "lanzamiento", brand, platforms: ["tiktok"] });
    expect(post).toEqual({ kind: "post", variants: [{ platform: "tiktok", text: "hola", hashtags: ["a"] }] });
    const req = (structured.mock.calls[0] as unknown as [{ agent: string; prompt: string; system: string }])[0];
    expect(req.agent).toBe("studio");
    expect(req.prompt).toContain("lanzamiento");
    expect(req.system).toContain("Acme");
  });

  it("drops plan items with unknown platforms", async () => {
    const structured = vi.fn(async () => ({
      items: [
        { day: 1, platform: "tiktok", topic: "a", format: "video" },
        { day: 2, platform: "myspace", topic: "b", format: "post" },
      ],
    }));
    const plan = await new LlmContentGenerator(structured as never).plan({ topic: "t", brand, platforms: ["tiktok"], days: 7 });
    expect(plan.items).toHaveLength(1);
  });

  it("returns insights as a list", async () => {
    const structured = vi.fn(async () => ({ insights: ["a", "b"] }));
    const out = await new LlmContentGenerator(structured as never).insights({
      brand,
      summary: { totals: { posts: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagementRate: 0 }, byPlatform: {}, topPosts: [], bestHours: [] },
    });
    expect(out).toEqual(["a", "b"]);
  });
});

describe("mapAnalytics", () => {
  it("maps Zernio posts to metrics and skips unknown platforms", () => {
    const out = mapAnalytics({
      posts: [
        { _id: "1", platform: "tiktok", content: "Hello", publishedAt: "2026-01-01T10:00:00Z", analytics: { views: 10, likes: 2, comments: 1, shares: 1, saves: 0, clicks: 3 } },
        { _id: "2", platform: "linkedin", content: "x", publishedAt: "2026-01-01T10:00:00Z", analytics: { views: 5 } },
        { _id: "3", platform: "youtube", content: "No data", publishedAt: "2026-01-02T10:00:00Z" },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ postId: "1", platform: "tiktok", views: 10, likes: 2, clicks: 3 });
    expect(out[1]).toMatchObject({ postId: "3", views: 0 });
  });

  it("returns an empty list for unexpected payloads", () => {
    expect(mapAnalytics(undefined)).toEqual([]);
    expect(mapAnalytics({})).toEqual([]);
  });
});

describe("studioRouter", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  afterEach(() => server?.close());

  async function start() {
    const store = new Map<string, Draft>();
    let n = 0;
    const service = new StudioService({
      generator: {
        post: async ({ platforms }) => ({ kind: "post", variants: platforms.map((platform) => ({ platform, text: "t", hashtags: [] })) }),
        ads: async () => ({ kind: "ads", objective: "o", audience: "a", variants: [] }),
        seo: async () => ({ kind: "seo", keywords: [], title: "t", description: "d", hashtags: [] }),
        video: async () => ({ kind: "video", hook: "h", script: "s", shots: [], durationSec: 30 }),
        plan: async () => ({ kind: "plan", items: [] }),
        insights: async () => ["x"],
      },
      drafts: {
        save: async (d) => (store.set(d.id, d), d),
        list: async () => [...store.values()],
        get: async (id) => store.get(id) ?? null,
        remove: async (id) => void store.delete(id),
      },
      metrics: null,
      local: { published: () => [] },
      brand: () => brand,
      newId: () => `d${++n}`,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const app = express();
    app.use(express.json());
    app.use("/api/studio", studioRouter(service));
    server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio`;
    const call = (path: string, init?: RequestInit) =>
      fetch(base + path, { ...init, headers: { "content-type": "application/json" } }).then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }));
    return call;
  }

  it("generates, lists, approves and deletes drafts", async () => {
    const call = await start();
    const created = await call("/generate", { method: "POST", body: JSON.stringify({ kind: "post", topic: "hola", platforms: ["tiktok"] }) });
    expect(created.status).toBe(201);
    expect((await call("/drafts")).body).toHaveLength(1);
    const approved = await call(`/drafts/${created.body.id}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
    expect(approved.body.status).toBe("approved");
    expect((await call(`/drafts/${created.body.id}`, { method: "DELETE" })).status).toBe(204);
  });

  it("validates input with 400", async () => {
    const call = await start();
    expect((await call("/generate", { method: "POST", body: JSON.stringify({ kind: "nope", topic: "x" }) })).status).toBe(400);
    expect((await call("/generate", { method: "POST", body: JSON.stringify({ kind: "seo", topic: "" }) })).status).toBe(400);
  });

  it("serves analytics with insights", async () => {
    const call = await start();
    const r = await call("/analytics?insights=1");
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("local");
    expect(r.body.insights).toEqual(["x"]);
  });
});
