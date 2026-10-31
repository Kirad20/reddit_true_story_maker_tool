import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { isGateway, resolveAgent, type AgentId, type ModelProvider, type ResolvedAgent } from "./aiconfig";

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

async function anthropicStructured<T>(req: StructuredRequest, r: ResolvedAgent): Promise<T> {
  const client = anthropicClient(r.provider, r.apiKey);
  const effort = NO_EFFORT.test(r.model) ? {} : { effort: r.effort };

  if (!isGateway(r.provider)) {
    const fallback = FALLBACK_MODELS.test(r.model);
    try {
      const response = await client.beta.messages
        .stream({
          model: r.model,
          max_tokens: req.maxTokens ?? 32000,
          ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          output_config: { ...effort, format: { type: "json_schema", schema: req.schema } },
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
        })
        .finalMessage();
      return parseJson<T>(anthropicText(response));
    } catch (error) {
      anthropicError(error);
    }
  }

  // Gateway: no beta features and no streaming (simplest for proxies). Try native
  // structured output first, then fall back to asking for JSON in the prompt.
  const maxTokens = Math.min(req.maxTokens ?? 16000, 16000);
  try {
    const response = await client.messages.create({
      model: r.model,
      max_tokens: maxTokens,
      output_config: { ...effort, format: { type: "json_schema", schema: req.schema } },
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    });
    return parseJson<T>(anthropicText(response));
  } catch (error) {
    if (!(error instanceof Anthropic.BadRequestError)) anthropicError(error);
  }
  try {
    const response = await client.messages.create({
      model: r.model,
      max_tokens: maxTokens,
      system: `${req.system}\n\n${jsonInstructions(req.schema)}`,
      messages: [{ role: "user", content: req.prompt }],
    });
    return parseJson<T>(anthropicText(response));
  } catch (error) {
    anthropicError(error);
  }
}

// ---------------------------------------------------------------- OpenAI-compatible (GPT / Codex models)

async function openaiStructured<T>(req: StructuredRequest, r: ResolvedAgent): Promise<T> {
  const client = openaiClient(r.provider, r.apiKey);
  try {
    const completion = await client.chat.completions.create({
      model: r.model,
      messages: [
        { role: "system", content: `${req.system}\n\n${jsonInstructions(req.schema)}` },
        { role: "user", content: req.prompt },
      ],
      response_format: { type: "json_object" },
      reasoning_effort: r.effort,
    });
    const choice = completion.choices[0];
    if (choice?.finish_reason === "length") throw new LLMError("The model's answer was cut off (input too long)");
    const text = choice?.message?.content;
    if (!text) throw new LLMError(choice?.message?.refusal ? "The model declined this request" : "The model returned no text");
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
