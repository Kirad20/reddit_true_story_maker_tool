import { describe, expect, it, vi } from "vitest";
import { StudioService } from "../src/studio/application";
import { FORMATS_BY_PLATFORM, defaultFormat, imageAspect, normalizePost, type Draft } from "../src/studio/domain";
import type { ContentGenerator, ImageGenerator, ImageStore, SocialPublisher } from "../src/studio/ports";

const brand = { name: "Acme", niche: "n", voice: "v", audience: "a", language: "es" as const };

describe("post formats", () => {
  it("lists several formats per platform and a default each", () => {
    for (const [platform, formats] of Object.entries(FORMATS_BY_PLATFORM)) {
      expect(formats.length).toBeGreaterThan(1);
      expect(formats).toContain(defaultFormat(platform as never));
    }
  });

  it("falls back to the default format when the model picks one the platform lacks", () => {
    const v = normalizePost({ platform: "facebook", format: "reel", text: "x", hashtags: [] });
    expect(v.format).toBe(defaultFormat("facebook"));
  });

  it("keeps slides only for carousels, max 10", () => {
    const slides = Array.from({ length: 14 }, (_, i) => `s${i}`);
    expect(normalizePost({ platform: "instagram", format: "carousel", text: "x", hashtags: [], slides }).slides).toHaveLength(10);
    expect(normalizePost({ platform: "instagram", format: "image", text: "x", hashtags: [], slides }).slides).toBeUndefined();
  });

  it("picks the image aspect from the format", () => {
    expect(imageAspect("instagram", "story")).toBe("portrait");
    expect(imageAspect("instagram", "image")).toBe("square");
    expect(imageAspect("youtube", "community")).toBe("landscape");
  });
});

function build(opts: { publisher?: SocialPublisher; images?: ImageGenerator | null; draft?: Partial<Draft> } = {}) {
  const store = new Map<string, Draft>();
  const base: Draft = {
    id: "d1",
    kind: "post",
    topic: "cafe",
    status: "approved",
    createdAt: "2026-01-01T00:00:00.000Z",
    content: {
      kind: "post",
      variants: [
        { platform: "instagram", format: "image", text: "Hola", hashtags: ["a"], imagePrompt: "una taza" },
        { platform: "facebook", format: "text", text: "Hey", hashtags: [] },
      ],
    },
    ...opts.draft,
  };
  store.set(base.id, base);
  const generator = { post: vi.fn(async () => ({ kind: "post" as const, variants: [] })) } as unknown as ContentGenerator;
  const saved: Buffer[] = [];
  const imageStore: ImageStore = { save: async (b) => (saved.push(b), { url: "/media/studio/a.png", filePath: "/tmp/a.png" }) };
  const service = new StudioService({
    generator,
    drafts: {
      save: async (d) => (store.set(d.id, d), d),
      list: async () => [...store.values()],
      get: async (id) => store.get(id) ?? null,
      remove: async (id) => void store.delete(id),
    },
    metrics: null,
    local: { published: () => [] },
    publisher: opts.publisher,
    images: opts.images === null ? undefined : (opts.images ?? { generate: vi.fn(async () => Buffer.from("png")) }),
    imageStore,
    brand: () => brand,
    newId: () => "x",
    now: () => new Date("2026-01-05T00:00:00.000Z"),
  });
  return { service, store, generator, saved };
}

describe("StudioService formats", () => {
  it("passes the requested formats to the generator", async () => {
    const { service, generator } = build();
    await service.generate({ kind: "post", topic: "t", platforms: ["instagram"], formats: { instagram: "carousel" } });
    expect((generator.post as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ formats: { instagram: "carousel" } });
  });

  it("rejects a format the platform does not support", async () => {
    const { service } = build();
    await expect(service.generate({ kind: "post", topic: "t", platforms: ["facebook"], formats: { facebook: "reel" } })).rejects.toThrow(/formato/i);
  });
});

describe("StudioService.illustrate", () => {
  it("generates an image from the variant prompt and stores its url", async () => {
    const images = { generate: vi.fn(async () => Buffer.from("png")) };
    const { service, saved } = build({ images });
    const d = await service.illustrate("d1", "instagram");
    expect(images.generate).toHaveBeenCalledWith(expect.stringContaining("una taza"), "square");
    expect(saved).toHaveLength(1);
    expect(d.content.kind === "post" && d.content.variants[0].imageUrl).toBe("/media/studio/a.png");
  });

  it("falls back to a prompt built from topic and text", async () => {
    const images = { generate: vi.fn(async () => Buffer.from("png")) };
    const { service } = build({ images });
    await service.illustrate("d1", "facebook");
    expect((images.generate.mock.calls[0] as unknown as [string])[0]).toContain("cafe");
  });

  it("fails clearly without an image generator or variant", async () => {
    await expect(build({ images: null }).service.illustrate("d1", "instagram")).rejects.toThrow(/imágenes/i);
    await expect(build().service.illustrate("d1", "tiktok")).rejects.toThrow(/variante/i);
  });
});

describe("StudioService.publish with images", () => {
  const draftWithImage = (platform: "instagram" | "facebook", imageUrl?: string): Partial<Draft> => ({
    content: { kind: "post", variants: [{ platform, format: "image", text: "Hola", hashtags: [], imageUrl }] },
  });

  it("publishes an image post to Instagram using the stored file", async () => {
    const publisher = { publishPost: vi.fn(async () => ({ url: "u" })) };
    const { service } = build({ publisher, draft: draftWithImage("instagram", "/media/studio/a.png") });
    await service.publish("d1", "instagram");
    expect(publisher.publishPost).toHaveBeenCalledWith("instagram", "Hola", "/media/studio/a.png");
  });

  it("requires an image for Instagram", async () => {
    const publisher = { publishPost: vi.fn() };
    const { service } = build({ publisher, draft: draftWithImage("instagram") });
    await expect(service.publish("d1", "instagram")).rejects.toThrow(/imagen/i);
    expect(publisher.publishPost).not.toHaveBeenCalled();
  });

  it("publishes text-only to Facebook with no media", async () => {
    const publisher = { publishPost: vi.fn(async () => ({ url: null })) };
    const { service } = build({ publisher, draft: { content: { kind: "post", variants: [{ platform: "facebook", text: "Hey", hashtags: [] }] } } });
    await service.publish("d1", "facebook");
    expect(publisher.publishPost).toHaveBeenCalledWith("facebook", "Hey", null);
  });
});
