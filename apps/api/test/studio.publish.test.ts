import { describe, expect, it, vi } from "vitest";
import { StudioService } from "../src/studio/application";
import type { Draft } from "../src/studio/domain";
import type { SocialPublisher } from "../src/studio/ports";

const brand = { name: "Acme", niche: "n", voice: "v", audience: "a", language: "es" as const };

function build(publisher?: SocialPublisher, draft?: Partial<Draft>) {
  const store = new Map<string, Draft>();
  const base: Draft = {
    id: "d1",
    kind: "post",
    topic: "t",
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    content: { kind: "post", variants: [{ platform: "facebook", text: "Hola", hashtags: ["a", "b"] }, { platform: "tiktok", text: "Hey", hashtags: [] }] },
    ...draft,
  };
  store.set(base.id, base);
  const service = new StudioService({
    generator: {} as never,
    drafts: {
      save: async (d) => (store.set(d.id, d), d),
      list: async () => [...store.values()],
      get: async (id) => store.get(id) ?? null,
      remove: async (id) => void store.delete(id),
    },
    metrics: null,
    local: { published: () => [] },
    publisher,
    brand: () => brand,
    newId: () => "x",
    now: () => new Date("2026-01-05T00:00:00.000Z"),
  });
  return { service, store };
}

describe("StudioService.publish", () => {
  it("publishes an approved text variant and records it on the draft", async () => {
    const publisher = { publishText: vi.fn(async () => ({ url: "https://fb/1" })) };
    const { service, store } = build(publisher);
    const d = await service.publish("d1", "facebook");
    expect(publisher.publishText).toHaveBeenCalledWith("facebook", "Hola\n\n#a #b");
    expect(d.published).toEqual([{ platform: "facebook", at: "2026-01-05T00:00:00.000Z", url: "https://fb/1" }]);
    expect(store.get("d1")?.published).toHaveLength(1);
  });

  it("refuses drafts that are not approved", async () => {
    const { service } = build({ publishText: vi.fn() }, { status: "draft" });
    await expect(service.publish("d1", "facebook")).rejects.toThrow(/aprueba/i);
  });

  it("refuses platforms that need media", async () => {
    const publisher = { publishText: vi.fn() };
    const { service } = build(publisher);
    await expect(service.publish("d1", "tiktok")).rejects.toThrow(/video|media/i);
    expect(publisher.publishText).not.toHaveBeenCalled();
  });

  it("refuses non-post drafts, missing variants, double publishing and a missing publisher", async () => {
    await expect(build({ publishText: vi.fn() }, { kind: "seo", content: { kind: "seo", keywords: [], title: "", description: "", hashtags: [] } }).service.publish("d1", "facebook")).rejects.toThrow(/publicaci/i);
    await expect(build({ publishText: vi.fn() }, { content: { kind: "post", variants: [] } }).service.publish("d1", "facebook")).rejects.toThrow(/variante/i);
    await expect(build({ publishText: vi.fn() }, { published: [{ platform: "facebook", at: "x", url: null }] }).service.publish("d1", "facebook")).rejects.toThrow(/ya/i);
    await expect(build(undefined).service.publish("d1", "facebook")).rejects.toThrow(/publicar/i);
  });
});
