import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildComposition, pickStartAt, withOrigin } from "../src/composition";
import { isRedditUrl, parseRedditListing, toJsonUrl } from "../src/reddit";
import { buildLiteralBlocks, cleanText, estimateSeconds, fitToDuration } from "../src/script";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/reddit-post.json", import.meta.url), "utf8"));

describe("reddit", () => {
  it("parses the post and keeps the top real comments", () => {
    const post = parseRedditListing(fixture, 2);
    expect(post.title).toBe("TIL coffee grounds are a natural deodorizer");
    expect(post.subreddit).toBe("lifehacks");
    expect(post.score).toBe(12400);
    expect(post.comments.map((c) => c.author)).toEqual(["roach_watch", "baker"]);
  });

  it("builds the JSON endpoint from any reddit permalink", () => {
    expect(toJsonUrl("https://old.reddit.com/r/a/comments/xyz/title/?utm=1")).toBe(
      "https://www.reddit.com/r/a/comments/xyz/title.json?raw_json=1&sort=top&limit=100",
    );
    expect(isRedditUrl("https://www.reddit.com/r/a/comments/xyz/")).toBe(true);
    expect(isRedditUrl("https://redd.it/xyz")).toBe(true);
    expect(isRedditUrl("https://example.com/r/a")).toBe(false);
  });
});

describe("script", () => {
  it("cleans markdown, links and expands reddit acronyms", () => {
    expect(cleanText("TIL **this** [works](https://x.y) great\n\nsee https://a.b r/lifehacks")).toBe(
      "Today I learned this works great see lifehacks",
    );
    expect(cleanText("AITA for this? NTA, IMO")).toBe("Am I the jerk for this? Not the jerk, in my opinion");
  });

  it("orders blocks title → post → comments", () => {
    const blocks = buildLiteralBlocks(parseRedditListing(fixture, 2));
    expect(blocks.map((b) => b.kind)).toEqual(["title", "post", "comment", "comment"]);
    expect(blocks[1].text).toContain("bedroom or kitchen");
  });

  it("drops comments then shortens the post to fit the duration", () => {
    const long = "This is a sentence that keeps going. ".repeat(40).trim();
    const blocks = [
      { kind: "title" as const, text: "A title" },
      { kind: "post" as const, text: long },
      { kind: "comment" as const, text: "A comment here." },
    ];
    const fitted = fitToDuration(blocks, 20);
    expect(fitted.map((b) => b.kind)).toEqual(["title", "post"]);
    const total = fitted.reduce((s, b) => s + estimateSeconds(b.text) + 0.35, 0);
    expect(total).toBeLessThanOrEqual(21);
    expect(fitted[1].text.endsWith(".")).toBe(true);
  });
});

describe("composition", () => {
  const tts = {
    duration: 4,
    timing_source: "whisper" as const,
    blocks: [{ start: 0, end: 1.5 }, { start: 1.85, end: 4 }],
    words: [{ text: "Hi", start: 0, end: 0.5 }],
  };
  const base = {
    audioSrc: "/media/jobs/x/voice.wav",
    tts,
    blocks: [{ kind: "title" as const, text: "T" }, { kind: "post" as const, text: "P" }],
    post: { subreddit: "s", author: "a", title: "T", upvotes: 1, comments: 2 },
    background: { kind: "procedural" as const, preset: "ocean" as const },
    music: null,
    captionStyle: "pop" as const,
  };

  it("maps block timings to scenes and sizes the video to the audio", () => {
    const comp = buildComposition(base);
    expect(comp.scenes[1]).toMatchObject({ kind: "post", start: 1.85, end: 4 });
    expect(comp.durationInFrames).toBe(Math.ceil((4 + 0.8) * 30));
    expect(comp.width).toBe(1080);
    expect(comp.height).toBe(1920);
  });

  it("rejects mismatched timings", () => {
    expect(() => buildComposition({ ...base, blocks: [base.blocks[0]] })).toThrow();
  });

  it("makes media URLs absolute for the renderer only", () => {
    const comp = withOrigin(buildComposition(base), "http://localhost:8787");
    expect(comp.audio.src).toBe("http://localhost:8787/media/jobs/x/voice.wav");
  });

  it("starts the clip early enough to cover the narration", () => {
    expect(pickStartAt(60, 30, () => 1)).toBe(30);
    expect(pickStartAt(20, 30, () => 0.5)).toBe(0);
  });
});
