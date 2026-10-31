import { structured } from "./claude";
import { agentReady } from "./aiconfig";
import { estimateSeconds } from "./script";

export type PartsConfig = {
  enabled: boolean;
  /** Stories whose narration is longer than this are considered for splitting. */
  splitAboveSec: number;
  /** No part may be shorter than this. */
  minPartSec: number;
  maxParts: 2 | 3;
};

export type SplitPlan = {
  /** One body per part; a single entry means "do not split". */
  parts: string[];
  reason: string;
  by: "agent" | "heuristic" | "disabled";
};

/** Split prose into sentences, keeping punctuation and closing quotes. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s*\n+\s*/g, " ")
    .split(/(?<=[.!?…]["')\]]*)\s+(?=["'(\[]?[A-ZÁÉÍÓÚÑ¿¡0-9])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applyCuts(list: string[], cutAfter: number[]): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const cut of [...cutAfter, list.length - 1]) {
    parts.push(list.slice(start, cut + 1).join(" "));
    start = cut + 1;
  }
  return parts.filter(Boolean);
}

/** Cuts must be increasing, inside the text, and leave every part long enough. */
export function validCuts(list: string[], cutAfter: number[], minPartSec: number, maxParts: number): boolean {
  if (cutAfter.length === 0 || cutAfter.length > maxParts - 1) return false;
  for (let i = 0; i < cutAfter.length; i++) {
    const c = cutAfter[i];
    if (!Number.isInteger(c) || c < 0 || c >= list.length - 1) return false;
    if (i > 0 && c <= cutAfter[i - 1]) return false;
  }
  return applyCuts(list, cutAfter).every((p) => estimateSeconds(p) >= minPartSec);
}

/** Even split by length at sentence boundaries. */
export function heuristicCuts(list: string[], cfg: PartsConfig): number[] {
  const total = estimateSeconds(list.join(" "));
  let n = Math.min(cfg.maxParts, Math.max(2, Math.ceil(total / Math.max(cfg.splitAboveSec * 0.8, cfg.minPartSec))));
  while (n > 1 && total / n < cfg.minPartSec) n--;
  if (n < 2) return [];

  const lengths = list.map((s) => estimateSeconds(s));
  const cuts: number[] = [];
  let acc = 0;
  for (let i = 0; i < list.length - 1 && cuts.length < n - 1; i++) {
    acc += lengths[i];
    if (acc >= (total * (cuts.length + 1)) / n) cuts.push(i);
  }
  return validCuts(list, cuts, cfg.minPartSec, cfg.maxParts) ? cuts : [];
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    split: { type: "boolean" },
    cutAfter: { type: "array", items: { type: "integer" } },
    reason: { type: "string" },
  },
  required: ["split", "cutAfter", "reason"],
  additionalProperties: false,
};

const PLANNER_SYSTEM = `You plan multi-part releases of narrated story videos for TikTok and Facebook Reels.
Splitting a long story into parts makes viewers follow the account for the next part, but a bad cut loses them.
Split only when the story is long enough and has natural cliffhanger moments; otherwise keep it in one part.
Cut right after a sentence that leaves a strong open question (a reveal about to happen, a confrontation starting, a "and then I saw..." moment).
Never cut mid-scene in a way that confuses, and never right before the last one or two sentences.`;

async function claudeCuts(title: string, list: string[], cfg: PartsConfig): Promise<{ cuts: number[]; reason: string } | null> {
  const numbered = list.map((s, i) => `${i}: ${s}`).join("\n");
  const total = Math.round(estimateSeconds(list.join(" ")));
  const result = await structured<{ split: boolean; cutAfter: number[]; reason: string }>({
    agent: "splitter",
    system: PLANNER_SYSTEM,
    prompt: [
      `Title: ${title}`,
      `Estimated narration: ${total} seconds. Each part must be at least ${cfg.minPartSec} seconds; at most ${cfg.maxParts} parts.`,
      `Return split=false with an empty cutAfter to keep one part. To split, return the sentence numbers AFTER which to cut (${cfg.maxParts === 3 ? "one or two numbers" : "one number"}).`,
      `Give the reason in one short sentence in Spanish.`,
      `Sentences:\n${numbered}`,
    ].join("\n\n"),
    schema: PLAN_SCHEMA,
  });
  if (!result.split) return { cuts: [], reason: result.reason };
  const cuts = [...new Set(result.cutAfter)].sort((a, b) => a - b);
  return validCuts(list, cuts, cfg.minPartSec, cfg.maxParts) ? { cuts, reason: result.reason } : null;
}

/** Decide whether (and where) a story body is split into parts for TikTok and Facebook. */
export async function planSplit(title: string, body: string, cfg: PartsConfig): Promise<SplitPlan> {
  const list = sentences(body);
  if (!cfg.enabled) return { parts: [body], reason: "División en partes desactivada", by: "disabled" };
  const total = estimateSeconds(`${title} ${body}`);
  if (total <= cfg.splitAboveSec || list.length < 4) {
    return { parts: [body], reason: `Historia corta (~${Math.round(total)} s): va en una sola parte`, by: "heuristic" };
  }

  if (agentReady("splitter")) {
    try {
      const planned = await claudeCuts(title, list, cfg);
      if (planned) {
        return planned.cuts.length
          ? { parts: applyCuts(list, planned.cuts), reason: planned.reason, by: "agent" }
          : { parts: [body], reason: planned.reason, by: "agent" };
      }
    } catch {
      // Fall through to the heuristic.
    }
  }
  const cuts = heuristicCuts(list, cfg);
  return cuts.length
    ? { parts: applyCuts(list, cuts), reason: `Dividida por duración (~${Math.round(total)} s) en ${cuts.length + 1} partes`, by: "heuristic" }
    : { parts: [body], reason: "No hay un punto de corte que deje partes suficientemente largas", by: "heuristic" };
}
