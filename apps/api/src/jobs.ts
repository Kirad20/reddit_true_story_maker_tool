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
import { span, withTrace } from "./telemetry";
import { listVoices, synthesize, type TtsResult } from "./tts";
import { AUTO_VOICE, chooseVoice, type VoiceChoice } from "./voice";

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
  /** How the voice was picked when the user chose "automatic". */
  voiceChoice?: VoiceChoice | null;
  /** Bumped on every full redo; busts browser caches of the voice/MP4 files. */
  revision?: number;
  /** Render the MP4 right after the preview is ready (a redo of a finished video). */
  autoRender?: boolean;
};

const jobs = new Map<string, Job>();
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);

// One pipeline step at a time: TTS and rendering both saturate the CPU.
let queue: Promise<void> = Promise.resolve();
function enqueue(job: Job, task: () => Promise<void>): void {
  const traced = () => withTrace({ jobId: job.id }, task);
  queue = queue.then(traced, traced);
}

/** Statuses where the job is waiting in the queue or being worked on. */
const BUSY: JobStatus[] = ["queued", "fetching", "scripting", "tts", "composing", "rendering"];
export const isBusy = (job: Job): boolean => BUSY.includes(job.status);

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
  enqueue(job, () => runPipeline(job));
  return job;
}

export async function retryJob(job: Job): Promise<void> {
  if (isBusy(job)) throw new Error("This video is already being processed");
  await update(job, { status: "queued", error: null, progress: 0 });
  enqueue(job, () => (job.composition ? runRender(job) : runPipeline(job)));
}

export async function startRender(job: Job): Promise<void> {
  if (!job.composition) throw new Error("This video is not ready to render yet");
  if (isBusy(job)) throw new Error("This video is already being processed");
  // The old MP4 is stale from here on: never offer it while the new one renders.
  await update(job, { status: "queued", progress: 0, error: null, output: null });
  enqueue(job, () => runRender(job));
}

/**
 * Rebuild the video from scratch: source, script, voice and composition run again
 * (with optional new settings), replacing the previous preview and MP4.
 */
export async function redoJob(job: Job, overrides: Partial<JobOptions> = {}): Promise<void> {
  if (isBusy(job)) throw new Error("This video is already being processed");
  const options = { ...job.options, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) } as JobOptions;
  // A finished video comes back finished: the new MP4 renders right after the preview.
  const autoRender = job.status === "done";
  await fs.rm(path.join(jobDir(job.id), "final.mp4"), { force: true });
  await update(job, {
    autoRender,
    options,
    status: "queued",
    progress: 0,
    error: null,
    warnings: [],
    blocks: null,
    cardTitle: null,
    tts: null,
    composition: null,
    output: null,
    voiceChoice: null,
    revision: (job.revision ?? 0) + 1,
  });
  enqueue(job, () => runPipeline(job));
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

async function compose(job: Job, next: JobStatus = "ready"): Promise<void> {
  const { options, post, blocks, tts } = job;
  if (!post || !blocks || !tts) throw new Error("Missing script or voice");
  const composition = buildComposition({
    audioSrc: `${mediaUrl(job.id, "voice.wav")}?v=${job.revision ?? 0}`,
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
  await update(job, { composition, status: next, progress: next === "ready" ? 1 : 0 });
}

async function runPipeline(job: Job): Promise<void> {
  const { options } = job;
  try {
    // 1. Source
    await update(job, { status: "fetching", progress: 0 });
    const post = await span(
      job.id,
      "fetching",
      () => (options.source.type === "url" ? fetchRedditPost(options.source.url, options.commentCount) : Promise.resolve(postFromText(options.source))),
      (p) => `${options.source.type === "url" ? "Reddit" : "texto"} · ${p.body.length} caracteres · ${p.comments.length} comentarios`,
    );
    const warnings: string[] = [];
    if (post.nsfw) warnings.push("This post is marked NSFW.");
    await update(job, { post, warnings });

    // 2. Script
    await update(job, { status: "scripting" });
    let blocks = await span(
      job.id,
      "scripting",
      async () => {
        let result = fitToDuration(buildLiteralBlocks(post), options.maxDurationSec, options.speed);
        const needsClaude = options.scriptMode === "claude" || options.language === "es";
        if (!needsClaude) return result;
        if (!agentReady("script")) {
          if (options.language === "es") throw new Error("Spanish needs translation: set a model for the Script agent (Settings → Modelos)");
          warnings.push("No model for the Script agent (Settings → Modelos): used the literal script.");
          return result;
        }
        try {
          result = await adaptScript(result, { rewrite: options.scriptMode === "claude", language: options.language });
        } catch (error) {
          if (options.language === "es" || !(error instanceof ClaudeError)) throw error;
          warnings.push(`${error.message}. Used the literal script.`);
        }
        return result;
      },
      (b) => `${b.length} bloques · ${options.scriptMode === "claude" ? "reescrito" : "literal"} · ${options.language}`,
    );
    // The on-screen card keeps the clean title; the narration announces the part.
    const cardTitle = blocks.find((b) => b.kind === "title")?.text ?? post.title;
    if (options.part) blocks = withPartNarration(blocks, options.part, options.language);
    await update(job, { blocks, warnings, cardTitle });

    // 3. Voice (the voice director picks one when the user chose "automatic")
    await update(job, { status: "tts" });
    let voice = options.voice ?? DEFAULT_VOICES[options.language];
    if (voice === AUTO_VOICE) {
      const choice = await span(
        job.id,
        "voice-casting",
        async () => chooseVoice({ blocks, language: options.language, available: await listVoices(), fallback: DEFAULT_VOICES[options.language] }),
        (c) => `${c.voice} · ${c.by}`,
      );
      if (choice.warning) warnings.push(choice.warning);
      voice = choice.voice;
      await update(job, { voiceChoice: { voice: choice.voice, reason: choice.reason, by: choice.by }, warnings });
    }
    const tts = await span(
      job.id,
      "tts",
      () =>
        synthesize({
          texts: blocks.map((b) => b.text),
          voice,
          lang: options.language,
          speed: options.speed,
          outPath: path.join(jobDir(job.id), "voice.wav"),
        }),
      (t) => `${voice} · ${t.duration.toFixed(1)} s de audio · tiempos ${t.timing_source}`,
    );
    if (tts.timing_source === "proportional") warnings.push("Word timings are estimated (speech recognizer unavailable).");
    await update(job, { tts, warnings });

    // 4. Composition → preview is ready
    await update(job, { status: "composing" });
    const renderAfter = Boolean(job.autoRender);
    await span(job.id, "composing", () => compose(job, renderAfter ? "queued" : "ready"), () => `${job.composition?.durationInFrames ?? 0} frames`);
    if (renderAfter) {
      job.autoRender = false;
      await runRender(job);
    }
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
    const composition = job.composition;
    await span(
      job.id,
      "rendering",
      () =>
        renderVideo(withOrigin(composition, API_ORIGIN), output, (p) => {
          // Throttle disk writes / SSE to ~1% steps.
          if (p - last >= 0.01 || p === 1) {
            last = p;
            job.progress = p;
            jobEvents.emit(job.id, publicJob(job));
          }
        }),
      () => `${composition.durationInFrames} frames · ${composition.audio.durationSec.toFixed(1)} s`,
    );
    // The query string makes browsers fetch the new file after a re-render.
    await update(job, { status: "done", progress: 1, output: `${mediaUrl(job.id, "final.mp4")}?v=${Date.now()}` });
  } catch (error) {
    await fail(job, error);
  }
}

export async function patchComposition(job: Job, patch: CompositionPatch): Promise<void> {
  if (!job.composition || !job.tts) throw new Error("This video has no preview yet");
  if (isBusy(job)) throw new Error("Wait for the current step to finish");
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
  if (isBusy(job)) throw new Error("Cannot delete while the video is being processed");
  jobs.delete(job.id);
  await fs.rm(jobDir(job.id), { recursive: true, force: true });
  jobEvents.emit("any", { id: job.id, deleted: true });
}
