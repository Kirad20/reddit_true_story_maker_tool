import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";

/**
 * Observability: every model call (tokens, cost, latency, prompt/answer), every
 * pipeline step (duration, outcome) and every user action (audit trail).
 * Records are appended to JSONL files in data/telemetry and the most recent ones
 * are kept in memory for the Observabilidad tab.
 */

// ---------------------------------------------------------------- context

/** What a model call or step belongs to (propagated through async calls). */
export type TraceContext = { jobId?: string; storyId?: string; trigger?: string };

const storage = new AsyncLocalStorage<TraceContext>();

export function withTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ...storage.getStore(), ...ctx }, fn);
}

export const currentTrace = (): TraceContext => storage.getStore() ?? {};

// ---------------------------------------------------------------- record types

export type LlmCall = {
  type: "llm";
  id: string;
  at: string;
  agent: string;
  provider: string;
  providerKind: "anthropic" | "openai";
  /** Model requested in Settings. */
  model: string;
  /** Model that actually answered (differs on server-side fallbacks or aliases). */
  servedModel: string | null;
  effort: string;
  /** "stream", "gateway", "gateway-prompt-json", "openai". */
  mode: string;
  durationMs: number;
  ok: boolean;
  error: string | null;
  stopReason: string | null;
  usage: TokenUsage;
  /** Estimated USD; null when the model's price is unknown. */
  costUsd: number | null;
  context: TraceContext;
  /** Truncated for the audit view. */
  system: string;
  prompt: string;
  response: string | null;
};

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** OpenAI reasoning tokens (already included in output). */
  reasoning: number;
};

export type StepSpan = {
  type: "step";
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

export type AuditEntry = {
  type: "audit";
  id: string;
  at: string;
  user: string | null;
  action: string;
  target: string | null;
  status: number;
  durationMs: number;
};

type AnyRecord = LlmCall | StepSpan | AuditEntry;

// ---------------------------------------------------------------- pricing

/** USD per million tokens. Cache write defaults to 1.25× input, cache read to 0.1× input. */
type Price = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

const PRICES: [RegExp, Price][] = [
  [/^claude-(fable|mythos)-5/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/^claude-opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/^claude-opus-(5|4-[5-8])/, { input: 5, output: 25 }],
  [/^claude-opus-4/, { input: 15, output: 75 }],
  [/^claude-sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/^claude-sonnet-4/, { input: 3, output: 15 }],
  [/^claude-haiku-5-5/, { input: 0.1, output: 0.5 }],
  [/^claude-haiku-4/, { input: 1, output: 5 }],
  [/^claude-3-5-haiku/, { input: 0.8, output: 4 }],
];

export function priceFor(model: string): Price | null {
  const id = model.replace(/^(anthropic\.|us\.anthropic\.)/, "");
  return PRICES.find(([re]) => re.test(id))?.[1] ?? null;
}

export function estimateCost(model: string, u: TokenUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  const cacheRead = p.cacheRead ?? p.input * 0.1;
  const cacheWrite = p.cacheWrite ?? p.input * 1.25;
  return (u.input * p.input + u.output * p.output + u.cacheRead * cacheRead + u.cacheWrite * cacheWrite) / 1_000_000;
}

// ---------------------------------------------------------------- storage

const DIR = path.join(DATA_DIR, "telemetry");
const FILES = { llm: "llm.jsonl", step: "steps.jsonl", audit: "audit.jsonl" } as const;
/** In-memory window per kind (older records stay on disk). */
const KEEP = 3000;
const TEXT_LIMIT = 6000;

const memory: { llm: LlmCall[]; step: StepSpan[]; audit: AuditEntry[] } = { llm: [], step: [], audit: [] };
export const telemetryEvents = new EventEmitter();
telemetryEvents.setMaxListeners(100);
let writing: Promise<void> = Promise.resolve();

export const clip = (text: string | null | undefined, limit = TEXT_LIMIT): string =>
  !text ? "" : text.length > limit ? `${text.slice(0, limit)}… [+${text.length - limit} chars]` : text;

function push(record: AnyRecord): void {
  const list = memory[record.type] as AnyRecord[];
  list.push(record);
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
  const line = `${JSON.stringify(record)}\n`;
  writing = writing
    .then(async () => {
      await fs.mkdir(DIR, { recursive: true });
      await fs.appendFile(path.join(DIR, FILES[record.type]), line);
    })
    .catch((error) => console.error("[telemetry] write failed", error));
  telemetryEvents.emit("record", record);
}

export async function loadTelemetry(): Promise<void> {
  for (const kind of Object.keys(FILES) as (keyof typeof FILES)[]) {
    try {
      const text = await fs.readFile(path.join(DIR, FILES[kind]), "utf8");
      const lines = text.trim().split("\n").slice(-KEEP);
      memory[kind] = lines.flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      }) as never;
    } catch {
      memory[kind] = [];
    }
  }
}

/** Wait for pending writes (tests). */
export const flushTelemetry = () => writing;

export function resetTelemetry(): void {
  memory.llm = [];
  memory.step = [];
  memory.audit = [];
}

// ---------------------------------------------------------------- recorders

export function recordLlmCall(call: Omit<LlmCall, "type" | "id" | "at" | "costUsd" | "context"> & { at?: string }): LlmCall {
  const record: LlmCall = {
    ...call,
    type: "llm",
    id: randomUUID(),
    at: call.at ?? new Date().toISOString(),
    costUsd: estimateCost(call.servedModel ?? call.model, call.usage),
    context: currentTrace(),
    system: clip(call.system),
    prompt: clip(call.prompt),
    response: call.response === null ? null : clip(call.response),
  };
  push(record);
  return record;
}

/** Time one pipeline step of a job; failures are recorded and re-thrown. */
export async function span<T>(jobId: string, step: string, fn: () => Promise<T>, detail?: (result: T) => string | null): Promise<T> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  const base = { type: "step" as const, id: randomUUID(), at, jobId, step, context: currentTrace() };
  try {
    const result = await fn();
    push({ ...base, durationMs: Date.now() - started, ok: true, error: null, detail: detail?.(result) ?? null });
    return result;
  } catch (error) {
    push({ ...base, durationMs: Date.now() - started, ok: false, error: error instanceof Error ? error.message : String(error), detail: null });
    throw error;
  }
}

export function recordAudit(entry: Omit<AuditEntry, "type" | "id" | "at">): void {
  push({ ...entry, type: "audit", id: randomUUID(), at: new Date().toISOString() });
}

// ---------------------------------------------------------------- queries

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 });

type Bucket = { calls: number; errors: number; usage: TokenUsage; costUsd: number; unpriced: number; durationMs: number };
const bucket = (): Bucket => ({ calls: 0, errors: 0, usage: emptyUsage(), costUsd: 0, unpriced: 0, durationMs: 0 });

function add(b: Bucket, c: LlmCall): void {
  b.calls++;
  if (!c.ok) b.errors++;
  b.usage.input += c.usage.input;
  b.usage.output += c.usage.output;
  b.usage.cacheRead += c.usage.cacheRead;
  b.usage.cacheWrite += c.usage.cacheWrite;
  b.usage.reasoning += c.usage.reasoning;
  if (c.costUsd === null) b.unpriced++;
  else b.costUsd += c.costUsd;
  b.durationMs += c.durationMs;
}

const SINCE: Record<string, number> = { "24h": 864e5, "7d": 7 * 864e5, "30d": 30 * 864e5 };

/** Totals, breakdowns and recent records for the Observabilidad tab. */
export function telemetrySummary(range: string = "7d") {
  const from = SINCE[range] ? Date.now() - SINCE[range] : 0;
  const inRange = <T extends { at: string }>(list: T[]) => list.filter((r) => new Date(r.at).getTime() >= from);
  const byTime = <T extends { at: string }>(list: T[]) => [...list].sort((a, b) => a.at.localeCompare(b.at));
  const calls = byTime(inRange(memory.llm));
  const steps = byTime(inRange(memory.step));

  const total = bucket();
  const byAgent: Record<string, Bucket> = {};
  const byModel: Record<string, Bucket> = {};
  const byDay: Record<string, Bucket> = {};
  for (const c of calls) {
    add(total, c);
    add((byAgent[c.agent] ??= bucket()), c);
    add((byModel[c.servedModel ?? c.model] ??= bucket()), c);
    add((byDay[c.at.slice(0, 10)] ??= bucket()), c);
  }

  const stepStats: Record<string, { runs: number; failures: number; totalMs: number; maxMs: number }> = {};
  for (const s of steps) {
    const st = (stepStats[s.step] ??= { runs: 0, failures: 0, totalMs: 0, maxMs: 0 });
    st.runs++;
    if (!s.ok) st.failures++;
    st.totalMs += s.durationMs;
    st.maxMs = Math.max(st.maxMs, s.durationMs);
  }

  // Cost per video: sum of model calls tagged with a job.
  const perJob: Record<string, { calls: number; costUsd: number; tokens: number }> = {};
  for (const c of calls) {
    if (!c.context.jobId) continue;
    const j = (perJob[c.context.jobId] ??= { calls: 0, costUsd: 0, tokens: 0 });
    j.calls++;
    j.costUsd += c.costUsd ?? 0;
    j.tokens += c.usage.input + c.usage.output + c.usage.cacheRead + c.usage.cacheWrite;
  }

  const light = ({ system: _s, prompt: _p, response: _r, ...rest }: LlmCall) => rest;
  return {
    range,
    total,
    byAgent,
    byModel,
    byDay: Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, b]) => ({ day, ...b })),
    steps: stepStats,
    perJob,
    recentCalls: calls.slice(-200).reverse().map(light),
    recentSteps: steps.slice(-200).reverse(),
    audit: inRange(memory.audit).slice(-300).reverse(),
  };
}

export function getLlmCall(id: string): LlmCall | undefined {
  return memory.llm.find((c) => c.id === id);
}

/** Everything recorded for one video: its steps and model calls, oldest first. */
export function jobTrace(jobId: string) {
  return {
    steps: memory.step.filter((s) => s.jobId === jobId),
    calls: memory.llm.filter((c) => c.context.jobId === jobId).map(({ system: _s, prompt: _p, response: _r, ...rest }) => rest),
  };
}
