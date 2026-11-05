import { PLATFORMS, type Platform } from "../domain";
import type { StudioService } from "./application";
import { isDue, type Brand } from "./domain";

export type StudioConfig = {
  brand: Brand;
  automation: { enabled: boolean; intervalHours: number; platforms: Platform[]; maxDrafts: number; lastRun: string | null; theme?: string };
};

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  brand: { name: "Mi marca", niche: "", voice: "cercano y directo", audience: "", language: "es" },
  automation: { enabled: false, intervalHours: 24, platforms: ["tiktok", "instagram", "youtube", "facebook"], maxDrafts: 3, lastRun: null },
};

export type ConfigStore = { get(): StudioConfig; set(c: StudioConfig): Promise<StudioConfig> };

type Deps = { config: ConfigStore; service: Pick<StudioService, "runAutomation">; now: () => Date; isReady: () => boolean };

/** The scheduled AI agent: when due, plans content and leaves drafts for a person to review. */
export class StudioAutomation {
  constructor(private d: Deps) {}

  async tick(): Promise<boolean> {
    const { automation } = this.d.config.get();
    if (!automation.enabled || !this.d.isReady() || !isDue(automation.lastRun, automation.intervalHours, this.d.now())) return false;
    const ok = await this.run();
    return ok;
  }

  /** Runs the agent now (manual button or scheduler). Returns false if it failed. */
  async run(): Promise<boolean> {
    const { automation } = this.d.config.get();
    let ok = true;
    try {
      await this.d.service.runAutomation({ platforms: automation.platforms, maxDrafts: automation.maxDrafts, theme: automation.theme });
    } catch (e) {
      console.warn(`[studio] automation run failed: ${(e as Error).message}`);
      ok = false;
    }
    const latest = this.d.config.get();
    await this.d.config.set({ ...latest, automation: { ...latest.automation, lastRun: this.d.now().toISOString() } });
    return ok;
  }

  async update(patch: { brand?: Partial<Brand>; automation?: Partial<StudioConfig["automation"]> }): Promise<StudioConfig> {
    const cur = this.d.config.get();
    const a = { ...cur.automation, ...patch.automation };
    a.intervalHours = Math.max(1, Math.min(168, Math.round(Number(a.intervalHours) || 24)));
    a.maxDrafts = Math.max(1, Math.min(7, Math.round(Number(a.maxDrafts) || 3)));
    a.platforms = a.platforms.filter((p) => PLATFORMS.includes(p));
    if (a.platforms.length === 0) a.platforms = [...DEFAULT_STUDIO_CONFIG.automation.platforms];
    return this.d.config.set({ ...cur, brand: { ...cur.brand, ...patch.brand }, automation: a });
  }

  getConfig = () => this.d.config.get();
}
