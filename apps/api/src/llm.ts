import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { isGateway, resolveAgent, type AgentId, type ModelProvider, type ResolvedAgent } from "./aiconfig";
import { emptyUsage, recordLlmCall, type TokenUsage } from "./telemetry";

export class LLMError extends Error {}

export type StructuredRequest = {
  /** Which agent is calling: decides provider, model and effort (Settings → Modelos). */
  agent: AgentId;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
};

/** One model call constrained to a JSON schema; returns the parsed object. */
export async function structured<T>(req: StructuredRequest): Promise<T> {
  const resolved = resolveAgent(req.agent);
  if (!resolved) throw new LLMError(`No model configured for the "${req.agent}" agent (Settings → Modelos)`);
  return resolved.provider.kind === "openai" ? openaiStructured<T>(req, resolved) : anthropicStructured<T>(req, resolved);
}

// ---------------------------------------------------------------- clients

export function anthropicClient(provider: ModelProvider, apiKey: string): Anthropic {
  // Explicit values so the SDK never falls back to ANTHROPIC_* environment variables.
  return new Anthropic({ apiKey, authToken: null, baseURL: provider.baseUrl ?? "https://api.anthropic.com" });
}

export function openaiClient(provider: ModelProvider, apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: provider.baseUrl ?? "https://api.openai.com/v1" });
}

// ---------------------------------------------------------------- Anthropic (official API or compatible gateway)

function anthropicError(error: unknown): never {
  if (error instanceof Anthropic.AuthenticationError) throw new LLMError("The model provider rejected the API key");
  if (error instanceof Anthropic.RateLimitError) throw new LLMError("Model rate limit reached, try again later");
  if (error instanceof Anthropic.APIError) throw new LLMError(`Model API error ${error.status}: ${error.message}`);
  throw error;
}

function anthropicText(response: Anthropic.Beta.BetaMessage | Anthropic.Message): string {
  if (response.stop_reason === "refusal") throw new LLMError("The model declined this request");
  if (response.stop_reason === "max_tokens") throw new LLMError("The model's answer was cut off (input too long)");
  const text = (response.content as { type: string; text?: string }[]).find((b) => b.type === "text")?.text;
  if (!text) throw new LLMError("The model returned no text");
  return text;
}

// Models that accept the server-side refusal fallback ("fallbacks": "default").
const FALLBACK_MODELS = /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/;
// Older models reject `effort`.
const NO_EFFORT = /^claude-(haiku-4|sonnet-4-5|opus-4-5|opus-4-1|opus-4-0|sonnet-4-0|3)/;

type Attempt = { text: string; usage: TokenUsage; servedModel: string | null; stopReason: string | null };

function anthropicUsage(u: Anthropic.Usage | Anthropic.Beta.BetaUsage | undefined): TokenUsage {
  return {
    ...emptyUsage(),
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
  };
}

function anthropicAttempt(response: Anthropic.Beta.BetaMessage | Anthropic.Message): Attempt {
  const base = { usage: anthropicUsage(response.usage), servedModel: response.model ?? null, stopReason: response.stop_reason ?? null };
  try {
    return { ...base, text: anthropicText(response) };
  } catch (error) {
    throw Object.assign(error as Error, { attempt: base });
  }
}

/**
 * Run one model request and record it (agent, model, tokens, cost, latency, prompt
 * and answer) for the Observabilidad tab, whether it succeeds or fails.
 */
async function observed(req: StructuredRequest, r: ResolvedAgent, mode: string, system: string, run: () => Promise<Attempt>): Promise<string> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  const base = {
    at,
    agent: req.agent,
    provider: r.provider.name,
    providerKind: r.provider.kind,
    model: r.model,
    effort: r.effort,
    mode,
    system,
    prompt: req.prompt,
  };
  try {
    const result = await run();
    recordLlmCall({ ...base, ...result, durationMs: Date.now() - started, ok: true, error: null, response: result.text });
    return result.text;
  } catch (error) {
    const partial = (error as { attempt?: Omit<Attempt, "text"> }).attempt;
    recordLlmCall({
      ...base,
      usage: partial?.usage ?? emptyUsage(),
      servedModel: partial?.servedModel ?? null,
      stopReason: partial?.stopReason ?? null,
      durationMs: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      response: null,
    });
    throw error;
  }
}

async function anthropicStructured<T>(req: StructuredRequest, r: ResolvedAgent): Promise<T> {
  const client = anthropicClient(r.provider, r.apiKey);
  const effort = NO_EFFORT.test(r.model) ? {} : { effort: r.effort };

  if (!isGateway(r.provider)) {
    const fallback = FALLBACK_MODELS.test(r.model);
    try {
      const text = await observed(req, r, "stream", req.system, async () =>
        anthropicAttempt(
          await client.beta.messages
            .stream({
              model: r.model,
              max_tokens: req.maxTokens ?? 32000,
              ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
              output_config: { ...effort, format: { type: "json_schema", schema: req.schema } },
              system: req.system,
              messages: [{ role: "user", content: req.prompt }],
            })
            .finalMessage(),
        ),
      );
      return parseJson<T>(text);
    } catch (error) {
      anthropicError(error);
    }
  }

  // Gateway: no beta features and no streaming (simplest for proxies). Try native
  // structured output first, then fall back to asking for JSON in the prompt.
  const maxTokens = Math.min(req.maxTokens ?? 16000, 16000);
  try {
    const text = await observed(req, r, "gateway", req.system, async () =>
      anthropicAttempt(
        await client.messages.create({
          model: r.model,
          max_tokens: maxTokens,
          output_config: { ...effort, format: { type: "json_schema", schema: req.schema } },
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
        }),
      ),
    );
    return parseJson<T>(text);
  } catch (error) {
    if (!(error instanceof Anthropic.BadRequestError)) anthropicError(error);
  }
  try {
    const system = `${req.system}\n\n${jsonInstructions(req.schema)}`;
    const text = await observed(req, r, "gateway-prompt-json", system, async () =>
      anthropicAttempt(
        await client.messages.create({
          model: r.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: req.prompt }],
        }),
      ),
    );
    return parseJson<T>(text);
  } catch (error) {
    anthropicError(error);
  }
}

// ---------------------------------------------------------------- OpenAI-compatible (GPT / Codex models)

async function openaiStructured<T>(req: StructuredRequest, r: ResolvedAgent): Promise<T> {
  const client = openaiClient(r.provider, r.apiKey);
  const system = `${req.system}\n\n${jsonInstructions(req.schema)}`;
  try {
    const text = await observed(req, r, "openai", system, async () => {
      const completion = await client.chat.completions.create({
        model: r.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: req.prompt },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: r.effort,
      });
      const u = completion.usage;
      const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
      const choice = completion.choices[0];
      const meta = {
        usage: {
          ...emptyUsage(),
          input: (u?.prompt_tokens ?? 0) - cached,
          output: u?.completion_tokens ?? 0,
          cacheRead: cached,
          reasoning: u?.completion_tokens_details?.reasoning_tokens ?? 0,
        },
        servedModel: completion.model ?? null,
        stopReason: choice?.finish_reason ?? null,
      };
      const fail = (message: string) => Object.assign(new LLMError(message), { attempt: meta });
      if (choice?.finish_reason === "length") throw fail("The model's answer was cut off (input too long)");
      const content = choice?.message?.content;
      if (!content) throw fail(choice?.message?.refusal ? "The model declined this request" : "The model returned no text");
      return { ...meta, text: content };
    });
    return parseJson<T>(text);
  } catch (error) {
    if (error instanceof LLMError) throw error;
    openaiError(error);
  }
}

function openaiError(error: unknown): never {
  if (error instanceof OpenAI.AuthenticationError) throw new LLMError("The model provider rejected the API key");
  if (error instanceof OpenAI.RateLimitError) throw new LLMError("Model rate limit reached, try again later");
  if (error instanceof OpenAI.APIError) throw new LLMError(`Model API error ${error.status}: ${error.message}`);
  throw error;
}

// ---------------------------------------------------------------- connection test

/** List the models a provider offers with this key (also proves the key works). */
export async function listProviderModels(provider: ModelProvider, apiKey: string): Promise<string[]> {
  try {
    if (provider.kind === "openai") {
      const page = await openaiClient(provider, apiKey).models.list();
      return page.data.map((m) => m.id).sort();
    }
    const ids: string[] = [];
    for await (const m of anthropicClient(provider, apiKey).models.list({ limit: 100 })) ids.push(m.id);
    return ids.sort();
  } catch (error) {
    return provider.kind === "openai" ? openaiError(error) : anthropicError(error);
  }
}

// ---------------------------------------------------------------- helpers

export function jsonInstructions(schema: Record<string, unknown>): string {
  return `Reply with a single JSON object that matches this JSON Schema exactly, and nothing else (no prose, no code fences):\n${JSON.stringify(schema)}`;
}

/** Parse a JSON object even when a model wraps it in prose or ```json fences. */
export function parseJson<T>(text: string): T {
  const trimmed = text.trim();
  const candidates = [trimmed, /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]];
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as T;
    } catch {
      // try the next candidate
    }
  }
  throw new LLMError("The model returned malformed JSON");
}
