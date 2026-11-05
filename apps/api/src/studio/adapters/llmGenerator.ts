import { PLATFORMS, type Platform } from "../../domain";
import type { structured as structuredFn } from "../../llm";
import type { AdsContent, Brand, PlanContent, PostContent, SeoContent, VideoContent } from "../domain";
import type { ContentGenerator, GenRequest } from "../ports";

type Structured = typeof structuredFn;

const str = { type: "string" };
const strs = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const platformEnum = { type: "string", enum: PLATFORMS };

const SCHEMAS = {
  post: obj({
    variants: {
      type: "array",
      items: obj({ platform: platformEnum, format: str, text: str, hashtags: strs, slides: strs, imagePrompt: str }),
    },
  }),
  ads: obj({ objective: str, audience: str, variants: { type: "array", items: obj({ headline: str, primaryText: str, cta: str }) } }),
  seo: obj({ keywords: strs, title: str, description: str, hashtags: strs }),
  video: obj({ hook: str, script: str, shots: strs, durationSec: { type: "integer" } }),
  plan: obj({ items: { type: "array", items: obj({ day: { type: "integer" }, platform: platformEnum, topic: str, format: str }) } }),
  insights: obj({ insights: strs }),
};

const systemFor = (brand: Brand, role: string) =>
  [
    `You are the ${role} of a social media studio for the brand "${brand.name}".`,
    brand.niche && `Niche: ${brand.niche}.`,
    brand.voice && `Brand voice: ${brand.voice}.`,
    brand.audience && `Target audience: ${brand.audience}.`,
    `Write in ${brand.language === "es" ? "natural neutral Latin American Spanish" : "English"}.`,
    "Be honest: no false claims, no fake testimonials, no guarantees of results, nothing misleading. Content must follow each platform's advertising and community policies.",
  ]
    .filter(Boolean)
    .join("\n");

const PLATFORM_HINT: Record<Platform, string> = {
  tiktok: "TikTok: caption max 150 characters including 3-5 hashtags, hook first",
  instagram: "Instagram: caption up to 2200 characters, hook in the first line, 5-8 hashtags",
  youtube: "YouTube Shorts: title-like first line, description with keywords, #shorts",
  facebook: "Facebook: conversational, 1-3 short paragraphs, a question to invite comments, 3-5 hashtags",
};

const FORMAT_HINT: Record<string, string> = {
  text: "text-only post",
  image: "single image post: text is the caption, imagePrompt describes the picture",
  carousel: "carousel: slides holds 3-8 short slide texts, text is the caption, imagePrompt describes the visual style of the slides",
  story: "story: very short punchy text, imagePrompt describes a vertical background image",
  reel: "reel: caption for a short vertical video",
  short: "short vertical video: caption/description",
  poll: "poll: text holds the question, slides holds 2-4 answer options",
  community: "community post: text-only update with an optional imagePrompt",
};

export class LlmContentGenerator implements ContentGenerator {
  constructor(private structured: Structured) {}

  async post({ topic, brand, platforms, formats }: GenRequest & { platforms: Platform[]; formats?: Partial<Record<Platform, string>> }): Promise<PostContent> {
    const lines = platforms.map((p) => {
      const f = formats?.[p];
      return `- ${p}: ${PLATFORM_HINT[p]}${f ? `; format "${f}" (${FORMAT_HINT[f] ?? f})` : ""}`;
    });
    const r = await this.structured<{ variants: PostContent["variants"] }>({
      agent: "studio",
      system: systemFor(brand, "social media copywriter"),
      prompt: `Write one post per platform about: ${topic}\n\nPlatforms:\n${lines.join("\n")}\n\nSet format to the requested one (or the best fit). Leave slides empty unless the format needs them and imagePrompt empty if no image is needed. imagePrompt must be an English visual description with no text or logos in the picture. Hashtags go in the hashtags field without '#', not inside text.`,
      schema: SCHEMAS.post,
    });
    return { kind: "post", variants: r.variants.filter((v) => platforms.includes(v.platform)) };
  }

  async ads({ topic, brand }: GenRequest): Promise<AdsContent> {
    const r = await this.structured<Omit<AdsContent, "kind">>({
      agent: "studio",
      system: systemFor(brand, "performance marketing specialist"),
      prompt: `Create a paid social ad campaign for: ${topic}\nGive the objective, a precise audience targeting description (interests, age range, location ideas) and 4 ad variants. Headlines max 40 characters, primary text max 125 characters, a clear CTA.`,
      schema: SCHEMAS.ads,
    });
    return { kind: "ads", ...r };
  }

  async seo({ topic, brand }: GenRequest): Promise<SeoContent> {
    const r = await this.structured<Omit<SeoContent, "kind">>({
      agent: "studio",
      system: systemFor(brand, "SEO specialist"),
      prompt: `Build an SEO pack for content about: ${topic}\n8-12 keywords mixing short and long-tail, a title max 60 characters, a meta description max 155 characters and 5-8 hashtags without '#'.`,
      schema: SCHEMAS.seo,
    });
    return { kind: "seo", ...r };
  }

  async video({ topic, brand }: GenRequest): Promise<VideoContent> {
    const r = await this.structured<Omit<VideoContent, "kind">>({
      agent: "studio",
      system: systemFor(brand, "short-form video director"),
      prompt: `Write a vertical short video concept about: ${topic}\nA hook for the first 2 seconds, a narration script meant to be read aloud (no emojis, no stage directions), a list of visual shots, and the duration in seconds (20-60).`,
      schema: SCHEMAS.video,
    });
    return { kind: "video", ...r };
  }

  async plan({ topic, brand, platforms, days }: GenRequest & { platforms: Platform[]; days: number }): Promise<PlanContent> {
    const r = await this.structured<{ items: PlanContent["items"] }>({
      agent: "studio",
      system: systemFor(brand, "content strategist"),
      prompt: `Plan a ${days}-day content calendar around: ${topic}\nPlatforms: ${platforms.join(", ")}. One item per day (day 1..${days}), varied formats (video, post, carousel, story), each with a concrete topic.`,
      schema: SCHEMAS.plan,
    });
    return { kind: "plan", items: r.items.filter((i) => (PLATFORMS as string[]).includes(i.platform)) };
  }

  async insights({ brand, summary }: { brand: Brand; summary: unknown }): Promise<string[]> {
    const r = await this.structured<{ insights: string[] }>({
      agent: "studio",
      system: systemFor(brand, "social media analyst"),
      prompt: `Analyze these performance metrics and give 3-5 concrete, actionable recommendations (what to repeat, what to change, best times):\n${JSON.stringify(summary)}`,
      schema: SCHEMAS.insights,
    });
    return r.insights;
  }
}
