import path from "node:path";
import { curateStories, fallbackMetadata, writeMetadata } from "./agents";
import { agentReady } from "./aiconfig";
import { DEFAULT_VOICES, JOBS_DIR } from "./config";
import {
  PLATFORMS,
  publications,
  settings,
  stories,
  storyJobIds,
  type Platform,
  type Publication,
  type Story,
} from "./domain";
import { createJob, getJob, jobEvents, startRender, type Job } from "./jobs";
import { publishers } from "./publish";
import { PublishError } from "./publish/types";
import { nextSlot } from "./schedule";
import { partLabel } from "./script";
import { discoverOriginal, discoverReddit } from "./sources";
import { planSplit } from "./splitter";
import { Doc, newId } from "./store";

// ---------------------------------------------------------------- activity log

type Activity = { at: string; level: "info" | "warn" | "error"; message: string };
const activity = new Doc<{ entries: Activity[] }>("activity", { entries: [] });

export async function log(level: Activity["level"], message: string): Promise<void> {
  console.log(`[pipeline] ${level}: ${message}`);
  const entries = [{ at: new Date().toISOString(), level, message }, ...activity.get().entries].slice(0, 300);
  await activity.set({ entries });
  jobEvents.emit("pipeline", { type: "activity" });
}

export const activityLog = () => activity.get().entries;

// ---------------------------------------------------------------- discovery + curation

const BLOCKING_FLAGS = new Set(["pii", "sensitive", "hateful", "low_quality"]);

export async function discover(): Promise<{ added: number; errors: string[] }> {
  const cfg = settings.get();
  const existing = stories.all();
  const found: Story[] = [];
  const errors: string[] = [];

  if (cfg.sources.original.enabled) {
    if (!agentReady("writer")) errors.push("Original stories need a model for the Writer agent (Settings → Modelos)");
    else {
      try {
        found.push(...(await discoverOriginal(cfg, existing)));
      } catch (error) {
        errors.push(`Original stories: ${(error as Error).message}`);
      }
    }
  }
  if (cfg.sources.reddit.enabled) {
    const result = await discoverReddit(cfg, existing);
    found.push(...result.stories);
    errors.push(...result.errors);
  }

  for (const story of found) await stories.put(story);
  if (found.length) await curate(found.map((s) => s.id));
  for (const e of errors) await log("warn", e);
  await log("info", `Discovery added ${found.length} stor${found.length === 1 ? "y" : "ies"}`);
  return { added: found.length, errors };
}

export async function curate(ids: string[]): Promise<void> {
  const cfg = settings.get();
  const list = ids.map((id) => stories.get(id)).filter((s): s is Story => Boolean(s));
  if (list.length === 0) return;
  if (!agentReady("curator")) {
    await log("warn", "Curation skipped (no model for the Curator agent): stories stay as candidates for manual review");
    return;
  }
  try {
    const results = await curateStories(list);
    for (const r of results) {
      const story = stories.get(r.id);
      if (!story) continue;
      const blocked = r.flags.some((f) => BLOCKING_FLAGS.has(f));
      const approve = cfg.curation.autoApprove && !blocked && r.score >= cfg.curation.minScore && story.status === "candidate";
      await stories.update(story.id, {
        curation: { score: r.score, reason: r.reason, flags: r.flags },
        status: approve ? "approved" : story.status,
      });
    }
  } catch (error) {
    await log("error", `Curation failed: ${(error as Error).message}`);
  }
}

// ---------------------------------------------------------------- production

/** Longest narration a single video may have (YouTube Shorts allows up to 3 minutes). */
const MAX_VIDEO_SEC = 180;

async function createStoryJob(story: Story, body: string, comments: Story["comments"], part: { index: number; total: number } | null) {
  const v = settings.get().video;
  return createJob({
    source: {
      type: "text",
      title: story.title,
      body,
      subreddit: story.subreddit,
      author: story.author,
      comments,
      upvotes: story.score,
    },
    commentCount: comments.length,
    scriptMode: v.scriptMode,
    language: v.language,
    voice: v.voice ?? DEFAULT_VOICES[v.language],
    speed: v.speed,
    background: v.background,
    captionStyle: v.captionStyle,
    music: v.music,
    musicVolume: 0.12,
    maxDurationSec: MAX_VIDEO_SEC,
    part,
  });
}

/**
 * One full video (YouTube, and TikTok/Facebook when not split) plus, when the
 * split planner finds good cut points, one video per part for TikTok/Facebook.
 */
export async function produceStory(storyId: string): Promise<Story> {
  const story = stories.get(storyId);
  if (!story) throw new Error("Story not found");
  if (story.jobId && ["producing", "produced"].includes(story.status)) throw new Error("This story already has a video");
  const cfg = settings.get();
  const comments = story.comments.slice(0, cfg.video.commentCount);

  const plan = await planSplit(story.title, story.body, cfg.parts);
  const full = await createStoryJob(story, story.body, comments, null);
  const partJobs: Job[] = [];
  if (plan.parts.length > 1) {
    for (let i = 0; i < plan.parts.length; i++) {
      const last = i === plan.parts.length - 1;
      // Reader comments only make sense after the story ends.
      partJobs.push(await createStoryJob(story, plan.parts[i], last ? comments : [], { index: i + 1, total: plan.parts.length }));
    }
  }
  await log(
    "info",
    `Producing "${story.title}": full video${partJobs.length ? ` + ${partJobs.length} parts for TikTok/Facebook` : ""} (${plan.reason})`,
  );
  return stories.update(story.id, {
    status: "producing",
    jobId: full.id,
    partJobIds: partJobs.map((j) => j.id),
    split: { parts: plan.parts.length, reason: plan.reason, by: plan.by },
    error: null,
  });
}

/** Follow pipeline jobs: render when the preview is ready, then queue publications. */
async function onJobUpdate(job: Pick<Job, "id" | "status" | "error">): Promise<void> {
  const story = stories.find((s) => storyJobIds(s).includes(job.id));
  if (!story || story.status !== "producing") return;
  if (job.status === "ready") {
    const full = getJob(job.id);
    if (full && !full.output) await startRender(full);
  } else if (job.status === "failed") {
    await stories.update(story.id, { status: "failed", error: job.error });
    await log("error", `Video failed for "${story.title}": ${job.error}`);
  } else if (job.status === "done") {
    const allDone = storyJobIds(story).every((id) => getJob(id)?.status === "done");
    if (!allDone) return;
    await stories.update(story.id, { status: "produced" });
    await log("info", `Videos ready for "${story.title}"`);
    await queueStoryPublications(stories.get(story.id)!);
  }
}

// ---------------------------------------------------------------- publications

function storyFromJob(job: Job): Story {
  return {
    id: `job:${job.id}`,
    source: "manual",
    status: "produced",
    createdAt: job.createdAt,
    title: job.cardTitle ?? job.blocks?.[0]?.text ?? job.post?.title ?? "Story",
    body: job.blocks?.slice(1).map((b) => b.text).join("\n\n") ?? job.post?.body ?? "",
    comments: [],
    subreddit: job.post?.subreddit ?? "stories",
    author: job.post?.author ?? "anonymous",
    url: job.post?.permalink || null,
    score: job.post?.score ?? 0,
    curation: null,
    fictional: false,
    jobId: job.id,
    error: null,
  };
}

export function enabledPlatforms(): Platform[] {
  const cfg = settings.get().publish.platforms;
  return PLATFORMS.filter((p) => cfg[p].enabled && publishers[p].status().connected);
}

/** Which video(s) each platform gets: YouTube always the full one; TikTok/Facebook the parts if any. */
export function videosFor(platform: Platform, story: Pick<Story, "jobId" | "partJobIds">) {
  const parts = story.partJobIds ?? [];
  if (platform === "youtube" || parts.length === 0) return story.jobId ? [{ jobId: story.jobId, part: null }] : [];
  return parts.map((jobId, i) => ({ jobId, part: { index: i + 1, total: parts.length } }));
}

export function partTitle(title: string, part: { index: number; total: number } | null, language: "en" | "es", maxLength: number): string {
  if (!part) return title.slice(0, maxLength);
  const label = partLabel(part, language);
  return `${label} · ${title}`.slice(0, maxLength);
}

async function metadataFor(story: Story, platform: Platform) {
  let meta = fallbackMetadata(story, platform);
  if (agentReady("metadata")) {
    try {
      meta = await writeMetadata(story, platform, settings.get().video.language);
    } catch (error) {
      await log("warn", `Metadata for ${platform} fell back to defaults: ${(error as Error).message}`);
    }
  }
  return meta;
}

async function createPublication(input: {
  story: Story;
  storyId: string | null;
  platform: Platform;
  jobId: string;
  part: { index: number; total: number } | null;
  meta: { title: string; description: string; tags: string[] };
}): Promise<Publication | null> {
  if (publications.find((p) => p.jobId === input.jobId && p.platform === input.platform && p.status !== "canceled")) return null;
  const cfg = settings.get();
  const review = cfg.publish.requireReview;
  const previous = input.part && input.part.index > 1 ? previousPart({ ...input, storyId: input.storyId }) : undefined;
  const publication: Publication = {
    id: newId("pub"),
    storyId: input.storyId,
    jobId: input.jobId,
    platform: input.platform,
    status: review ? "needs_review" : "scheduled",
    createdAt: new Date().toISOString(),
    scheduledAt: review ? null : schedule(input.platform, previous?.scheduledAt).toISOString(),
    publishedAt: null,
    title: partTitle(input.meta.title, input.part, cfg.video.language, input.platform === "tiktok" ? 150 : 100),
    description: input.meta.description,
    tags: input.meta.tags,
    remoteId: null,
    url: null,
    error: null,
    attempts: 0,
    part: input.part,
  };
  return publications.put(publication);
}

export async function queueStoryPublications(story: Story, platforms?: Platform[]): Promise<Publication[]> {
  const targets = platforms ?? enabledPlatforms();
  if (targets.length === 0) {
    await log("warn", `No connected platform enabled: "${story.title}" was not queued for publishing`);
    return [];
  }
  const created: Publication[] = [];
  for (const platform of targets) {
    const meta = await metadataFor(story, platform);
    for (const video of videosFor(platform, story)) {
      const pub = await createPublication({ story, storyId: story.id, platform, jobId: video.jobId, part: video.part, meta });
      if (pub) created.push(pub);
    }
  }
  const review = settings.get().publish.requireReview;
  await log("info", `Queued ${created.length} publication(s) for "${story.title}"${review ? " (waiting for review)" : ""}`);
  return created;
}

/** Publish a single, manually created video (not part of a story). */
export async function queuePublications(jobId: string, story?: Story, platforms?: Platform[]): Promise<Publication[]> {
  if (story) return queueStoryPublications(story, platforms);
  const job = getJob(jobId);
  if (!job?.output) throw new Error("The video has not been rendered yet");
  const source = storyFromJob(job);
  const targets = platforms ?? enabledPlatforms();
  if (targets.length === 0) {
    await log("warn", `No connected platform enabled: "${source.title}" was not queued for publishing`);
    return [];
  }
  const created: Publication[] = [];
  for (const platform of targets) {
    const pub = await createPublication({ story: source, storyId: null, platform, jobId, part: null, meta: await metadataFor(source, platform) });
    if (pub) created.push(pub);
  }
  await log("info", `Queued ${created.length} publication(s) for "${source.title}"`);
  return created;
}

/** The publication of the previous part of the same story on the same platform. */
function previousPart(pub: Pick<Publication, "storyId" | "platform" | "part">): Publication | undefined {
  if (!pub.part || pub.part.index <= 1 || !pub.storyId) return undefined;
  return publications.find(
    (p) => p.storyId === pub.storyId && p.platform === pub.platform && p.part?.index === pub.part!.index - 1 && p.status !== "canceled",
  );
}

function schedule(platform: Platform, notBefore?: string | null): Date {
  const cfg = settings.get().publish;
  const now = new Date(Math.max(Date.now(), notBefore ? new Date(notBefore).getTime() : 0));
  return nextSlot({ platform, now, slots: cfg.slots, dailyLimit: cfg.dailyLimitPerPlatform, existing: publications.all() });
}

function assertPreviousPartReady(pub: Publication, need: "scheduled" | "published"): Publication | undefined {
  if (!pub.part || pub.part.index <= 1) return undefined;
  const prev = previousPart(pub);
  const ok = need === "published" ? prev?.status === "published" : prev && ["scheduled", "publishing", "published"].includes(prev.status);
  if (!ok) {
    throw new Error(
      need === "published"
        ? `Publish part ${pub.part.index - 1} first`
        : `Approve part ${pub.part.index - 1} first so the parts go out in order`,
    );
  }
  return prev;
}

export async function approvePublication(id: string, edits?: Partial<Pick<Publication, "title" | "description" | "tags">>): Promise<Publication> {
  const pub = publications.get(id);
  if (!pub) throw new Error("Publication not found");
  if (!["needs_review", "failed", "canceled"].includes(pub.status)) throw new Error(`Cannot approve a ${pub.status} publication`);
  const prev = assertPreviousPartReady(pub, "scheduled");
  const notBefore = prev ? prev.publishedAt ?? prev.scheduledAt : null;
  return publications.update(id, { ...edits, status: "scheduled", scheduledAt: schedule(pub.platform, notBefore).toISOString(), error: null });
}

export async function publishNow(id: string): Promise<Publication> {
  const pub = publications.get(id);
  if (!pub) throw new Error("Publication not found");
  if (["publishing", "published"].includes(pub.status)) throw new Error(`Already ${pub.status}`);
  assertPreviousPartReady(pub, "published");
  const updated = await publications.update(id, { status: "scheduled", scheduledAt: new Date().toISOString(), error: null });
  void publisherTick();
  return updated;
}

export async function editPublication(id: string, edits: Partial<Pick<Publication, "title" | "description" | "tags">>): Promise<Publication> {
  const pub = publications.get(id);
  if (!pub) throw new Error("Publication not found");
  if (["publishing", "published"].includes(pub.status)) throw new Error("Already published");
  return publications.update(id, edits);
}

export async function cancelPublication(id: string): Promise<Publication> {
  const pub = publications.get(id);
  if (!pub) throw new Error("Publication not found");
  if (["publishing", "published"].includes(pub.status)) throw new Error(`Cannot cancel: ${pub.status}`);
  return publications.update(id, { status: "canceled", scheduledAt: null });
}

/** Due publications whose earlier parts are already out, oldest first. */
export function duePublications(all: Publication[], now = Date.now()): Publication[] {
  const isPublished = (p: Publication) => {
    if (!p.part || p.part.index <= 1 || !p.storyId) return true;
    const prev = all.find(
      (q) => q.storyId === p.storyId && q.platform === p.platform && q.part?.index === p.part!.index - 1 && q.status !== "canceled",
    );
    return prev?.status === "published";
  };
  return all
    .filter((p) => p.status === "scheduled" && p.scheduledAt !== null && new Date(p.scheduledAt).getTime() <= now && isPublished(p))
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? "") || (a.part?.index ?? 0) - (b.part?.index ?? 0));
}

let publishing = false;

/** Publish due publications one at a time, retrying transient failures. */
export async function publisherTick(): Promise<void> {
  if (publishing) return;
  publishing = true;
  try {
    // Re-read after each publish: a finished part unblocks the next one.
    for (let pub = duePublications(publications.all())[0]; pub; pub = duePublications(publications.all())[0]) {
      await publishOne(pub);
    }
  } finally {
    publishing = false;
  }
}

async function publishOne(pub: Publication): Promise<void> {
  const job = getJob(pub.jobId);
  if (!job?.output) {
    await publications.update(pub.id, { status: "failed", error: "Video file missing" });
    return;
  }
  await publications.update(pub.id, { status: "publishing", attempts: pub.attempts + 1 });
  const cfg = settings.get().publish.platforms;
  try {
    const result = await publishers[pub.platform].publish(
      {
        filePath: path.join(JOBS_DIR, job.id, "final.mp4"),
        title: pub.title,
        description: pub.description,
        tags: pub.tags,
        // AI narration is always synthetic; AI-written stories even more so.
        aiGenerated: true,
      },
      cfg[pub.platform],
    );
    await publications.update(pub.id, {
      status: "published",
      publishedAt: new Date().toISOString(),
      remoteId: result.remoteId,
      url: result.url,
      error: null,
    });
    await log("info", `Published "${pub.title}" on ${pub.platform}${result.url ? `: ${result.url}` : ""}`);
  } catch (error) {
    const message = (error as Error).message;
    const retry = (!(error instanceof PublishError) || error.retryable) && pub.attempts + 1 < 3;
    await publications.update(pub.id, {
      status: retry ? "scheduled" : "failed",
      scheduledAt: retry ? new Date(Date.now() + 15 * 60_000).toISOString() : pub.scheduledAt,
      error: message,
    });
    await log(retry ? "warn" : "error", `${pub.platform} publish ${retry ? "will retry" : "failed"} for "${pub.title}": ${message}`);
  }
}

// ---------------------------------------------------------------- orchestrator

let cycling = false;
let lastCycle: string | null = null;

/** One automation pass: keep the backlog full and keep one story in production. */
export async function runCycle(force = false): Promise<void> {
  const cfg = settings.get();
  if ((!cfg.automation.enabled && !force) || cycling) return;
  cycling = true;
  lastCycle = new Date().toISOString();
  try {
    const approved = stories.filter((s) => s.status === "approved");
    if (approved.length < cfg.automation.targetBacklog) await discover();

    const producing = stories.filter((s) => s.status === "producing");
    const next = stories
      .filter((s) => s.status === "approved")
      .sort((a, b) => (b.curation?.score ?? 0) - (a.curation?.score ?? 0))[0];
    if (producing.length === 0 && next) await produceStory(next.id);
  } catch (error) {
    await log("error", `Cycle failed: ${(error as Error).message}`);
  } finally {
    cycling = false;
  }
}

export function pipelineStatus() {
  return { lastCycle, cycling, publishing, enabled: settings.get().automation.enabled };
}

let cycleTimer: NodeJS.Timeout | null = null;

export function restartScheduler(): void {
  if (cycleTimer) clearInterval(cycleTimer);
  const minutes = Math.max(5, settings.get().automation.intervalMinutes);
  cycleTimer = setInterval(() => void runCycle(), minutes * 60_000);
}

export async function startAutomation(): Promise<void> {
  await activity.load();
  // A restart interrupts uploads; put them back in the queue.
  for (const p of publications.filter((p) => p.status === "publishing")) {
    await publications.update(p.id, { status: "scheduled", scheduledAt: new Date().toISOString() });
  }
  jobEvents.on("any", (job: Job) => void onJobUpdate(job).catch((e) => log("error", `Pipeline: ${(e as Error).message}`)));
  // Resume stories whose jobs moved on while the server was down.
  for (const story of stories.filter((s) => s.status === "producing")) {
    const jobs = storyJobIds(story).map((id) => getJob(id));
    if (jobs.length === 0 || jobs.some((j) => !j)) {
      await stories.update(story.id, { status: "failed", error: "Video job missing" });
      continue;
    }
    for (const job of jobs) await onJobUpdate(job!);
  }
  restartScheduler();
  setInterval(() => void publisherTick(), 60_000);
  void runCycle();
}
