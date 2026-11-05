import { describe, expect, it } from "vitest";
import { isDue, normalizePost, summarizeMetrics, type PostMetric } from "../src/studio/domain";

const metric = (over: Partial<PostMetric>): PostMetric => ({
  postId: "p",
  platform: "tiktok",
  title: "t",
  publishedAt: "2026-01-01T12:00:00.000Z",
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  saves: 0,
  clicks: 0,
  ...over,
});

describe("normalizePost", () => {
  it("cleans hashtags and trims text to the platform limit", () => {
    const post = normalizePost({ platform: "tiktok", text: "x".repeat(400), hashtags: ["#Foo", "foo", " bar ", ""] });
    expect(post.text.length).toBeLessThanOrEqual(150);
    expect(post.hashtags).toEqual(["foo", "bar"]);
  });

  it("keeps short text untouched", () => {
    expect(normalizePost({ platform: "youtube", text: "hola", hashtags: [] }).text).toBe("hola");
  });
});

describe("summarizeMetrics", () => {
  it("returns zeros for no data", () => {
    const s = summarizeMetrics([]);
    expect(s.totals.views).toBe(0);
    expect(s.topPosts).toEqual([]);
    expect(s.bestHours).toEqual([]);
  });

  it("aggregates totals, platforms, engagement and top posts", () => {
    const s = summarizeMetrics([
      metric({ postId: "a", platform: "tiktok", views: 1000, likes: 100 }),
      metric({ postId: "b", platform: "tiktok", views: 1000, likes: 300, comments: 100 }),
      metric({ postId: "c", platform: "youtube", views: 500, shares: 50 }),
    ]);
    expect(s.totals).toMatchObject({ views: 2500, likes: 400, comments: 100, shares: 50, posts: 3 });
    expect(s.byPlatform.tiktok?.engagementRate).toBeCloseTo(0.25);
    expect(s.byPlatform.youtube?.engagementRate).toBeCloseTo(0.1);
    expect(s.topPosts[0].postId).toBe("b");
    expect(s.topPosts).toHaveLength(3);
  });

  it("ranks the best posting hours by engagement rate", () => {
    const s = summarizeMetrics([
      metric({ publishedAt: "2026-01-01T09:00:00.000Z", views: 100, likes: 5 }),
      metric({ publishedAt: "2026-01-02T18:00:00.000Z", views: 100, likes: 40 }),
    ]);
    expect(s.bestHours[0]).toBe(new Date("2026-01-02T18:00:00.000Z").getHours());
  });
});

describe("isDue", () => {
  const now = new Date("2026-01-02T12:00:00.000Z");
  it("is due when never run", () => expect(isDue(null, 24, now)).toBe(true));
  it("is not due before the interval", () => expect(isDue("2026-01-02T00:00:00.000Z", 24, now)).toBe(false));
  it("is due after the interval", () => expect(isDue("2026-01-01T11:00:00.000Z", 24, now)).toBe(true));
});
