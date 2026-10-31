import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AI,
  agentLabel,
  agentReady,
  aiConfig,
  mask,
  reconcileAgents,
  resolveAgent,
  secrets,
  setSecrets,
  type AIConfig,
} from "../src/aiconfig";
import { parseJson, structured } from "../src/llm";

const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

type Call = { url: string; body: Record<string, any>; headers: Headers };
let calls: Call[] = [];

function mockFetch(responses: ((call: Call) => Response)[]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const call = { url, body: JSON.parse(String(init?.body ?? "{}")), headers: new Headers(init?.headers) };
      calls.push(call);
      return responses[Math.min(calls.length - 1, responses.length - 1)](call);
    }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "request-id": "req_test" } });

const anthropicMessage = (text: string) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});

const GATEWAY: AIConfig["providers"][number] = { id: "soclo", name: "teamsoclo Claude", kind: "anthropic", baseUrl: "https://gpt.teamsoclo.site" };
const GPT: AIConfig["providers"][number] = { id: "gpt", name: "teamsoclo GPT", kind: "openai", baseUrl: "https://gpt.teamsoclo.site/v1" };

beforeEach(async () => {
  await aiConfig.set(structuredClone(DEFAULT_AI));
  await secrets.set({});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseJson", () => {
  it("accepts plain JSON, fenced JSON and JSON wrapped in prose", () => {
    expect(parseJson('{"ok":true}')).toEqual({ ok: true });
    expect(parseJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseJson('Here you go: {"ok":true} enjoy')).toEqual({ ok: true });
    expect(() => parseJson("nope")).toThrow(/malformed/);
  });
});

describe("per-agent configuration", () => {
  it("is not ready until the provider has a key", async () => {
    expect(agentReady("writer")).toBe(false);
    await setSecrets({ "provider:anthropic": "sk-ant-123456" });
    expect(agentReady("writer")).toBe(true);
    expect(agentLabel("writer")).toBe("claude-opus-5-5 · Anthropic");
  });

  it("resolves a different provider and model per agent", async () => {
    await aiConfig.set({
      providers: [...DEFAULT_AI.providers, GPT],
      agents: { ...DEFAULT_AI.agents, curator: { providerId: "gpt", model: "gpt-5.6-sol", effort: "high" } },
    });
    await setSecrets({ "provider:anthropic": "sk-a", "provider:gpt": "sk-g" });
    expect(resolveAgent("writer")?.provider.id).toBe("anthropic");
    expect(resolveAgent("curator")).toMatchObject({ model: "gpt-5.6-sol", effort: "high", apiKey: "sk-g" });
  });

  it("removes keys set to empty and masks what it shows", async () => {
    await setSecrets({ redditapis_key: "abcdef123456" });
    expect(mask(secrets.get().redditapis_key)).toBe("••••3456");
    await setSecrets({ redditapis_key: "" });
    expect(secrets.get().redditapis_key).toBeUndefined();
  });

  it("moves agents of a removed provider to the remaining one with a matching default model", () => {
    const agents = { ...DEFAULT_AI.agents, curator: { providerId: "gpt", model: "gpt-5.6-sol", effort: "high" as const } };
    const next = reconcileAgents(agents, DEFAULT_AI.providers);
    expect(next.curator).toEqual({ providerId: "anthropic", model: "claude-opus-5-5", effort: "high" });
    expect(next.writer).toEqual(DEFAULT_AI.agents.writer);
  });

  it("refuses to call a model for an agent without configuration", async () => {
    await expect(structured({ agent: "writer", system: "s", prompt: "p", schema })).rejects.toThrow(/No model configured/);
  });
});

describe("Anthropic-compatible gateway (teamsoclo Claude)", () => {
  it("uses bearer auth, no beta features, and falls back to prompt JSON", async () => {
    await aiConfig.set({ providers: [GATEWAY], agents: { ...DEFAULT_AI.agents, script: { providerId: "soclo", model: "claude-opus-5-5", effort: "low" } } });
    await setSecrets({ "provider:soclo": "sk-gateway" });
    mockFetch([
      () => json({ type: "error", error: { type: "invalid_request_error", message: "output_config not supported" } }, 400),
      () => json(anthropicMessage('Sure! {"ok": true}')),
    ]);
    const result = await structured<{ ok: boolean }>({ agent: "script", system: "s", prompt: "p", schema });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://gpt.teamsoclo.site/v1/messages");
    expect(calls[0].headers.get("authorization")).toBe("Bearer sk-gateway");
    expect(calls[0].headers.get("anthropic-beta")).toBeNull();
    expect(calls[0].body.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
    expect(calls[1].body.output_config).toBeUndefined();
    expect(calls[1].body.system).toContain("JSON Schema");
  });
});

describe("Anthropic official API", () => {
  it("sends the key, the agent's effort and the refusal fallback for supported models", async () => {
    await aiConfig.set({ ...DEFAULT_AI, agents: { ...DEFAULT_AI.agents, writer: { providerId: "anthropic", model: "claude-opus-5-5", effort: "medium" } } });
    await setSecrets({ "provider:anthropic": "sk-ant" });
    const sse = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { ...anthropicMessage(""), content: [], stop_reason: null } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"ok":true}' } })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");
    mockFetch([() => new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream", "request-id": "req_1" } })]);
    const result = await structured<{ ok: boolean }>({ agent: "writer", system: "s", prompt: "p", schema });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toContain("https://api.anthropic.com/v1/messages");
    expect(calls[0].headers.get("authorization")).toBe("Bearer sk-ant");
    expect(calls[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "medium" } });
  });
});

describe("OpenAI-compatible provider (teamsoclo GPT / Codex)", () => {
  beforeEach(async () => {
    await aiConfig.set({ providers: [GPT], agents: { ...DEFAULT_AI.agents, metadata: { providerId: "gpt", model: "gpt-5.6-sol", effort: "medium" } } });
  });

  it("calls chat completions in JSON mode with the agent's model and effort", async () => {
    await setSecrets({ "provider:gpt": "sk-gpt" });
    mockFetch([
      () =>
        json({
          id: "c1",
          object: "chat.completion",
          created: 0,
          model: "gpt-5.6-sol",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"ok":true}', refusal: null } }],
        }),
    ]);
    const result = await structured<{ ok: boolean }>({ agent: "metadata", system: "s", prompt: "p", schema });
    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://gpt.teamsoclo.site/v1/chat/completions");
    expect(calls[0].headers.get("authorization")).toBe("Bearer sk-gpt");
    expect(calls[0].body).toMatchObject({ model: "gpt-5.6-sol", response_format: { type: "json_object" }, reasoning_effort: "medium" });
  });

  it("reports auth errors clearly", async () => {
    await setSecrets({ "provider:gpt": "sk-bad" });
    mockFetch([() => json({ error: { message: "bad key" } }, 401)]);
    await expect(structured({ agent: "metadata", system: "s", prompt: "p", schema })).rejects.toThrow(/rejected the API key/);
  });
});
