import type { CaptionStyle } from "@tsm/video";
import type { PartsConfig } from "./splitter";
import { Collection, Doc } from "./store";

export type StorySource = "original" | "reddit" | "manual";
export type StoryStatus = "candidate" | "approved" | "rejected" | "producing" | "produced" | "failed";

export type Story = {
  id: string;
  source: StorySource;
  status: StoryStatus;
  createdAt: string;
  title: string;
  body: string;
  comments: { author: string; body: string }[];
  subreddit: string;
  author: string;
  /** Original permalink for Reddit-sourced stories (attribution / dedupe). */
  url: string | null;
  score: number;
  /** Set by the curator agent. */
  curation: { score: number; reason: string; flags: string[] } | null;
  /** True for stories written by the AI (must be disclosed when published). */
  fictional: boolean;
  /** Full-length video (YouTube, and TikTok/Facebook when not split). */
  jobId: string | null;
  /** One video per part for TikTok/Facebook when the story is split. */
  partJobIds?: string[];
  split?: { parts: number; reason: string; by: string } | null;
  error: string | null;
};

export const storyJobIds = (s: Story): string[] => [s.jobId, ...(s.partJobIds ?? [])].filter((id): id is string => Boolean(id));

export type Platform = "youtube" | "tiktok" | "facebook";
export const PLATFORMS: Platform[] = ["youtube", "tiktok", "facebook"];

export type PublicationStatus = "needs_review" | "scheduled" | "publishing" | "published" | "failed" | "canceled";

export type Publication = {
  id: string;
  storyId: string | null;
  jobId: string;
  platform: Platform;
  status: PublicationStatus;
  createdAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  title: string;
  description: string;
  tags: string[];
  remoteId: string | null;
  url: string | null;
  error: string | null;
  attempts: number;
  /** Part number for split stories (TikTok/Facebook); parts publish strictly in order. */
  part?: { index: number; total: number } | null;
};

export type Genre = "aita" | "tifu" | "revenge" | "relationship" | "workplace" | "creepy" | "wholesome";
export const GENRES: Genre[] = ["aita", "tifu", "revenge", "relationship", "workplace", "creepy", "wholesome"];

export type Settings = {
  automation: {
    enabled: boolean;
    /** Minutes between orchestrator cycles. */
    intervalMinutes: number;
    /** Keep at least this many approved stories waiting to be produced. */
    targetBacklog: number;
  };
  sources: {
    original: { enabled: boolean; perRun: number; genres: Genre[] };
    reddit: { enabled: boolean; subreddits: string[]; timeframe: "day" | "week"; minScore: number; perRun: number };
  };
  curation: {
    /** Approve stories automatically when the curator scores them at or above minScore. */
    autoApprove: boolean;
    minScore: number;
  };
  /** Split long stories into 2-3 parts for TikTok and Facebook (YouTube always gets the full video). */
  parts: PartsConfig;
  video: {
    language: "en" | "es";
    voice: string | null;
    speed: number;
    captionStyle: CaptionStyle;
    background: { type: "procedural"; preset: "sunset" | "ocean" | "neon" } | { type: "clip"; category: string };
    music: string | null;
    maxDurationSec: number;
    scriptMode: "literal" | "claude";
    commentCount: number;
  };
  publish: {
    /** Publications wait in "needs_review" until a person approves them. */
    requireReview: boolean;
    /** Local times (HH:MM) at which scheduled publications go out. */
    slots: string[];
    dailyLimitPerPlatform: number;
    platforms: {
      youtube: { enabled: boolean; privacy: "private" | "unlisted" | "public" };
      tiktok: { enabled: boolean; privacy: "SELF_ONLY" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "PUBLIC_TO_EVERYONE" };
      facebook: { enabled: boolean };
    };
  };
};

export const DEFAULT_SETTINGS: Settings = {
  automation: { enabled: false, intervalMinutes: 60, targetBacklog: 3 },
  sources: {
    original: { enabled: true, perRun: 3, genres: ["aita", "tifu", "revenge", "workplace"] },
    reddit: { enabled: false, subreddits: ["AmItheAsshole", "tifu", "pettyrevenge"], timeframe: "day", minScore: 500, perRun: 5 },
  },
  curation: { autoApprove: false, minScore: 7 },
  parts: { enabled: true, splitAboveSec: 70, minPartSec: 30, maxParts: 3 },
  video: {
    language: "en",
    voice: null,
    speed: 1.05,
    captionStyle: "pop",
    background: { type: "procedural", preset: "sunset" },
    music: null,
    maxDurationSec: 75,
    scriptMode: "literal",
    commentCount: 2,
  },
  publish: {
    requireReview: true,
    slots: ["12:00", "18:00", "21:00"],
    dailyLimitPerPlatform: 3,
    platforms: {
      youtube: { enabled: false, privacy: "private" },
      tiktok: { enabled: false, privacy: "SELF_ONLY" },
      facebook: { enabled: false },
    },
  },
};

export const stories = new Collection<Story>("stories");
export const publications = new Collection<Publication>("publications");
export const settings = new Doc<Settings>("settings", DEFAULT_SETTINGS);

export async function loadDomain(): Promise<void> {
  await Promise.all([stories.load(), publications.load(), settings.load()]);
}
