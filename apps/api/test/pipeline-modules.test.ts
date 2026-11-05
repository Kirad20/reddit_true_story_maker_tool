import { describe, expect, it } from "vitest";
import { fallbackMetadata } from "../src/agents";
import type { Story } from "../src/domain";
import { nextSlot, parseSlots } from "../src/schedule";

describe("nextSlot", () => {
  const base = { platform: "youtube" as const, slots: ["18:00", "12:00", "bad", "21:00"], dailyLimit: 2 };

  it("parses and sorts valid HH:MM slots", () => {
    expect(parseSlots(["18:00", "9:30", "25:00", "x"])).toEqual([570, 1080]);
  });

  it("returns the next slot later today", () => {
    const now = new Date(2026, 9, 31, 13, 0);
    const slot = nextSlot({ ...base, now, existing: [] });
    expect([slot.getDate(), slot.getHours(), slot.getMinutes()]).toEqual([31, 18, 0]);
  });

  it("skips taken slots and full days", () => {
    const now = new Date(2026, 9, 31, 8, 0);
    const at = (h: number, d = 31) => new Date(2026, 9, d, h, 0).toISOString();
    const existing = [
      { platform: "youtube" as const, status: "scheduled" as const, scheduledAt: at(12), publishedAt: null },
      { platform: "youtube" as const, status: "published" as const, scheduledAt: at(18), publishedAt: at(18) },
      { platform: "tiktok" as const, status: "scheduled" as const, scheduledAt: at(12, 1), publishedAt: null },
    ];
    const slot = nextSlot({ ...base, now, existing });
    // Today already has 2 (the limit) → first slot tomorrow.
    expect([slot.getMonth(), slot.getDate(), slot.getHours()]).toEqual([10, 1, 12]);
  });

  it("ignores other platforms and canceled publications", () => {
    const now = new Date(2026, 9, 31, 8, 0);
    const slot = nextSlot({
      ...base,
      now,
      existing: [
        { platform: "tiktok", status: "scheduled", scheduledAt: new Date(2026, 9, 31, 12).toISOString(), publishedAt: null },
        { platform: "youtube", status: "canceled", scheduledAt: new Date(2026, 9, 31, 12).toISOString(), publishedAt: null },
      ],
    });
    expect(slot.getHours()).toBe(12);
  });
});

const story: Story = {
  id: "st_1",
  source: "original",
  status: "produced",
  createdAt: "",
  title: "I refused to switch seats on a plane and now my family is mad",
  body: "…",
  comments: [],
  subreddit: "AmItheAsshole",
  author: "storyteller",
  url: null,
  score: 0,
  curation: null,
  fictional: true,
  jobId: "job",
  error: null,
};

describe("fallbackMetadata", () => {
  it("discloses fiction and adds #shorts on YouTube", () => {
    const meta = fallbackMetadata(story, "youtube");
    expect(meta.description).toContain("Fictional story.");
    expect(meta.description).toContain("#shorts");
  });

  it("credits the subreddit for Reddit posts and keeps TikTok captions short", () => {
    const meta = fallbackMetadata({ ...story, source: "reddit", fictional: false, title: "x".repeat(200) }, "tiktok");
    expect(meta.description).toContain("Story from r/AmItheAsshole.");
    expect(meta.title.length).toBeLessThanOrEqual(150);
  });

  it("adds no source credit to the user's own stories", () => {
    const meta = fallbackMetadata({ ...story, source: "manual", fictional: false }, "facebook");
    expect(meta.description).not.toMatch(/Story from|Fictional/);
  });
});
