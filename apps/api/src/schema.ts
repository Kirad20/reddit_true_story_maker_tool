import { z } from "zod";

export const backgroundChoice = z.discriminatedUnion("type", [
  z.object({ type: z.literal("procedural"), preset: z.enum(["sunset", "ocean", "neon"]) }),
  z.object({ type: z.literal("clip"), category: z.string().min(1), file: z.string().min(1).optional() }),
]);

export const captionStyle = z.enum(["pop", "karaoke", "boxed"]);

export const jobOptions = z.object({
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("url"), url: z.string().url() }),
    z.object({
      type: z.literal("text"),
      title: z.string().min(1).max(300),
      body: z.string().max(10000).default(""),
      subreddit: z.string().max(50).default("AskReddit"),
      author: z.string().max(50).default("anonymous"),
      comments: z
        .array(z.object({ author: z.string().max(50).default("anonymous"), body: z.string().min(1).max(2000) }))
        .max(10)
        .default([]),
      upvotes: z.number().int().min(0).default(0),
    }),
  ]),
  commentCount: z.number().int().min(0).max(10).default(3),
  scriptMode: z.enum(["literal", "claude"]).default("literal"),
  language: z.enum(["en", "es"]).default("en"),
  voice: z.string().min(1).optional(),
  speed: z.number().min(0.7).max(1.5).default(1.05),
  background: backgroundChoice.default({ type: "procedural", preset: "sunset" }),
  captionStyle: captionStyle.default("pop"),
  music: z.string().nullable().default(null),
  musicVolume: z.number().min(0).max(1).default(0.12),
  maxDurationSec: z.number().min(15).max(180).default(90),
  /** One part of a story split for TikTok/Facebook. */
  part: z
    .object({ index: z.number().int().min(1).max(3), total: z.number().int().min(2).max(3) })
    .refine((p) => p.index <= p.total, "part index exceeds total")
    .nullable()
    .default(null),
});

export type JobOptions = z.infer<typeof jobOptions>;

const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "use HH:MM");

export const settingsSchema = z.object({
  automation: z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().min(5).max(24 * 60),
    targetBacklog: z.number().int().min(1).max(20),
  }),
  sources: z.object({
    original: z.object({
      enabled: z.boolean(),
      perRun: z.number().int().min(1).max(10),
      genres: z.array(z.enum(["aita", "tifu", "revenge", "relationship", "workplace", "creepy", "wholesome"])).min(1),
    }),
    reddit: z.object({
      enabled: z.boolean(),
      subreddits: z.array(z.string().min(1).max(50)).max(20),
      timeframe: z.enum(["day", "week"]),
      minScore: z.number().int().min(0),
      perRun: z.number().int().min(1).max(20),
    }),
  }),
  curation: z.object({ autoApprove: z.boolean(), minScore: z.number().int().min(1).max(10) }),
  parts: z.object({
    enabled: z.boolean(),
    splitAboveSec: z.number().min(30).max(600),
    minPartSec: z.number().min(15).max(120),
    maxParts: z.union([z.literal(2), z.literal(3)]),
  }),
  video: z.object({
    language: z.enum(["en", "es"]),
    voice: z.string().nullable(),
    speed: z.number().min(0.7).max(1.5),
    captionStyle,
    background: z.union([
      z.object({ type: z.literal("procedural"), preset: z.enum(["sunset", "ocean", "neon"]) }),
      z.object({ type: z.literal("clip"), category: z.string().min(1) }),
    ]),
    music: z.string().nullable(),
    maxDurationSec: z.number().min(15).max(180),
    scriptMode: z.enum(["literal", "claude"]),
    commentCount: z.number().int().min(0).max(5),
  }),
  publish: z.object({
    requireReview: z.boolean(),
    slots: z.array(hhmm).min(1).max(12),
    dailyLimitPerPlatform: z.number().int().min(1).max(20),
    platforms: z.object({
      youtube: z.object({ enabled: z.boolean(), privacy: z.enum(["private", "unlisted", "public"]) }),
      tiktok: z.object({
        enabled: z.boolean(),
        privacy: z.enum(["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"]),
      }),
      facebook: z.object({ enabled: z.boolean() }),
    }),
  }),
});

export const manualStoryInput = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(10000).default(""),
  subreddit: z.string().max(50).optional(),
  comments: z.array(z.object({ author: z.string().max(50).default("anonymous"), body: z.string().min(1).max(2000) })).max(10).optional(),
});

export const publicationEdit = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
});

const effort = z.enum(["low", "medium", "high"]);

export const providersInput = z.object({
  providers: z
    .array(
      z.object({
        /** Missing or "" = a new provider (the server assigns its id). */
        id: z
          .string()
          .max(40)
          .optional()
          .transform((id) => id || undefined),
        name: z.string().min(1).max(60),
        kind: z.enum(["anthropic", "openai"]),
        baseUrl: z
          .string()
          .url()
          .max(300)
          .transform((u) => u.replace(/\/+$/, ""))
          .nullable(),
        /** undefined = keep the stored key, "" or null = remove it. */
        apiKey: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const agentsInput = z.object({
  agents: z.object({
    writer: z.object({ providerId: z.string(), model: z.string().min(1).max(120), effort }),
    curator: z.object({ providerId: z.string(), model: z.string().min(1).max(120), effort }),
    splitter: z.object({ providerId: z.string(), model: z.string().min(1).max(120), effort }),
    script: z.object({ providerId: z.string(), model: z.string().min(1).max(120), effort }),
    voice: z.object({ providerId: z.string(), model: z.string().min(1).max(120), effort }),
    metadata: z.object({ providerId: z.string(), model: z.string().min(1).max(120), effort }),
  }),
});

export const credentialsInput = z.record(z.string(), z.string().max(500).nullable());

/** Changes that only re-compose (no new voice): applied from the preview. */
export const compositionPatch = z.object({
  captionStyle: captionStyle.optional(),
  background: backgroundChoice.optional(),
  music: z.string().nullable().optional(),
  musicVolume: z.number().min(0).max(1).optional(),
});

export type CompositionPatch = z.infer<typeof compositionPatch>;

/** Settings that may change when a video is made again from scratch. */
export const redoInput = z
  .object({
    scriptMode: z.enum(["literal", "claude"]).optional(),
    language: z.enum(["en", "es"]).optional(),
    voice: z.string().min(1).optional(),
    speed: z.number().min(0.7).max(1.5).optional(),
    maxDurationSec: z.number().min(15).max(180).optional(),
    commentCount: z.number().int().min(0).max(10).optional(),
    captionStyle: captionStyle.optional(),
    background: backgroundChoice.optional(),
    music: z.string().nullable().optional(),
  })
  .default({});
