import { describe, expect, it, vi } from "vitest";
import { StudioService } from "../src/studio/application";
import type { Draft, PostMetric } from "../src/studio/domain";
import type { Platform } from "../src/domain";
import type { ContentGenerator, DraftRepository, LocalPublicationReader, MetricsProvider } from "../src/studio/ports";

class MemoryRepo implements DraftRepository {
  items = new Map<string, Draft>();
  async save(d: Draft) {
    this.items.set(d.id, d);
    return d;
  }
  async list() {
    return [...this.items.values()];
  }
  async get(id: string) {
    return this.items.get(id) ?? null;
  }
  async remove(id: string) {
    this.items.delete(id);
  }
}

const brand = { name: "Acme", niche: "historias", voice: "cercano", audience: "jóvenes", language: "es" as const };

function fakeGenerator(): ContentGenerator {
  return {
    post: vi.fn(async ({ platforms }: { platforms: Platform[] }) => ({
      kind: "post" as const,
      variants: platforms.map((platform) => ({ platform, text: "x".repeat(500), hashtags: ["#A", "a"] })),
    })),
    ads: vi.fn(async () => ({ kind: "ads" as const, objective: "ventas", audience: "todos", variants: [{ headline: "h", primaryText: "p", cta: "Compra" }] })),
    seo: vi.fn(async () => ({ kind: "seo" as const, keywords: ["a"], title: "t", description: "d", hashtags: ["x"] })),
    video: vi.fn(async () => ({ kind: "video" as const, hook: "h", script: "s", shots: ["1"], durationSec: 30 })),
    plan: vi.fn(async () => ({
      kind: "plan" as const,
      items: [
        { day: 1, platform: "tiktok" as const, topic: "uno", format: "video" },
        { day: 2, platform: "instagram" as const, topic: "dos", format: "post" },
        { day: 3, platform: "youtube" as const, topic: "tres", format: "video" },
      ],
    })),
    insights: vi.fn(async () => ["Publica más por la noche"]),
  };
}

const metrics = (list: PostMetric[]): MetricsProvider => ({ fetch: async () => list });
const local = (n: number): LocalPublicationReader => ({
  published: () => Array.from({ length: n }, (_, i) => ({ postId: `l${i}`, platform: "tiktok" as const, title: "t", publishedAt: "2026-01-01T10:00:00.000Z" })),
});

function build(over: Partial<{ gen: ContentGenerator; metrics: MetricsProvider | null; local: LocalPublicationReader }> = {}) {
  const repo = new MemoryRepo();
  const gen = over.gen ?? fakeGenerator();
  let n = 0;
  const service = new StudioService({
    generator: gen,
    drafts: repo,
    metrics: over.metrics === undefined ? metrics([]) : over.metrics,
    local: over.local ?? local(0),
    brand: () => brand,
    newId: () => `d${++n}`,
    now: () => new Date("2026-01-05T00:00:00.000Z"),
  });
  return { service, repo, gen };
}

describe("StudioService generation", () => {
  it("normalizes generated posts and saves a draft", async () => {
    const { service, repo } = build();
    const draft = await service.generate({ kind: "post", topic: "lanzamiento", platforms: ["tiktok"] });
    expect(draft.status).toBe("draft");
    expect(draft.createdAt).toBe("2026-01-05T00:00:00.000Z");
    if (draft.content.kind !== "post") throw new Error("kind");
    expect(draft.content.variants[0].text.length).toBeLessThanOrEqual(150);
    expect(draft.content.variants[0].hashtags).toEqual(["a"]);
    expect(await repo.get(draft.id)).toEqual(draft);
  });

  it.each(["ads", "seo", "video"] as const)("generates %s", async (kind) => {
    const { service, gen } = build();
    const draft = await service.generate({ kind, topic: "tema" });
    expect(draft.content.kind).toBe(kind);
    expect((gen[kind] as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ topic: "tema", brand });
  });

  it("rejects an empty topic", async () => {
    const { service } = build();
    await expect(service.generate({ kind: "seo", topic: "  " })).rejects.toThrow(/tema/i);
  });
});

describe("StudioService drafts", () => {
  it("updates status and removes drafts", async () => {
    const { service } = build();
    const d = await service.generate({ kind: "seo", topic: "x" });
    expect((await service.setStatus(d.id, "approved")).status).toBe("approved");
    await service.remove(d.id);
    expect(await service.list()).toEqual([]);
  });

  it("fails on unknown drafts", async () => {
    const { service } = build();
    await expect(service.setStatus("nope", "approved")).rejects.toThrow(/not found/i);
  });
});

describe("StudioService analytics", () => {
  it("uses the remote metrics when available", async () => {
    const { service } = build({ metrics: metrics([{ postId: "a", platform: "tiktok", title: "t", publishedAt: "2026-01-01T10:00:00.000Z", views: 10, likes: 1, comments: 0, shares: 0, saves: 0, clicks: 0 }]) });
    const r = await service.analytics();
    expect(r.source).toBe("remote");
    expect(r.summary.totals.views).toBe(10);
  });

  it("falls back to local publications when the provider fails or is missing", async () => {
    const failing: MetricsProvider = { fetch: async () => { throw new Error("down"); } };
    for (const m of [failing, null]) {
      const { service } = build({ metrics: m, local: local(2) });
      const r = await service.analytics();
      expect(r.source).toBe("local");
      expect(r.summary.totals.posts).toBe(2);
    }
  });

  it("adds AI insights on request", async () => {
    const { service, gen } = build();
    const r = await service.analytics({ withInsights: true });
    expect(r.insights).toEqual(["Publica más por la noche"]);
    expect(gen.insights).toHaveBeenCalled();
  });
});

describe("StudioService automation", () => {
  it("plans the week and drafts a post per plan item up to the limit", async () => {
    const { service, repo } = build();
    const result = await service.runAutomation({ platforms: ["tiktok", "instagram", "youtube"], maxDrafts: 2 });
    expect(result.plan.items).toHaveLength(3);
    expect(result.drafts).toHaveLength(2);
    expect((await repo.list()).map((d) => d.kind).sort()).toEqual(["plan", "post", "post"]);
  });

  it("keeps going when one draft fails", async () => {
    const gen = fakeGenerator();
    (gen.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockImplementation(async ({ platforms }: any) => ({
      kind: "post",
      variants: platforms.map((platform: string) => ({ platform, text: "ok", hashtags: [] })),
    }));
    const { service } = build({ gen });
    const result = await service.runAutomation({ platforms: ["tiktok"], maxDrafts: 2 });
    expect(result.drafts).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
});
