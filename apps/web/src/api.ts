import { useEffect, useState } from "react";
import type { CaptionStyle, VideoComposition } from "@tsm/video";
import { UNAUTHORIZED_EVENT } from "./auth";

export type BackgroundChoice =
  | { type: "procedural"; preset: "sunset" | "ocean" | "neon" }
  | { type: "clip"; category: string; file?: string };

export type JobOptions = {
  source: { type: "url"; url: string } | { type: "text"; title: string; body: string; subreddit: string; author: string };
  commentCount: number;
  scriptMode: "literal" | "claude";
  language: "en" | "es";
  voice?: string;
  speed: number;
  background: BackgroundChoice;
  captionStyle: CaptionStyle;
  music: string | null;
  musicVolume: number;
  maxDurationSec: number;
  part?: { index: number; total: number } | null;
};

export type JobStatus = "queued" | "fetching" | "scripting" | "tts" | "composing" | "ready" | "rendering" | "done" | "failed";

export type Job = {
  id: string;
  createdAt: string;
  options: JobOptions;
  status: JobStatus;
  progress: number;
  error: string | null;
  warnings: string[];
  post: { title: string; subreddit: string; author: string; score: number; numComments: number } | null;
  blocks: { kind: string; text: string; author?: string }[] | null;
  composition: VideoComposition | null;
  output: string | null;
  voiceChoice?: { voice: string; reason: string; by: "agent" | "heuristic" | "default" } | null;
  revision?: number;
};

/** Settings that can change when a video is made again from scratch. */
export type RedoOptions = Partial<
  Pick<JobOptions, "scriptMode" | "language" | "voice" | "speed" | "maxDurationSec" | "commentCount" | "captionStyle" | "background" | "music">
>;

/** Voice option value: the voice director picks one per story. */
export const AUTO_VOICE = "auto";

export type Options = {
  backgrounds: { name: string; clips: string[] }[];
  procedural: ("sunset" | "ocean" | "neon")[];
  music: string[];
  voices: string[];
  ttsError: string | null;
  defaultVoices: Record<"en" | "es", string>;
  captionStyles: CaptionStyle[];
  claude: boolean;
  /** Model label of the voice director, null when it has none (heuristic pick). */
  voiceAgent: string | null;
  reddit: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data as T;
}

export const api = {
  options: () => request<Options>("/api/options"),
  jobs: () => request<Job[]>("/api/jobs"),
  create: (options: JobOptions) => request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(options) }),
  patch: (id: string, patch: Partial<Pick<JobOptions, "captionStyle" | "background" | "music" | "musicVolume">>) =>
    request<Job>(`/api/jobs/${id}/composition`, { method: "PATCH", body: JSON.stringify(patch) }),
  render: (id: string) => request<Job>(`/api/jobs/${id}/render`, { method: "POST" }),
  retry: (id: string) => request<Job>(`/api/jobs/${id}/retry`, { method: "POST" }),
  redo: (id: string, options: RedoOptions = {}) => request<Job>(`/api/jobs/${id}/redo`, { method: "POST", body: JSON.stringify(options) }),
  trace: (id: string) => request<JobTrace>(`/api/jobs/${id}/trace`),
  remove: (id: string) => request<void>(`/api/jobs/${id}`, { method: "DELETE" }),
  voicePreview: async (voice: string, lang: string, speed: number) => {
    const res = await fetch("/api/voices/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice, lang, speed }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Preview failed");
    return URL.createObjectURL(await res.blob());
  },
};

// ---------------------------------------------------------------- pipeline

export type Platform = "youtube" | "tiktok" | "facebook";
export const PLATFORMS: Platform[] = ["youtube", "tiktok", "facebook"];
export const PLATFORM_LABEL: Record<Platform, string> = { youtube: "YouTube", tiktok: "TikTok", facebook: "Facebook" };

export type Story = {
  id: string;
  source: "original" | "reddit" | "manual";
  status: "candidate" | "approved" | "rejected" | "producing" | "produced" | "failed";
  createdAt: string;
  title: string;
  body: string;
  comments: { author: string; body: string }[];
  subreddit: string;
  url: string | null;
  score: number;
  curation: { score: number; reason: string; flags: string[] } | null;
  fictional: boolean;
  jobId: string | null;
  partJobIds?: string[];
  split?: { parts: number; reason: string; by: string } | null;
  error: string | null;
};

export type Publication = {
  id: string;
  storyId: string | null;
  jobId: string;
  platform: Platform;
  status: "needs_review" | "scheduled" | "publishing" | "published" | "failed" | "canceled";
  createdAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  title: string;
  description: string;
  tags: string[];
  url: string | null;
  error: string | null;
  attempts: number;
  part?: { index: number; total: number } | null;
};

export type Genre = "aita" | "tifu" | "revenge" | "relationship" | "workplace" | "creepy" | "wholesome";

export type Settings = {
  automation: { enabled: boolean; intervalMinutes: number; targetBacklog: number };
  sources: {
    original: { enabled: boolean; perRun: number; genres: Genre[] };
    reddit: { enabled: boolean; subreddits: string[]; timeframe: "day" | "week"; minScore: number; perRun: number };
  };
  curation: { autoApprove: boolean; minScore: number };
  parts: { enabled: boolean; splitAboveSec: number; minPartSec: number; maxParts: 2 | 3 };
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
    requireReview: boolean;
    slots: string[];
    dailyLimitPerPlatform: number;
    platforms: {
      youtube: { enabled: boolean; privacy: "private" | "unlisted" | "public" };
      tiktok: { enabled: boolean; privacy: "SELF_ONLY" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "PUBLIC_TO_EVERYONE" };
      facebook: { enabled: boolean };
    };
  };
};

export type AccountStatus = {
  platform: Platform;
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  /** App user who connected it. */
  linkedBy: string | null;
  note: string | null;
  /** Better Auth social provider used to connect it. */
  provider: "google" | "tiktok" | "facebook";
  /** Redirect URI to register in the platform's developer app. */
  redirectUri: string;
};

export type Pipeline = {
  status: { lastCycle: string | null; cycling: boolean; publishing: boolean; enabled: boolean };
  settings: Settings;
  accounts: AccountStatus[];
  capabilities: { claude: boolean; reddit: boolean; model: string | null; agents: Record<string, string | null> };
  activity: { at: string; level: "info" | "warn" | "error"; message: string }[];
};

type PubEdit = Partial<Pick<Publication, "title" | "description" | "tags">>;

export type ProviderKind = "anthropic" | "openai";
export type ModelProvider = { id: string; name: string; kind: ProviderKind; baseUrl: string | null };
export type AgentId = "writer" | "curator" | "splitter" | "script" | "voice" | "metadata";
export type Effort = "low" | "medium" | "high";
export type AgentModel = { providerId: string; model: string; effort: Effort };
export type AIConfigView = {
  providers: (ModelProvider & { keyMask: string })[];
  agents: Record<AgentId, AgentModel>;
  agentMeta: { id: AgentId; label: string; description: string }[];
  agentStatus: Record<AgentId, string | null>;
  credentials: { name: string; group: "reddit" | "youtube" | "tiktok" | "facebook"; label: string; mask: string }[];
};
/** apiKey: undefined keeps the stored key, "" removes it. */
export type ProviderInput = ModelProvider & { apiKey?: string | null };

export const configApi = {
  get: () => request<AIConfigView>("/api/config"),
  saveProviders: (providers: ProviderInput[]) => request<AIConfigView>("/api/config/providers", { method: "PUT", body: JSON.stringify({ providers }) }),
  saveAgents: (agents: Record<AgentId, AgentModel>) => request<AIConfigView>("/api/config/agents", { method: "PUT", body: JSON.stringify({ agents }) }),
  saveCredentials: (values: Record<string, string | null>) =>
    request<AIConfigView>("/api/config/credentials", { method: "PUT", body: JSON.stringify(values) }),
  testProvider: (id: string) => request<{ ok: boolean; models: string[] }>(`/api/config/providers/${id}/test`, { method: "POST" }),
};

export const pipelineApi = {
  get: () => request<Pipeline>("/api/pipeline"),
  saveSettings: (s: Settings) => request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) }),
  run: () => request<void>("/api/pipeline/run", { method: "POST" }),
  stories: () => request<Story[]>("/api/stories"),
  discover: () => request<{ added: number; errors: string[] }>("/api/stories/discover", { method: "POST" }),
  addStory: (s: { title: string; body: string; subreddit?: string; comments?: { author: string; body: string }[] }) =>
    request<Story>("/api/stories", { method: "POST", body: JSON.stringify(s) }),
  approve: (id: string) => request<Story>(`/api/stories/${id}/approve`, { method: "POST" }),
  reject: (id: string) => request<Story>(`/api/stories/${id}/reject`, { method: "POST" }),
  produce: (id: string) => request<Story>(`/api/stories/${id}/produce`, { method: "POST" }),
  redoStory: (id: string) => request<Story>(`/api/stories/${id}/redo`, { method: "POST" }),
  removeStory: (id: string) => request<void>(`/api/stories/${id}`, { method: "DELETE" }),
  publications: () => request<Publication[]>("/api/publications"),
  publishJob: (jobId: string, platforms?: Platform[]) =>
    request<Publication[]>(`/api/jobs/${jobId}/publish`, { method: "POST", body: JSON.stringify({ platforms }) }),
  editPublication: (id: string, edit: PubEdit) => request<Publication>(`/api/publications/${id}`, { method: "PATCH", body: JSON.stringify(edit) }),
  approvePublication: (id: string, edit?: PubEdit) =>
    request<Publication>(`/api/publications/${id}/approve`, { method: "POST", body: JSON.stringify(edit ?? {}) }),
  publishNow: (id: string) => request<Publication>(`/api/publications/${id}/publish-now`, { method: "POST" }),
  cancelPublication: (id: string) => request<Publication>(`/api/publications/${id}/cancel`, { method: "POST" }),
  disconnect: (p: Platform) => request<AccountStatus[]>(`/api/auth/${p}/disconnect`, { method: "POST" }),
  facebookPages: () => request<{ pages: { id: string; name: string }[]; pageId: string | null }>("/api/auth/facebook/pages"),
  selectFacebookPage: (pageId: string) => request<AccountStatus[]>("/api/auth/facebook/page", { method: "POST", body: JSON.stringify({ pageId }) }),
};

/** Pipeline snapshot + stories + publications, refreshed on server events. */
export function usePipelineData() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([pipelineApi.get(), pipelineApi.stories(), pipelineApi.publications()])
      .then(([p, s, pu]) => {
        if (cancelled) return;
        setPipeline(p);
        setStories(s);
        setPubs(pu);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const source = new EventSource("/api/pipeline/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.onmessage = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setTick((t) => t + 1);
      }, 800);
    };
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { pipeline, stories, pubs, refresh: () => setTick((t) => t + 1) };
}

/** Live job state over Server-Sent Events. */
export function useJob(id: string | null, initial: Job | null): Job | null {
  const [job, setJob] = useState<Job | null>(initial);
  useEffect(() => {
    setJob(initial);
    if (!id) return;
    const source = new EventSource(`/api/jobs/${id}/events`);
    source.onmessage = (event) => setJob(JSON.parse(event.data));
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return job;
}

// ---------------------------------------------------------------- observability

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number };
export type TraceContext = { jobId?: string; storyId?: string; trigger?: string };

export type LlmCallSummary = {
  id: string;
  at: string;
  agent: string;
  provider: string;
  providerKind: ProviderKind;
  model: string;
  servedModel: string | null;
  effort: string;
  mode: string;
  durationMs: number;
  ok: boolean;
  error: string | null;
  stopReason: string | null;
  usage: TokenUsage;
  costUsd: number | null;
  context: TraceContext;
};
export type LlmCall = LlmCallSummary & { system: string; prompt: string; response: string | null };

export type StepSpan = {
  id: string;
  at: string;
  jobId: string;
  step: string;
  durationMs: number;
  ok: boolean;
  error: string | null;
  detail: string | null;
  context: TraceContext;
};

export type AuditEntry = { id: string; at: string; user: string | null; action: string; target: string | null; status: number; durationMs: number };

export type Bucket = { calls: number; errors: number; usage: TokenUsage; costUsd: number; unpriced: number; durationMs: number };

export type FlowStage = { id: string; label: string; agent: string | null; step: string | null; where: string; description: string };

export type Observability = {
  range: string;
  total: Bucket;
  byAgent: Record<string, Bucket>;
  byModel: Record<string, Bucket>;
  byDay: (Bucket & { day: string })[];
  steps: Record<string, { runs: number; failures: number; totalMs: number; maxMs: number }>;
  perJob: Record<string, { calls: number; costUsd: number; tokens: number }>;
  recentCalls: LlmCallSummary[];
  recentSteps: StepSpan[];
  audit: AuditEntry[];
  agents: { id: AgentId; label: string; description: string; model: string | null }[];
  flow: { pipeline: FlowStage[]; video: FlowStage[]; publishing: FlowStage[] };
  queue: { id: string; status: JobStatus; progress: number; title: string | null }[];
  pipeline: Pipeline["status"];
};

export type JobTrace = { steps: StepSpan[]; calls: LlmCallSummary[] };

export const observabilityApi = {
  get: (range: string) => request<Observability>(`/api/observability?range=${encodeURIComponent(range)}`),
  call: (id: string) => request<LlmCall>(`/api/observability/calls/${id}`),
};
