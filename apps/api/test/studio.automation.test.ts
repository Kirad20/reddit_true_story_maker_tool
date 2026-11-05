import { describe, expect, it, vi } from "vitest";
import { StudioAutomation, type StudioConfig } from "../src/studio/automation";

const baseConfig = (over: Partial<StudioConfig["automation"]> = {}): StudioConfig => ({
  brand: { name: "Acme", niche: "n", voice: "v", audience: "a", language: "es" },
  automation: { enabled: true, intervalHours: 24, platforms: ["tiktok"], maxDrafts: 2, lastRun: null, ...over },
});

function build(config: StudioConfig, run = vi.fn(async () => ({ plan: { kind: "plan" as const, items: [] }, drafts: [], errors: [] }))) {
  let current = config;
  const auto = new StudioAutomation({
    config: { get: () => current, set: async (c) => ((current = c), c) },
    service: { runAutomation: run } as never,
    now: () => new Date("2026-01-02T12:00:00.000Z"),
    isReady: () => true,
  });
  return { auto, run, get: () => current };
}

describe("StudioAutomation", () => {
  it("does nothing when disabled", async () => {
    const { auto, run } = build(baseConfig({ enabled: false }));
    expect(await auto.tick()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("does nothing when not due", async () => {
    const { auto, run } = build(baseConfig({ lastRun: "2026-01-02T06:00:00.000Z" }));
    expect(await auto.tick()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs when due and records lastRun", async () => {
    const { auto, run, get } = build(baseConfig());
    expect(await auto.tick()).toBe(true);
    expect(run).toHaveBeenCalledWith({ platforms: ["tiktok"], maxDrafts: 2, theme: undefined });
    expect(get().automation.lastRun).toBe("2026-01-02T12:00:00.000Z");
  });

  it("records lastRun even when the run fails, to avoid hammering the model", async () => {
    const { auto, get } = build(baseConfig(), vi.fn(async () => { throw new Error("down"); }));
    expect(await auto.tick()).toBe(false);
    expect(get().automation.lastRun).toBe("2026-01-02T12:00:00.000Z");
  });

  it("merges config updates, validating the interval", async () => {
    const { auto, get } = build(baseConfig());
    await auto.update({ automation: { enabled: false, intervalHours: 0 } });
    expect(get().automation.enabled).toBe(false);
    expect(get().automation.intervalHours).toBeGreaterThanOrEqual(1);
  });
});
