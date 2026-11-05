import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileImageStore } from "../src/studio/adapters/imageStore";
import { LlmContentGenerator } from "../src/studio/adapters/llmGenerator";
import { OpenAIImageGenerator, imageSize } from "../src/studio/adapters/openaiImages";

const brand = { name: "Acme", niche: "n", voice: "v", audience: "a", language: "es" as const };

describe("FileImageStore", () => {
  it("writes the png and returns a media url and its file path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studio-img-"));
    const { url, filePath } = await new FileImageStore(dir).save(Buffer.from("png-bytes"));
    expect(url).toMatch(/^\/media\/studio\/[\w-]+\.png$/);
    expect(path.dirname(filePath)).toBe(dir);
    expect((await fs.readFile(filePath)).toString()).toBe("png-bytes");
  });

  it("resolves a media url back to a file inside the folder only", () => {
    const store = new FileImageStore("/data/studio");
    expect(store.pathOf("/media/studio/a.png")).toBe(path.join("/data/studio", "a.png"));
    expect(() => store.pathOf("/media/studio/../../secret")).toThrow();
  });
});

describe("OpenAIImageGenerator", () => {
  it("maps aspects to sizes", () => {
    expect(imageSize("square")).toBe("1024x1024");
    expect(imageSize("portrait")).toBe("1024x1536");
    expect(imageSize("landscape")).toBe("1536x1024");
  });

  it("requests an image and decodes the base64 result", async () => {
    const generate = vi.fn(async () => ({ data: [{ b64_json: Buffer.from("img").toString("base64") }] }));
    const gen = new OpenAIImageGenerator(() => ({ client: { images: { generate } } as never, model: "gpt-image-1" }));
    const png = await gen.generate("a cup", "portrait");
    expect(png.toString()).toBe("img");
    expect(generate).toHaveBeenCalledWith({ model: "gpt-image-1", prompt: "a cup", size: "1024x1536", n: 1 });
  });

  it("downloads the image when the provider answers with a url", async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from("remote")));
    const generate = vi.fn(async () => ({ data: [{ url: "https://x/y.png" }] }));
    const gen = new OpenAIImageGenerator(() => ({ client: { images: { generate } } as never, model: "m" }), fetchImpl as never);
    expect((await gen.generate("p", "square")).toString()).toBe("remote");
  });

  it("fails clearly when there is no usable provider or empty answer", async () => {
    await expect(new OpenAIImageGenerator(() => null).generate("p", "square")).rejects.toThrow(/OpenAI/);
    const empty = new OpenAIImageGenerator(() => ({ client: { images: { generate: async () => ({ data: [] }) } } as never, model: "m" }));
    await expect(empty.generate("p", "square")).rejects.toThrow(/imagen/i);
  });
});

describe("LlmContentGenerator formats", () => {
  it("asks for the chosen formats and keeps slides and image prompts", async () => {
    const structured = vi.fn(async () => ({
      variants: [{ platform: "instagram", format: "carousel", text: "t", hashtags: [], slides: ["a", "b"], imagePrompt: "p" }],
    }));
    const post = await new LlmContentGenerator(structured as never).post({ topic: "x", brand, platforms: ["instagram"], formats: { instagram: "carousel" } });
    expect(post.variants[0]).toMatchObject({ format: "carousel", slides: ["a", "b"], imagePrompt: "p" });
    const req = (structured.mock.calls[0] as unknown as [{ prompt: string }])[0];
    expect(req.prompt).toMatch(/carousel/);
  });
});
