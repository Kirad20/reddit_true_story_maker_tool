import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import type { Background, VideoComposition } from "@tsm/video";
import { clipDuration, clipPath, listBackgrounds, musicPath } from "./assets";
import { adaptScript, ClaudeError } from "./claude";
import { buildComposition, pickStartAt, withOrigin } from "./composition";
import { agentReady } from "./aiconfig";
import { API_ORIGIN, DEFAULT_VOICES, JOBS_DIR } from "./config";
import { fetchRedditPost, type RedditPost } from "./reddit";
import { renderVideo } from "./render";
import type { CompositionPatch, JobOptions } from "./schema";
import { buildLiteralBlocks, fitToDuration, partLabel, withPartNarration, type ScriptBlock } from "./script";
import { synthesize, type TtsResult } from "./tts";

export type JobStatus =
  | "queued"
  | "fetching"
  | "scripting"
  | "tts"
  | "composing"
  | "ready"
  | "rendering"
  | "done"
  | "failed";

export type Job = {
  id: string;
  createdAt: string;
  updatedAt: string;
  options: JobOptions;
  status: JobStatus;
  /** 0..1 within the current status (render progress). */
  progress: number;
  error: string | null;
  warnings: string[];
  post: RedditPost | null;
  blocks: ScriptBlock[] | null;
  /** Title shown on the Reddit card (narration may add "Part two"). */
  cardTitle?: string | null;
  tts: TtsResult | null;
  composition: VideoComposition | null;
  output: string | null;
};

const jobs = new Map<string, Job>();
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

// One pipeline step at a time: TTS and rendering both saturate the CPU.
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task, task);
}

const jobDir = (id: string) => path.join(JOBS_DIR, id);
export const mediaUrl = (id: string, file: string) => `/media/jobs/${id}/${file}`;

async function save(job: Job): Promise<void> {
  job.updatedAt = new Date().toISOString();
  await fs.mkdir(jobDir(job.id), { recursive: true });
  await fs.writeFile(path.join(jobDir(job.id), "job.json"), JSON.stringify(job, null, 2));
  if (job.composition) {
    await fs.writeFile(path.join(jobDir(job.id), "composition.json"), JSON.stringify(job.composition, null, 2));
  }
  jobEvents.emit(job.id, publicJob(job));
  jobEvents.emit("any", publicJob(job));
}

async function update(job: Job, patch: Partial<Job>): Promise<void> {
  Object.assign(job, patch);
  await save(job);
}

/** The shape sent to the browser (no TTS internals). */
export function publicJob(job: Job) {
  const { tts: _tts, ...rest } = job;
  return rest;
}

export async function loadJobs(): Promise<void> {
  await fs.mkdir(JOBS_DIR, { recursive: true });
  for (const entry of await fs.readdir(JOBS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const job = JSON.parse(await fs.readFile(path.join(JOBS_DIR, entry.name, "job.json"), "utf8")) as Job;
      // A restart interrupts anything in flight.
      if (!["ready", "done", "failed"].includes(job.status)) {
        job.status = job.composition ? "ready" : "failed";
        job.error = job.composition ? null : "Interrupted by a server restart. Retry it.";
      }
      jobs.set(job.id, job);
    } catch {
      // Not a job folder.
    }
  }
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export async function createJob(options: JobOptions): Promise<Job> {
  const now = new Date().toISOString();
  const job: Job = {
    id: `${now.slice(0, 10)}-${randomUUID().slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
    options,
    status: "queued",
    progress: 0,
    error: null,
    warnings: [],
    post: null,
    blocks: null,
    tts: null,
    composition: null,
    output: null,
  };
  jobs.set(job.id, job);
  await save(job);
  enqueue(() => runPipeline(job));
  return job;
}

export async function retryJob(job: Job): Promise<void> {
  await update(job, { status: "queued", error: null, progress: 0 });
  enqueue(() => (job.composition ? runRender(job) : runPipeline(job)));
}

export async function startRender(job: Job): Promise<void> {
  if (!job.composition) throw new Error("This video is not ready to render yet");
  await update(job, { status: "queued", progress: 0, error: null });
  enqueue(() => runRender(job));
}

async function fail(job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[job ${job.id}]`, error);
  await update(job, { status: "failed", error: message });
}

function postFromText(source: Extract<JobOptions["source"], { type: "text" }>): RedditPost {
  return {
    subreddit: source.subreddit,
    author: source.author,
    title: source.title,
    body: source.body,
    score: source.upvotes,
    numComments: source.comments.length,
    nsfw: false,
    permalink: "",
    comments: source.comments.map((c) => ({ author: c.author, body: c.body, score: 0 })),
  };
}

async function resolveBackground(choice: JobOptions["background"], videoSec: number): Promise<Background> {
  if (choice.type === "procedural") return { kind: "procedural", preset: choice.preset };
  const category = (await listBackgrounds()).find((c) => c.name === choice.category);
  if (!category) throw new Error(`Background category "${choice.category}" has no clips in assets/backgrounds`);
  const file = choice.file && category.clips.includes(choice.file)
    ? choice.file
    : category.clips[Math.floor(Math.random() * category.clips.length)];
  const durationSec = await clipDuration(clipPath(category.name, file));
  return {
    kind: "video",
    src: `/media/assets/backgrounds/${encodeURIComponent(category.name)}/${encodeURIComponent(file)}`,
    startAt: pickStartAt(durationSec, videoSec),
    durationSec,
  };
}

function resolveMusic(file: string | null, volume: number): VideoComposition["music"] {
  if (!file) return null;
  musicPath(file); // validates the name
  return { src: `/media/assets/music/${encodeURIComponent(file)}`, volume };
}

async function compose(job: Job): Promise<void> {
  const { options, post, blocks, tts } = job;
  if (!post || !blocks || !tts) throw new Error("Missing script or voice");
  const composition = buildComposition({
    audioSrc: mediaUrl(job.id, "voice.wav"),
    tts,
    blocks,
    post: {
      subreddit: post.subreddit,
      author: post.author,
      title: job.cardTitle ?? blocks[0]?.text ?? post.title,
      upvotes: post.score,
      comments: post.numComments,
    },
    background: await resolveBackground(options.background, tts.duration),
    music: resolveMusic(options.music, options.musicVolume),
    captionStyle: options.captionStyle,
    part: options.part ? { ...options.part, label: partLabel(options.part, options.language) } : null,
  });
  await update(job, { composition, status: "ready", progress: 1 });
}

async function runPipeline(job: Job): Promise<void> {
  const { options } = job;
  try {
    // 1. Source
    await update(job, { status: "fetching", progress: 0 });
    const post = options.source.type === "url"
      ? await fetchRedditPost(options.source.url, options.commentCount)
      : postFromText(options.source);
    const warnings: string[] = [];
    if (post.nsfw) warnings.push("This post is marked NSFW.");
    await update(job, { post, warnings });

    // 2. Script
    await update(job, { status: "scripting" });
    let blocks = fitToDuration(buildLiteralBlocks(post), options.maxDurationSec, options.speed);
    const needsClaude = options.scriptMode === "claude" || options.language === "es";
    if (needsClaude) {
      if (!agentReady("script")) {
        if (options.language === "es") throw new Error("Spanish needs translation: set a model for the Script agent (Settings → Modelos)");
        warnings.push("No model for the Script agent (Settings → Modelos): used the literal script.");
      } else {
        try {
          blocks = await adaptScript(blocks, { rewrite: options.scriptMode === "claude", language: options.language });
        } catch (error) {
          if (options.language === "es" || !(error instanceof ClaudeError)) throw error;
          warnings.push(`${error.message}. Used the literal script.`);
        }
      }
    }
    // The on-screen card keeps the clean title; the narration announces the part.
    const cardTitle = blocks.find((b) => b.kind === "title")?.text ?? post.title;
    if (options.part) blocks = withPartNarration(blocks, options.part, options.language);
    await update(job, { blocks, warnings, cardTitle });

    // 3. Voice
    await update(job, { status: "tts" });
    const tts = await synthesize({
      texts: blocks.map((b) => b.text),
      voice: options.voice ?? DEFAULT_VOICES[options.language],
      lang: options.language,
      speed: options.speed,
      outPath: path.join(jobDir(job.id), "voice.wav"),
    });
    if (tts.timing_source === "proportional") warnings.push("Word timings are estimated (speech recognizer unavailable).");
    await update(job, { tts, warnings });

    // 4. Composition → preview is ready
    await update(job, { status: "composing" });
    await compose(job);
  } catch (error) {
    await fail(job, error);
  }
}

async function runRender(job: Job): Promise<void> {
  if (!job.composition) return fail(job, new Error("Nothing to render"));
  try {
    await update(job, { status: "rendering", progress: 0 });
    const output = path.join(jobDir(job.id), "final.mp4");
    let last = 0;
    await renderVideo(withOrigin(job.composition, API_ORIGIN), output, (p) => {
      // Throttle disk writes / SSE to ~1% steps.
      if (p - last >= 0.01 || p === 1) {
        last = p;
        job.progress = p;
        jobEvents.emit(job.id, publicJob(job));
      }
    });
    await update(job, { status: "done", progress: 1, output: mediaUrl(job.id, "final.mp4") });
  } catch (error) {
    await fail(job, error);
  }
}

export async function patchComposition(job: Job, patch: CompositionPatch): Promise<void> {
  if (!job.composition || !job.tts) throw new Error("This video has no preview yet");
  if (job.status === "rendering" || job.status === "queued") throw new Error("Wait for the current step to finish");
  const options = { ...job.options, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as JobOptions;
  const composition: VideoComposition = {
    ...job.composition,
    captionStyle: options.captionStyle,
    music: resolveMusic(options.music, options.musicVolume),
    background: patch.background ? await resolveBackground(options.background, job.tts.duration) : job.composition.background,
  };
  // Any visual change makes a previous render stale.
  await update(job, { options, composition, status: "ready", output: null, progress: 1 });
}

export async function deleteJob(job: Job): Promise<void> {
  if (job.status === "rendering") throw new Error("Cannot delete while rendering");
  jobs.delete(job.id);
  await fs.rm(jobDir(job.id), { recursive: true, force: true });
  jobEvents.emit("any", { id: job.id, deleted: true });
}
