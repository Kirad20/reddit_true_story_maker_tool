import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import { PLATFORMS, type Platform } from "../../domain";
import type { StudioService } from "../application";

const platform = z.enum(PLATFORMS as [string, ...string[]]);
const generateInput = z.object({
  kind: z.enum(["post", "ads", "seo", "video", "plan"]),
  topic: z.string().trim().min(1).max(500),
  platforms: z.array(platform).max(4).optional(),
  days: z.number().int().min(1).max(14).optional(),
  formats: z.record(platform, z.string().max(20)).optional(),
});
const statusInput = z.object({ status: z.enum(["draft", "approved", "archived"]) });

/** Optional extras wired by the composition root (brand profile + agent automation). */
export type StudioControls = {
  getConfig(): unknown;
  setConfig(input: unknown): Promise<unknown>;
  runNow(): Promise<unknown>;
};

export function studioRouter(service: StudioService, controls?: StudioControls): Router {
  const router = Router();
  const handle = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
    fn(req, res).catch((e: unknown) => {
      if (e instanceof ZodError) return void res.status(400).json({ error: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      const message = e instanceof Error ? e.message : String(e);
      res.status(/not found/i.test(message) ? 404 : 502).json({ error: message });
    });

  router.post("/generate", handle(async (req, res) => {
    const input = generateInput.parse(req.body);
    res.status(201).json(await service.generate(input as never));
  }));

  router.get("/drafts", handle(async (_req, res) => void res.json(await service.list())));

  router.post("/drafts/:id/publish", handle(async (req, res) => {
    const { platform } = z.object({ platform: z.enum(PLATFORMS as [Platform, ...Platform[]]) }).parse(req.body);
    res.json(await service.publish(String(req.params.id), platform));
  }));

  router.post("/drafts/:id/illustrate", handle(async (req, res) => {
    const { platform } = z.object({ platform: z.enum(PLATFORMS as [Platform, ...Platform[]]) }).parse(req.body);
    res.json(await service.illustrate(String(req.params.id), platform));
  }));

  router.patch("/drafts/:id", handle(async (req, res) => {
    res.json(await service.setStatus(String(req.params.id), statusInput.parse(req.body).status));
  }));

  router.delete("/drafts/:id", handle(async (req, res) => {
    await service.remove(String(req.params.id));
    res.status(204).end();
  }));

  router.get("/analytics", handle(async (req, res) => {
    res.json(await service.analytics({ withInsights: req.query.insights === "1" }));
  }));

  if (controls) {
    router.get("/config", handle(async (_req, res) => void res.json(controls.getConfig())));
    router.put("/config", handle(async (req, res) => void res.json(await controls.setConfig(req.body))));
    router.post("/automation/run", handle(async (_req, res) => void res.json(await controls.runNow())));
  }
  return router;
}
