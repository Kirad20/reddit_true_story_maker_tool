import { randomUUID } from "node:crypto";
import { Doc } from "./store";

// ---------------------------------------------------------------- model providers + per-agent models

export type ProviderKind = "anthropic" | "openai";

export type ModelProvider = {
  id: string;
  name: string;
  /** Wire protocol: Anthropic Messages API or OpenAI-compatible Chat Completions. */
  kind: ProviderKind;
  /** null = the vendor's official endpoint. Anthropic gateways go without /v1, OpenAI ones with it. */
  baseUrl: string | null;
};

export type AgentId = "writer" | "curator" | "splitter" | "script" | "voice" | "metadata";
export const AGENTS: { id: AgentId; label: string; description: string }[] = [
  { id: "writer", label: "Escritor", description: "Escribe las historias originales" },
  { id: "curator", label: "Curador", description: "Puntúa y filtra historias" },
  { id: "splitter", label: "Divisor en partes", description: "Decide si y dónde cortar para TikTok/Facebook/Instagram" },
  { id: "script", label: "Guion y traducción", description: "Reescribe el guion y traduce al español" },
  { id: "voice", label: "Director de voz", description: "Elige la voz que mejor encaja con cada historia (voz automática)" },
  { id: "metadata", label: "Publicación", description: "Títulos, descripciones y hashtags" },
];

export type Effort = "low" | "medium" | "high";

/** Model an agent falls back to when its provider is removed. */
export const DEFAULT_MODEL: Record<ProviderKind, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5.6-sol" };
export type AgentModel = { providerId: string; model: string; effort: Effort };

export type AIConfig = { providers: ModelProvider[]; agents: Record<AgentId, AgentModel> };

const DEFAULT_PROVIDER: ModelProvider = { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: null };
const agent = (effort: Effort): AgentModel => ({ providerId: "anthropic", model: "claude-opus-5-5", effort });

export const DEFAULT_AI: AIConfig = {
  providers: [DEFAULT_PROVIDER],
  agents: { writer: agent("medium"), curator: agent("low"), splitter: agent("low"), script: agent("low"), voice: agent("low"), metadata: agent("low") },
};

export const aiConfig = new Doc<AIConfig>("ai", DEFAULT_AI);

// ---------------------------------------------------------------- secrets (never sent to the browser)

export const CREDENTIALS = [
  { name: "redditapis_key", group: "reddit", label: "redditapis.com API key" },
  { name: "reddit_client_id", group: "reddit", label: "Reddit API client id (acceso aprobado)" },
  { name: "reddit_client_secret", group: "reddit", label: "Reddit API client secret" },
  { name: "zernio_api_key", group: "zernio", label: "Zernio API key" },
] as const;
export type CredentialName = (typeof CREDENTIALS)[number]["name"];

export const secrets = new Doc<Record<string, string>>("secrets", {});

export const secret = (name: CredentialName | `provider:${string}`): string => secrets.get()[name] ?? "";

export async function setSecrets(values: Record<string, string | null | undefined>): Promise<void> {
  const next = { ...secrets.get() };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue; // untouched field
    if (value === null || value === "") delete next[key];
    else next[key] = value.trim();
  }
  await secrets.set(next);
}

/** "••••abcd": enough to recognise a key without exposing it. */
export const mask = (value: string): string => (value ? `••••${value.slice(-4)}` : "");

// ---------------------------------------------------------------- resolution

export type ResolvedAgent = { provider: ModelProvider; apiKey: string; model: string; effort: Effort };

export function resolveAgent(id: AgentId): ResolvedAgent | null {
  const cfg = aiConfig.get();
  const choice = cfg.agents[id];
  const provider = cfg.providers.find((p) => p.id === choice?.providerId);
  const apiKey = provider ? secret(`provider:${provider.id}`) : "";
  if (!choice || !provider || !apiKey || !choice.model.trim()) return null;
  return { provider, apiKey, model: choice.model.trim(), effort: choice.effort };
}

export const agentReady = (id: AgentId): boolean => resolveAgent(id) !== null;

/** Agents whose provider was removed move to the first remaining provider with its default model. */
export function reconcileAgents(agents: AIConfig["agents"], providers: ModelProvider[]): AIConfig["agents"] {
  return Object.fromEntries(
    Object.entries(agents).map(([id, a]) => [
      id,
      providers.some((p) => p.id === a.providerId) ? a : { ...a, providerId: providers[0].id, model: DEFAULT_MODEL[providers[0].kind] },
    ]),
  ) as AIConfig["agents"];
}

export function agentLabel(id: AgentId): string | null {
  const r = resolveAgent(id);
  return r ? `${r.model} · ${r.provider.name}` : null;
}

/** Anthropic provider pointing somewhere other than api.anthropic.com (no beta features there). */
export const isGateway = (p: ModelProvider): boolean => Boolean(p.baseUrl && !/^https:\/\/api\.anthropic\.com/.test(p.baseUrl));

export const newProviderId = () => `p_${randomUUID().slice(0, 8)}`;

export async function loadAIConfig(): Promise<void> {
  await Promise.all([aiConfig.load(), secrets.load()]);
  await importLegacyEnv();
}

/**
 * One-time move of credentials from the old .env variables into Settings.
 * Only fills values that are not already stored; the .env lines can then be deleted.
 */
async function importLegacyEnv(): Promise<void> {
  const env = process.env;
  const current = secrets.get();
  const values: Record<string, string> = {};
  const legacy: [CredentialName, string | undefined][] = [
    ["redditapis_key", env.REDDITAPIS_KEY],
    ["reddit_client_id", env.REDDIT_CLIENT_ID],
    ["reddit_client_secret", env.REDDIT_CLIENT_SECRET],
    ["zernio_api_key", env.ZERNIO_API_KEY],
  ];
  for (const [name, value] of legacy) if (value && !current[name]) values[name] = value;

  const cfg = aiConfig.get();
  const providers = [...cfg.providers];
  const addProvider = (p: ModelProvider, key: string) => {
    if (providers.some((x) => x.kind === p.kind && x.baseUrl === p.baseUrl) || current[`provider:${p.id}`]) return;
    providers.push(p);
    values[`provider:${p.id}`] = key;
  };
  if (env.ANTHROPIC_API_KEY && !current["provider:anthropic"]) values["provider:anthropic"] = env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_AUTH_TOKEN && env.ANTHROPIC_BASE_URL) {
    addProvider({ id: "env_gateway", name: "Pasarela Anthropic (.env)", kind: "anthropic", baseUrl: env.ANTHROPIC_BASE_URL }, env.ANTHROPIC_AUTH_TOKEN);
  }
  if (env.OPENAI_API_KEY) {
    addProvider({ id: "env_openai", name: "OpenAI-compatible (.env)", kind: "openai", baseUrl: env.OPENAI_BASE_URL ?? null }, env.OPENAI_API_KEY);
  }
  if (Object.keys(values).length === 0) return;
  await secrets.set({ ...current, ...values });
  if (providers.length !== cfg.providers.length) await aiConfig.set({ ...cfg, providers });
  console.log(`[config] Imported ${Object.keys(values).length} credential(s) from .env into Settings; you can remove them from .env`);
}
