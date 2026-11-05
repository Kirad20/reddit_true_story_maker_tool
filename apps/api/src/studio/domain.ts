import type { Platform } from "../domain";

// Pure domain of the social studio: no IO, no framework.

export type Brand = { name: string; niche: string; voice: string; audience: string; language: "en" | "es" };

export type PostVariant = { platform: Platform; text: string; hashtags: string[] };
export type PostContent = { kind: "post"; variants: PostVariant[] };
export type AdVariant = { headline: string; primaryText: string; cta: string };
export type AdsContent = { kind: "ads"; objective: string; audience: string; variants: AdVariant[] };
export type SeoContent = { kind: "seo"; keywords: string[]; title: string; description: string; hashtags: string[] };
export type VideoContent = { kind: "video"; hook: string; script: string; shots: string[]; durationSec: number };
export type PlanItem = { day: number; platform: Platform; topic: string; format: string };
export type PlanContent = { kind: "plan"; items: PlanItem[] };
export type GeneratedContent = PostContent | AdsContent | SeoContent | VideoContent | PlanContent;
export type ContentKind = GeneratedContent["kind"];

export type DraftStatus = "draft" | "approved" | "archived";
export type Draft = {
  id: string;
  kind: ContentKind;
  topic: string;
  status: DraftStatus;
  createdAt: string;
  content: GeneratedContent;
};

export const POST_LIMIT: Record<Platform, number> = { tiktok: 150, youtube: 5000, facebook: 2200, instagram: 2200 };

export function normalizePost(v: PostVariant): PostVariant {
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const raw of v.hashtags) {
    const tag = raw.trim().replace(/^#+/, "").toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      hashtags.push(tag);
    }
  }
  const limit = POST_LIMIT[v.platform];
  const text = v.text.length > limit ? `${v.text.slice(0, limit - 1).trimEnd()}…` : v.text;
  return { platform: v.platform, text, hashtags };
}

// ---------------------------------------------------------------- analytics

export type PostMetric = {
  postId: string;
  platform: Platform;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
};

export type PlatformStats = { posts: number; views: number; likes: number; comments: number; shares: number; saves: number; clicks: number; engagementRate: number };
export type MetricsSummary = {
  totals: PlatformStats;
  byPlatform: Partial<Record<Platform, PlatformStats>>;
  topPosts: (PostMetric & { engagementRate: number })[];
  /** Local hours of day (0-23) ordered from best to worst engagement. */
  bestHours: number[];
};

const interactions = (m: PostMetric) => m.likes + m.comments + m.shares + m.saves;
const rate = (inter: number, views: number) => (views > 0 ? inter / views : 0);
const emptyStats = (): PlatformStats => ({ posts: 0, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, engagementRate: 0 });

function add(stats: PlatformStats, m: PostMetric) {
  stats.posts += 1;
  stats.views += m.views;
  stats.likes += m.likes;
  stats.comments += m.comments;
  stats.shares += m.shares;
  stats.saves += m.saves;
  stats.clicks += m.clicks;
}

const finish = (s: PlatformStats) => {
  s.engagementRate = rate(s.likes + s.comments + s.shares + s.saves, s.views);
  return s;
};

export function summarizeMetrics(metrics: PostMetric[], topN = 5): MetricsSummary {
  const totals = emptyStats();
  const byPlatform: Partial<Record<Platform, PlatformStats>> = {};
  const hours = new Map<number, { inter: number; views: number }>();
  for (const m of metrics) {
    add(totals, m);
    add((byPlatform[m.platform] ??= emptyStats()), m);
    const hour = new Date(m.publishedAt).getHours();
    const h = hours.get(hour) ?? { inter: 0, views: 0 };
    h.inter += interactions(m);
    h.views += m.views;
    hours.set(hour, h);
  }
  Object.values(byPlatform).forEach(finish);
  const topPosts = metrics
    .map((m) => ({ ...m, engagementRate: rate(interactions(m), m.views) }))
    .sort((a, b) => interactions(b) - interactions(a))
    .slice(0, topN);
  const bestHours = [...hours.entries()].sort((a, b) => rate(b[1].inter, b[1].views) - rate(a[1].inter, a[1].views)).map(([h]) => h);
  return { totals: finish(totals), byPlatform, topPosts, bestHours };
}

// ---------------------------------------------------------------- automation

export function isDue(lastRun: string | null, intervalHours: number, now: Date): boolean {
  if (!lastRun) return true;
  return now.getTime() - new Date(lastRun).getTime() >= intervalHours * 3_600_000;
}
