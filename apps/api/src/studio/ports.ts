import type { Platform } from "../domain";
import type { AdsContent, Brand, Draft, ImageAspect, MetricsSummary, PlanContent, PostContent, PostFormat, PostMetric, SeoContent, VideoContent } from "./domain";

// Outbound ports: what the application needs from the outside world.

export type GenRequest = { topic: string; brand: Brand };

export interface ContentGenerator {
  post(req: GenRequest & { platforms: Platform[]; formats?: Partial<Record<Platform, PostFormat>> }): Promise<PostContent>;
  ads(req: GenRequest): Promise<AdsContent>;
  seo(req: GenRequest): Promise<SeoContent>;
  video(req: GenRequest): Promise<VideoContent>;
  plan(req: GenRequest & { platforms: Platform[]; days: number }): Promise<PlanContent>;
  insights(req: { brand: Brand; summary: MetricsSummary }): Promise<string[]>;
}

export interface DraftRepository {
  save(draft: Draft): Promise<Draft>;
  list(): Promise<Draft[]>;
  get(id: string): Promise<Draft | null>;
  remove(id: string): Promise<void>;
}

/** Real metrics from the social networks. */
export interface MetricsProvider {
  fetch(): Promise<PostMetric[]>;
}

/** Posts content to a connected social account; `media` is an image url under /media/studio, or null for text only. */
export interface SocialPublisher {
  publishPost(platform: Platform, text: string, media: string | null): Promise<{ url: string | null }>;
}

/** Text-to-image model. */
export interface ImageGenerator {
  generate(prompt: string, aspect: ImageAspect): Promise<Buffer>;
}

export interface ImageStore {
  save(png: Buffer): Promise<{ url: string; filePath: string }>;
}

/** Publications made through this app, used when remote metrics are unavailable. */
export interface LocalPublicationReader {
  published(): { postId: string; platform: Platform; title: string; publishedAt: string }[];
}
