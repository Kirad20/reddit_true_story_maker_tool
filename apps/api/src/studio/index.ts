import { z } from "zod";
import { agentReady } from "../aiconfig";
import { PLATFORMS, publications, type Platform } from "../domain";
import { structured } from "../llm";
import { Collection, Doc, newId } from "../store";
import { LlmContentGenerator } from "./adapters/llmGenerator";
import { studioRouter } from "./adapters/http";
import { zernioMetricsOrNull } from "./adapters/zernioMetrics";
import { StudioService } from "./application";
import { DEFAULT_STUDIO_CONFIG, StudioAutomation, type StudioConfig } from "./automation";
import type { Draft } from "./domain";
import type { DraftRepository } from "./ports";

// Composition root: wires the application to the real adapters.

const text = (max: number) => z.string().trim().max(max);
const configPatch = z.object({
  brand: z.object({ name: text(80), niche: text(200), voice: text(200), audience: text(200), language: z.enum(["en", "es"]) }).partial().optional(),
  automation: z
    .object({
      enabled: z.boolean(),
      intervalHours: z.number(),
      maxDrafts: z.number(),
      theme: text(200),
      platforms: z.array(z.enum(PLATFORMS as [Platform, ...Platform[]])),
    })
    .partial()
    .optional(),
});

const drafts = new Collection<Draft>("studio-drafts");
const config = new Doc<StudioConfig>("studio", DEFAULT_STUDIO_CONFIG);

const repo: DraftRepository = {
  save: (d) => drafts.put(d),
  list: async () => drafts.all(),
  get: async (id) => drafts.get(id) ?? null,
  remove: (id) => drafts.remove(id),
};

export const studio = new StudioService({
  generator: new LlmContentGenerator(structured),
  drafts: repo,
  // Resolved per call so a Zernio key set later in Settings takes effect.
  metrics: { fetch: async () => (zernioMetricsOrNull()?.fetch() ?? Promise.reject(new Error("Zernio not configured"))) },
  local: {
    published: () =>
      publications
        .filter((p) => Boolean(p.status === "published" && p.publishedAt))
        .map((p) => ({ postId: p.id, platform: p.platform, title: p.title, publishedAt: p.publishedAt! })),
  },
  brand: () => config.get().brand,
  newId: () => newId("sd"),
  now: () => new Date(),
});

const automation = new StudioAutomation({
  config: { get: () => config.get(), set: (c) => config.set(c) },
  service: studio,
  now: () => new Date(),
    isReady: () => Boolean(agentReady("studio")),
});

export const studioRoutes = () =>
  studioRouter(studio, {
    getConfig: () => ({ ...automation.getConfig(), ready: agentReady("studio") }),
    setConfig: (input) => automation.update(configPatch.parse(input ?? {}) as never),
    runNow: async () => ({ ok: await automation.run() }),
  });

export async function startStudio(): Promise<void> {
  await Promise.all([drafts.load(), config.load()]);
  setInterval(() => void automation.tick().catch(() => undefined), 10 * 60_000).unref();
}
