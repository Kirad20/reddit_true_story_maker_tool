import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI, aiConfig, secrets, setSecrets } from "../src/aiconfig";
import { structured } from "../src/llm";
import { estimateCost, jobTrace, resetTelemetry, span, telemetrySummary, withTrace } from "../src/telemetry";
import { chooseVoice, heuristicVoice } from "../src/voice";

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const VOICES = ["af_heart", "af_bella", "am_adam", "am_michael", "bf_emma", "ef_dora", "em_alex"];

function mockFetch(handler: (body: Record<string, any>) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => handler(JSON.parse(String(init?.body ?? "{}")))),
  );
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const openaiAnswer = (content: string, usage = { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } }) =>
  json({
    id: "c1",
    object: "chat.completion",
    created: 0,
    model: "gpt-5.6-sol",
    usage,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, refusal: null } }],
  });

const GPT = { id: "gpt", name: "GPT", kind: "openai" as const, baseUrl: "https://example.test/v1" };
const GATEWAY = { id: "gw", name: "Gateway", kind: "anthropic" as const, baseUrl: "https://gw.example.test" };

beforeEach(async () => {
  resetTelemetry();
  await aiConfig.set(structuredClone(DEFAULT_AI));
  await secrets.set({});
});

afterEach(() => vi.unstubAllGlobals());

describe("cost estimate", () => {
  it("prices Claude models per million tokens, including cache", () => {
    const usage = { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 0, reasoning: 0 };
    expect(estimateCost("claude-opus-5-5", usage)).toBeCloseTo(4 + 2 + 0.2);
    expect(estimateCost("claude-sonnet-5-5", usage)).toBeCloseTo(2 + 1 + 0.2);
    expect(estimateCost("gpt-5.6-sol", usage)).toBeNull();
  });
});

describe("model call telemetry", () => {
  it("records agent, model, tokens, cost and the job that made the call", async () => {
    await aiConfig.set({ providers: [GATEWAY], agents: { ...DEFAULT_AI.agents, script: { providerId: "gw", model: "claude-opus-5-5", effort: "low" } } });
    await setSecrets({ "provider:gw": "k" });
    mockFetch(() =>
      json({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: '{"ok":true}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    );
    await withTrace({ jobId: "job-1" }, () => structured({ agent: "script", system: "sys", prompt: "hello", schema }));
    const summary = telemetrySummary("24h");
    expect(summary.total.calls).toBe(1);
    expect(summary.total.usage).toMatchObject({ input: 1000, output: 500 });
    expect(summary.byAgent.script.costUsd).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6);
    expect(summary.recentCalls[0]).toMatchObject({ agent: "script", model: "claude-opus-5-5", ok: true, context: { jobId: "job-1" } });
    expect(jobTrace("job-1").calls).toHaveLength(1);
  });

  it("records failed calls with their error", async () => {
    await aiConfig.set({ providers: [GPT], agents: { ...DEFAULT_AI.agents, metadata: { providerId: "gpt", model: "gpt-5.6-sol", effort: "low" } } });
    await setSecrets({ "provider:gpt": "bad" });
    mockFetch(() => json({ error: { message: "nope" } }, 401));
    await expect(structured({ agent: "metadata", system: "s", prompt: "p", schema })).rejects.toThrow();
    const summary = telemetrySummary("24h");
    expect(summary.total).toMatchObject({ calls: 1, errors: 1 });
    expect(summary.recentCalls[0].error).toMatch(/401/);
  });

  it("times pipeline steps", async () => {
    await span("job-2", "tts", async () => "x");
    await expect(span("job-2", "rendering", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const { steps } = telemetrySummary("24h");
    expect(steps.tts).toMatchObject({ runs: 1, failures: 0 });
    expect(steps.rendering).toMatchObject({ runs: 1, failures: 1 });
  });
});

describe("automatic voice", () => {
  const story = (text: string) => [
    { kind: "title" as const, text: "AITA?" },
    { kind: "post" as const, text },
  ];

  it("guesses the narrator from the text when no model is set", () => {
    expect(heuristicVoice(story("My husband forgot our anniversary."), "en", VOICES, "af_heart").voice).toBe("af_heart");
    expect(heuristicVoice(story("My wife sold my car."), "en", VOICES, "af_heart").voice[1]).toBe("m");
    expect(heuristicVoice(story("Mi esposa vendió mi coche."), "es", VOICES, "ef_dora").voice).toBe("em_alex");
    expect(heuristicVoice(story("A thing happened."), "en", VOICES, "af_heart")).toMatchObject({ voice: "af_heart", by: "default" });
  });

  it("lets the voice director pick from the language's voices", async () => {
    await aiConfig.set({ providers: [GPT], agents: { ...DEFAULT_AI.agents, voice: { providerId: "gpt", model: "gpt-5.6-sol", effort: "low" } } });
    await setSecrets({ "provider:gpt": "k" });
    let prompt = "";
    mockFetch((body) => {
      prompt = body.messages[1].content;
      return openaiAnswer(JSON.stringify({ voice: "am_adam", narrator: "male", tone: "tense", reason: "Male narrator in a tense story." }));
    });
    const choice = await chooseVoice({ blocks: story("I heard steps behind me."), language: "en", available: VOICES, fallback: "af_heart" });
    expect(choice).toMatchObject({ voice: "am_adam", by: "agent" });
    expect(prompt).toContain("bf_emma");
    expect(prompt).not.toContain("ef_dora");
  });

  it("falls back when the director invents a voice", async () => {
    await aiConfig.set({ providers: [GPT], agents: { ...DEFAULT_AI.agents, voice: { providerId: "gpt", model: "gpt-5.6-sol", effort: "low" } } });
    await setSecrets({ "provider:gpt": "k" });
    mockFetch(() => openaiAnswer(JSON.stringify({ voice: "zz_ghost", narrator: "unclear", tone: "", reason: "" })));
    const choice = await chooseVoice({ blocks: story("Something."), language: "en", available: VOICES, fallback: "af_heart" });
    expect(choice.voice).toBe("af_heart");
    expect(choice.warning).toMatch(/unknown voice/);
  });
});
