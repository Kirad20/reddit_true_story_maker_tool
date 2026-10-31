import { beforeEach, describe, expect, it, vi } from "vitest";
import { secrets } from "../src/aiconfig";
import { duePublications, partTitle, videosFor } from "../src/automation";
import type { Publication } from "../src/domain";
import { estimateSeconds, withPartNarration } from "../src/script";
import { applyCuts, heuristicCuts, planSplit, sentences, validCuts, type PartsConfig } from "../src/splitter";

const cfg: PartsConfig = { enabled: true, splitAboveSec: 70, minPartSec: 30, maxParts: 3 };

// ~ 24 sentences of ~12 words: about 105 s of narration.
const longStory = Array.from(
  { length: 24 },
  (_, i) => `Sentence number ${i + 1} keeps the story moving with a few more ordinary words here.`,
).join(" ");

beforeEach(async () => {
  // No model key configured: the splitter falls back to its heuristic.
  await secrets.set({});
});

describe("splitter", () => {
  it("splits prose into sentences without breaking quotes or abbreviations at lowercase", () => {
    expect(sentences('He said "no." Then he left! Was it fair? yes it was. Done.')).toEqual([
      'He said "no."',
      "Then he left!",
      "Was it fair? yes it was.",
      "Done.",
    ]);
  });

  it("keeps short stories in one part", async () => {
    const plan = await planSplit("Title", "One short sentence. Another one. And a third. Plus four.", cfg);
    expect(plan.parts).toHaveLength(1);
  });

  it("does nothing when disabled", async () => {
    const plan = await planSplit("Title", longStory, { ...cfg, enabled: false });
    expect(plan).toMatchObject({ by: "disabled", parts: [longStory] });
  });

  it("splits long stories evenly at sentence boundaries without losing text", async () => {
    const plan = await planSplit("Title", longStory, cfg);
    expect(plan.by).toBe("heuristic");
    expect(plan.parts.length).toBeGreaterThanOrEqual(2);
    expect(plan.parts.length).toBeLessThanOrEqual(3);
    expect(plan.parts.join(" ")).toBe(longStory);
    for (const p of plan.parts) expect(estimateSeconds(p)).toBeGreaterThanOrEqual(cfg.minPartSec);
  });

  it("respects maxParts = 2", () => {
    const cuts = heuristicCuts(sentences(longStory), { ...cfg, maxParts: 2 });
    expect(cuts).toHaveLength(1);
  });

  it("rejects cuts that leave a part too short or out of order", () => {
    const list = sentences(longStory);
    expect(validCuts(list, [0], 30, 3)).toBe(false); // first part ~4 s
    expect(validCuts(list, [12, 8], 30, 3)).toBe(false);
    expect(validCuts(list, [list.length - 1], 30, 3)).toBe(false);
    expect(validCuts(list, [11], 30, 3)).toBe(true);
    expect(applyCuts(list, [11])).toHaveLength(2);
  });
});

describe("part narration", () => {
  const blocks = [
    { kind: "title" as const, text: "My roommate labeled the eggs" },
    { kind: "post" as const, text: "It started on Monday." },
  ];

  it("announces the part and invites to follow for the next one", () => {
    const out = withPartNarration(blocks, { index: 1, total: 3 }, "en");
    expect(out[0].text).toBe("My roommate labeled the eggs. Part one.");
    expect(out.at(-1)).toEqual({ kind: "outro", text: "Follow so you don't miss part two." });
  });

  it("has no outro on the last part and speaks Spanish", () => {
    const out = withPartNarration(blocks, { index: 3, total: 3 }, "es");
    expect(out[0].text).toBe("My roommate labeled the eggs. Parte tres.");
    expect(out.some((b) => b.kind === "outro")).toBe(false);
  });

  it("does not mutate the input", () => {
    withPartNarration(blocks, { index: 2, total: 2 }, "en");
    expect(blocks[0].text).toBe("My roommate labeled the eggs");
  });
});

describe("platform videos", () => {
  const story = { jobId: "full", partJobIds: ["p1", "p2", "p3"] };

  it("gives YouTube the full video and TikTok/Facebook the parts", () => {
    expect(videosFor("youtube", story)).toEqual([{ jobId: "full", part: null }]);
    expect(videosFor("tiktok", story).map((v) => [v.jobId, v.part?.index, v.part?.total])).toEqual([
      ["p1", 1, 3],
      ["p2", 2, 3],
      ["p3", 3, 3],
    ]);
    expect(videosFor("facebook", { jobId: "full", partJobIds: [] })).toEqual([{ jobId: "full", part: null }]);
  });

  it("labels part titles", () => {
    expect(partTitle("Eggs", { index: 2, total: 3 }, "es", 100)).toBe("Parte 2/3 · Eggs");
    expect(partTitle("Eggs", null, "en", 100)).toBe("Eggs");
  });
});

describe("publication order", () => {
  const base = (over: Partial<Publication>): Publication => ({
    id: "x",
    storyId: "st",
    jobId: "j",
    platform: "tiktok",
    status: "scheduled",
    createdAt: "",
    scheduledAt: new Date(0).toISOString(),
    publishedAt: null,
    title: "",
    description: "",
    tags: [],
    remoteId: null,
    url: null,
    error: null,
    attempts: 0,
    part: null,
    ...over,
  });

  it("holds part 2 until part 1 is published", () => {
    const p1 = base({ id: "p1", part: { index: 1, total: 2 } });
    const p2 = base({ id: "p2", part: { index: 2, total: 2 } });
    expect(duePublications([p2, p1]).map((p) => p.id)).toEqual(["p1"]);
    expect(duePublications([p2, { ...p1, status: "published" }]).map((p) => p.id)).toEqual(["p2"]);
  });

  it("does not let parts of another platform unblock each other", () => {
    const fbPart1 = base({ id: "fb1", platform: "facebook", status: "published", part: { index: 1, total: 2 } });
    const tkPart2 = base({ id: "tk2", platform: "tiktok", part: { index: 2, total: 2 } });
    expect(duePublications([fbPart1, tkPart2])).toEqual([]);
  });

  it("ignores publications scheduled in the future", () => {
    const later = base({ id: "later", scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(duePublications([later])).toEqual([]);
  });
});
