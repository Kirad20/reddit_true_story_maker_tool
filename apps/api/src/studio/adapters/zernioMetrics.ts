import { PLATFORMS, type Platform } from "../../domain";
import { zernio, zernioConfigured } from "../../zernio";
import type { PostMetric } from "../domain";
import type { MetricsProvider } from "../ports";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Maps Zernio's analytics payload to the studio's metrics; tolerant of missing fields. */
export function mapAnalytics(data: unknown): PostMetric[] {
  const posts = (data as { posts?: any[] } | undefined)?.posts;
  if (!Array.isArray(posts)) return [];
  const out: PostMetric[] = [];
  for (const p of posts) {
    if (!(PLATFORMS as string[]).includes(p?.platform)) continue;
    const a = p.analytics ?? {};
    out.push({
      postId: String(p._id ?? p.latePostId ?? ""),
      platform: p.platform as Platform,
      title: String(p.content ?? "").slice(0, 120),
      publishedAt: String(p.publishedAt ?? p.scheduledFor ?? new Date(0).toISOString()),
      views: num(a.views) || num(a.impressions),
      likes: num(a.likes),
      comments: num(a.comments),
      shares: num(a.shares),
      saves: num(a.saves),
      clicks: num(a.clicks),
    });
  }
  return out;
}

export class ZernioMetrics implements MetricsProvider {
  async fetch(): Promise<PostMetric[]> {
    const result = await zernio().analytics.getAnalytics({ query: { limit: 100, sortBy: "date", order: "desc" } } as never);
    if (result.error || !result.data) throw new Error("Zernio analytics unavailable");
    return mapAnalytics(result.data);
  }
}

export const zernioMetricsOrNull = () => (zernioConfigured() ? new ZernioMetrics() : null);
