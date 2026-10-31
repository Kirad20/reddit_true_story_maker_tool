import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { PROCEDURAL_PRESETS, assetStore, listBackgrounds, listMusic } from "./assets";
import { AGENTS, CREDENTIALS, reconcileAgents, agentLabel, agentReady, aiConfig, loadAIConfig, mask, newProviderId, secret, setSecrets } from "./aiconfig";
import fs from "node:fs";
import path from "node:path";
import { toNodeHandler } from "better-auth/node";
import { AUTH_BASE_PATH, auth, initAuth, requireSession } from "./auth";
import {
  API_PORT,
  ASSETS_DIR,
  DATA_DIR,
  DEFAULT_VOICES,
  JOBS_DIR,
  PUBLIC_URL,
  TTS_URL,
  WEB_DIST,
} from "./config";
import { LEGAL_ROUTES, legalOptionsFromEnv, renderLegalPage } from "./legal";
import { securityHeaders } from "./security";
import { checkEnvironment, checkWritable, reportOrExit } from "./validate";
import { listProviderModels } from "./llm";
import {
  createJob,
  deleteJob,
  getJob,
  jobEvents,
  listJobs,
  loadJobs,
  patchComposition,
  publicJob,
  redoJob,
  retryJob,
  startRender,
} from "./jobs";
import {
  activityLog,
  approvePublication,
  publishToTikTok,
  videoDurationSec,
  cancelPublication,
  curate,
  discover,
  editPublication,
  log,
  pipelineStatus,
  produceStory,
  publishNow,
  queuePublications,
  redoStory,
  restartScheduler,
  runCycle,
  startAutomation,
} from "./automation";
import { PLATFORMS, loadDomain, publications, settings, stories, storyJobIds, type Platform, type Settings } from "./domain";
import { accountStatuses, facebook, loadAccounts, onPlatformLinked, publishers } from "./publish";
import { accounts } from "./publish/accounts";
import { tiktokCreatorInfo } from "./publish/tiktok";
import { hasRedditAccess } from "./reddit";
import {
  agentsInput,
  compositionPatch,
  credentialsInput,
  jobOptions,
  manualStoryInput,
  providersInput,
  publicationEdit,
  tiktokPostInput,
  redoInput,
  settingsSchema,
} from "./schema";
import { manualStory } from "./sources";
import { listVoices, previewVoice } from "./tts";
import type { SessionUser } from "./auth";
import { getLlmCall, jobTrace, loadTelemetry, recordAudit, telemetryEvents, telemetrySummary, withTrace } from "./telemetry";
import { AGENT_FLOW } from "./architecture";

const assets = assetStore();
reportOrExit([
  ...checkEnvironment(process.env),
  ...(await checkWritable(assets.kind === "local" ? [DATA_DIR, JOBS_DIR, ASSETS_DIR] : [DATA_DIR, JOBS_DIR])),
]);
if (assets.kind === "s3") {
  // Not fatal: the app works with animated backgrounds while the bucket is down; /api/ready reports it.
  const problem = await assets.check();
  console[problem ? "warn" : "log"](`[assets] backgrounds and music from S3${problem ? ` — UNREACHABLE: ${problem}` : ""}`);
}

const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
// Better Auth (login, sessions, user management) reads the raw body: mount it before express.json.
app.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(auth));
app.use(requireSession());
app.use(express.json({ limit: "1mb" }));

// Audit trail: every change made through the API, with who made it and the outcome.
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || !req.path.startsWith("/api/")) return next();
  const started = Date.now();
  res.on("finish", () => {
    const user = res.locals.user as SessionUser | undefined;
    recordAudit({
      user: user ? `${user.name} <${user.email}>` : null,
      action: `${req.method} ${req.path}`,
      target: req.path.match(/^\/api\/(?:jobs|stories|publications)\/([^/]+)/)?.[1] ?? null,
      status: res.statusCode,
      durationMs: Date.now() - started,
    });
  });
  // Model calls triggered by this request are tagged with what started them.
  withTrace({ trigger: `${req.method} ${req.path}` }, async () => next());
});

// Public legal pages (no login): Terms of Service and Privacy Policy, required by YouTube, TikTok and Meta.
const legalOptions = legalOptionsFromEnv(process.env, PUBLIC_URL);
for (const [route, page] of Object.entries(LEGAL_ROUTES)) {
  const html = renderLegalPage(page, legalOptions);
  app.get([route, `${route}.html`], (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("html").send(html);
  });
}

app.get("/api/me", (_req, res) => {
  res.json(res.locals.user);
});

// Media for the preview player and the renderer (supports range requests).
app.use("/media/jobs", express.static(JOBS_DIR, { index: false }));
// Backgrounds and music: local assets/ folder or the S3 bucket (proxied, so the bucket can stay private).
app.use("/media/assets", assets.handler());

const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

function requireJob(req: Request, res: Response) {
  const job = getJob(String(req.params.id));
  if (!job) res.status(404).json({ error: "Video not found" });
  return job;
}

// Readiness: the voice service answers and the data folders are writable.
app.get("/api/ready", async (_req, res) => {
  const [problems, tts, assetProblem] = await Promise.all([
    checkWritable([DATA_DIR, JOBS_DIR]),
    fetch(`${TTS_URL}/health`).then(
      (r) => r.ok,
      () => false,
    ),
    assets.check(),
  ]);
  const ready = tts && problems.length === 0 && !assetProblem;
  res.status(ready ? 200 : 503).json({
    ready,
    tts,
    storage: problems.map((p) => p.message),
    assets: { kind: assets.kind, ok: !assetProblem, error: assetProblem },
  });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get(
  "/api/options",
  route(async (_req, res) => {
    // A bucket outage must not break the whole UI: fall back to animated backgrounds and report it.
    let assetsError: string | null = null;
    const degrade = <T,>(fallback: T) => (e: Error) => {
      assetsError = `No se pudieron listar fondos y música (${assets.kind}): ${e.message}`;
      return fallback;
    };
    const [backgrounds, music, voices] = await Promise.all([
      listBackgrounds().catch(degrade([])),
      listMusic().catch(degrade([] as string[])),
      listVoices().then(
        (v) => ({ voices: v, error: null as string | null }),
        (e: Error) => ({ voices: [] as string[], error: e.message }),
      ),
    ]);
    res.json({
      backgrounds,
      assetStorage: assets.kind,
      assetsError,
      procedural: PROCEDURAL_PRESETS,
      music,
      voices: voices.voices,
      ttsError: voices.error,
      defaultVoices: DEFAULT_VOICES,
      captionStyles: ["pop", "karaoke", "boxed"],
      claude: agentReady("script"),
      voiceAgent: agentLabel("voice"),
      reddit: hasRedditAccess(),
    });
  }),
);

app.post(
  "/api/voices/preview",
  route(async (req, res) => {
    const { voice, lang = "en", speed = 1 } = req.body ?? {};
    const text = lang === "es" ? "Hola, esta es mi voz para tus historias de Reddit." : "Hi! This is how I'll narrate your Reddit stories.";
    const audio = await previewVoice({ text, voice, lang, speed });
    res.type("audio/wav").send(Buffer.from(audio));
  }),
);

app.get("/api/jobs", (_req, res) => {
  res.json(listJobs().map(publicJob));
});

app.post(
  "/api/jobs",
  route(async (req, res) => {
    const job = await createJob(jobOptions.parse(req.body));
    res.status(201).json(publicJob(job));
  }),
);

app.get("/api/jobs/:id", (req, res) => {
  const job = requireJob(req, res);
  if (job) res.json(publicJob(job));
});

// Live progress via Server-Sent Events.
app.get("/api/jobs/:id/events", (req, res) => {
  const job = requireJob(req, res);
  if (!job) return;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send(publicJob(job));
  const listener = (data: unknown) => send(data);
  jobEvents.on(job.id, listener);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    jobEvents.off(job.id, listener);
  });
});

app.patch(
  "/api/jobs/:id/composition",
  route(async (req, res) => {
    const job = requireJob(req, res);
    if (!job) return;
    await patchComposition(job, compositionPatch.parse(req.body));
    res.json(publicJob(job));
  }),
);

app.post(
  "/api/jobs/:id/render",
  route(async (req, res) => {
    const job = requireJob(req, res);
    if (!job) return;
    await startRender(job);
    res.json(publicJob(job));
  }),
);

app.post(
  "/api/jobs/:id/retry",
  route(async (req, res) => {
    const job = requireJob(req, res);
    if (!job) return;
    await retryJob(job);
    res.json(publicJob(job));
  }),
);

app.post(
  "/api/jobs/:id/redo",
  route(async (req, res) => {
    const job = requireJob(req, res);
    if (!job) return;
    await redoJob(job, redoInput.parse(req.body ?? {}));
    res.json(publicJob(job));
  }),
);

app.get("/api/jobs/:id/trace", (req, res) => {
  const job = requireJob(req, res);
  if (job) res.json(jobTrace(job.id));
});

app.delete(
  "/api/jobs/:id",
  route(async (req, res) => {
    const job = requireJob(req, res);
    if (!job) return;
    await deleteJob(job);
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------- pipeline

app.get("/api/pipeline", (_req, res) => {
  res.json({
    status: pipelineStatus(),
    settings: settings.get(),
    accounts: accountStatuses(),
    capabilities: {
      claude: agentReady("writer"),
      reddit: hasRedditAccess(),
      model: agentLabel("writer"),
      agents: Object.fromEntries(AGENTS.map((a) => [a.id, agentLabel(a.id)])),
    },
    activity: activityLog().slice(0, 100),
  });
});

app.put(
  "/api/settings",
  route(async (req, res) => {
    const next = await settings.set(settingsSchema.parse(req.body) as Settings);
    restartScheduler();
    res.json(next);
  }),
);

app.post(
  "/api/pipeline/run",
  route(async (_req, res) => {
    void runCycle(true);
    res.status(202).json({ ok: true });
  }),
);

app.post(
  "/api/stories/discover",
  route(async (_req, res) => {
    res.json(await discover());
  }),
);

app.get("/api/stories", (_req, res) => {
  res.json(stories.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

app.post(
  "/api/stories",
  route(async (req, res) => {
    const story = await stories.put(manualStory(manualStoryInput.parse(req.body)));
    void curate([story.id]);
    res.status(201).json(story);
  }),
);

const requireStory = (req: Request, res: Response) => {
  const story = stories.get(String(req.params.id));
  if (!story) res.status(404).json({ error: "Story not found" });
  return story;
};

app.post(
  "/api/stories/:id/approve",
  route(async (req, res) => {
    const story = requireStory(req, res);
    if (story) res.json(await stories.update(story.id, { status: "approved" }));
  }),
);

app.post(
  "/api/stories/:id/reject",
  route(async (req, res) => {
    const story = requireStory(req, res);
    if (story) res.json(await stories.update(story.id, { status: "rejected" }));
  }),
);

app.post(
  "/api/stories/:id/produce",
  route(async (req, res) => {
    const story = requireStory(req, res);
    if (story) res.json(await produceStory(story.id));
  }),
);

app.post(
  "/api/stories/:id/redo",
  route(async (req, res) => {
    const story = requireStory(req, res);
    if (story) res.json(await redoStory(story.id));
  }),
);

app.delete(
  "/api/stories/:id",
  route(async (req, res) => {
    const story = requireStory(req, res);
    if (!story) return;
    await stories.remove(story.id);
    res.status(204).end();
  }),
);

app.get("/api/publications", (_req, res) => {
  res.json(publications.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

app.post(
  "/api/jobs/:id/publish",
  route(async (req, res) => {
    const job = requireJob(req, res);
    if (!job) return;
    const platforms = Array.isArray(req.body?.platforms) ? (req.body.platforms as Platform[]).filter((p) => PLATFORMS.includes(p)) : undefined;
    const story = stories.find((s) => storyJobIds(s).includes(job.id));
    res.json(await queuePublications(job.id, story, platforms));
  }),
);

app.patch(
  "/api/publications/:id",
  route(async (req, res) => {
    res.json(await editPublication(String(req.params.id), publicationEdit.parse(req.body)));
  }),
);

app.post(
  "/api/publications/:id/approve",
  route(async (req, res) => {
    res.json(await approvePublication(String(req.params.id), publicationEdit.parse(req.body ?? {})));
  }),
);

// TikTok review flow (feature flag Ajustes → Publicar → "Modo revisión TikTok"): the Direct Post screen.
app.get(
  "/api/publications/:id/tiktok",
  route(async (req, res) => {
    const pub = publications.get(String(req.params.id));
    if (!pub || pub.platform !== "tiktok") {
      res.status(404).json({ error: "TikTok publication not found" });
      return;
    }
    res.json({
      creator: await tiktokCreatorInfo(),
      videoUrl: getJob(pub.jobId)?.output ?? null,
      videoDurationSec: videoDurationSec(pub.jobId),
    });
  }),
);

app.post(
  "/api/publications/:id/tiktok/publish",
  route(async (req, res) => {
    const { consent: _consent, ...input } = tiktokPostInput.parse(req.body);
    res.json(await publishToTikTok(String(req.params.id), input));
  }),
);

app.post(
  "/api/publications/:id/publish-now",
  route(async (req, res) => {
    res.json(await publishNow(String(req.params.id)));
  }),
);

app.post(
  "/api/publications/:id/cancel",
  route(async (req, res) => {
    res.json(await cancelPublication(String(req.params.id)));
  }),
);

// ---------------------------------------------------------------- models, providers and credentials

function publicConfig() {
  const cfg = aiConfig.get();
  return {
    providers: cfg.providers.map((p) => ({ ...p, keyMask: mask(secret(`provider:${p.id}`)) })),
    agents: cfg.agents,
    agentMeta: AGENTS,
    agentStatus: Object.fromEntries(AGENTS.map((a) => [a.id, agentLabel(a.id)])),
    credentials: CREDENTIALS.map((c) => ({ ...c, mask: mask(secret(c.name)) })),
  };
}

app.get("/api/config", (_req, res) => {
  res.json(publicConfig());
});

app.put(
  "/api/config/providers",
  route(async (req, res) => {
    const { providers } = providersInput.parse(req.body);
    const before = aiConfig.get();
    const next = providers.map(({ apiKey: _key, ...p }) => ({ ...p, id: p.id && before.providers.some((b) => b.id === p.id) ? p.id : newProviderId() }));
    const keys: Record<string, string | null | undefined> = {};
    providers.forEach((p, i) => (keys[`provider:${next[i].id}`] = p.apiKey));
    // Forget keys of removed providers; agents that used them move to the first provider.
    for (const old of before.providers) if (!next.some((p) => p.id === old.id)) keys[`provider:${old.id}`] = null;
    const agents = reconcileAgents(before.agents, next);
    await setSecrets(keys);
    await aiConfig.set({ providers: next, agents });
    res.json(publicConfig());
  }),
);

app.put(
  "/api/config/agents",
  route(async (req, res) => {
    const { agents } = agentsInput.parse(req.body);
    const cfg = aiConfig.get();
    for (const [id, a] of Object.entries(agents)) {
      if (!cfg.providers.some((p) => p.id === a.providerId)) throw new Error(`Unknown provider for agent ${id}`);
    }
    await aiConfig.set({ ...cfg, agents });
    res.json(publicConfig());
  }),
);

app.put(
  "/api/config/credentials",
  route(async (req, res) => {
    const input = credentialsInput.parse(req.body);
    const allowed = new Set<string>(CREDENTIALS.map((c) => c.name));
    const unknown = Object.keys(input).filter((k) => !allowed.has(k));
    if (unknown.length) throw new Error(`Unknown credential: ${unknown.join(", ")}`);
    await setSecrets(input);
    res.json(publicConfig());
  }),
);

app.post(
  "/api/config/providers/:id/test",
  route(async (req, res) => {
    const provider = aiConfig.get().providers.find((p) => p.id === req.params.id);
    if (!provider) {
      res.status(404).json({ error: "Provider not found" });
      return;
    }
    const key = secret(`provider:${provider.id}`);
    if (!key) throw new Error("This provider has no API key yet");
    const models = await listProviderModels(provider, key);
    res.json({ ok: true, models });
  }),
);

// ---------------------------------------------------------------- accounts (OAuth)

const platformParam = (req: Request): Platform => {
  const platform = String(req.params.platform) as Platform;
  if (!PLATFORMS.includes(platform)) throw new Error("Unknown platform");
  return platform;
};

// Connecting happens in the browser through Better Auth (authClient.linkSocial → /api/identity/callback/<provider>).
onPlatformLinked((event) => void log(event.ok ? "info" : "error", event.message));

app.post(
  "/api/auth/:platform/disconnect",
  route(async (req, res) => {
    const platform = platformParam(req);
    await publishers[platform].disconnect();
    await log("info", `Disconnected ${platform}`);
    res.json(accountStatuses());
  }),
);

app.post(
  "/api/auth/facebook/page",
  route(async (req, res) => {
    await facebook.selectPage(String(req.body?.pageId ?? ""));
    res.json(accountStatuses());
  }),
);

app.get("/api/auth/facebook/pages", (_req, res) => {
  const account = accounts.get().facebook;
  res.json({ pages: account?.pages.map(({ id, name }) => ({ id, name })) ?? [], pageId: account?.pageId ?? null });
});

// Pipeline-wide live updates (activity, stories, publications).
app.get("/api/pipeline/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = () => res.write(`data: {"type":"changed"}\n\n`);
  jobEvents.on("pipeline", send);
  jobEvents.on("any", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    jobEvents.off("pipeline", send);
    jobEvents.off("any", send);
  });
});

// ---------------------------------------------------------------- observability

app.get("/api/observability", (req, res) => {
  const range = String(req.query.range ?? "7d");
  res.json({
    ...telemetrySummary(range),
    agents: AGENTS.map((a) => ({ ...a, model: agentLabel(a.id) })),
    flow: AGENT_FLOW,
    queue: listJobs()
      .filter((j) => !["ready", "done", "failed"].includes(j.status))
      .map((j) => ({ id: j.id, status: j.status, progress: j.progress, title: j.post?.title ?? null })),
    pipeline: pipelineStatus(),
  });
});

app.get("/api/observability/calls/:id", (req, res) => {
  const call = getLlmCall(String(req.params.id));
  if (!call) res.status(404).json({ error: "Call not found" });
  else res.json(call);
});

app.get("/api/observability/events", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (record: { type: string }) => res.write(`data: ${JSON.stringify({ type: record.type })}\n\n`);
  telemetryEvents.on("record", send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    telemetryEvents.off("record", send);
  });
});

// Unknown API routes return JSON 404 instead of the web app.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Production: the API also serves the built web app (single origin, one container).
if (fs.existsSync(path.join(WEB_DIST, "index.html"))) {
  app.use(express.static(WEB_DIST, { index: false, maxAge: "1h" }));
  app.get(/^\/(?!api\/|media\/).*/, (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(400).json({ error: message });
});

await initAuth();
await loadJobs();
await loadTelemetry();
await loadAIConfig();
await loadDomain();
await loadAccounts();
await startAutomation();
app.listen(API_PORT, () => {
  console.log(`[api] http://localhost:${API_PORT}`);
});
