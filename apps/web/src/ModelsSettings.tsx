import { useEffect, useState } from "react";
import { configApi, type AgentId, type AgentModel, type AIConfigView, type ProviderInput, type ProviderKind } from "./api";

const PRESETS: { label: string; name: string; kind: ProviderKind; baseUrl: string | null }[] = [
  { label: "Anthropic (oficial)", name: "Anthropic", kind: "anthropic", baseUrl: null },
  { label: "teamsoclo · Claude", name: "teamsoclo Claude", kind: "anthropic", baseUrl: "https://gpt.teamsoclo.site" },
  { label: "teamsoclo · GPT/Codex", name: "teamsoclo GPT", kind: "openai", baseUrl: "https://gpt.teamsoclo.site/v1" },
  { label: "OpenAI (oficial)", name: "OpenAI", kind: "openai", baseUrl: null },
  { label: "Personalizado", name: "Mi proveedor", kind: "openai", baseUrl: "https://" },
];

const SUGGESTED: Record<ProviderKind, string[]> = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5"],
  openai: ["gpt-5.6-sol", "gpt-astra"],
};

const EFFORT_LABEL = { low: "Bajo", medium: "Medio", high: "Alto" };

/** Models that cannot write text (image, audio, embeddings, moderation). */
const NON_TEXT = /(image|dall-e|tts|whisper|audio|embedding|moderation|transcribe)/i;
const CUSTOM = "__custom__";

type DraftProvider = ProviderInput & { keyMask: string; key: string };

export function ModelsSettings({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState<AIConfigView | null>(null);
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [agents, setAgents] = useState<Record<AgentId, AgentModel> | null>(null);
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [customModel, setCustomModel] = useState<Partial<Record<AgentId, boolean>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (c: AIConfigView) => {
    setConfig(c);
    setProviders(c.providers.map((p) => ({ ...p, key: "" })));
    setAgents(c.agents);
  };

  useEffect(() => {
    configApi.get().then(apply, (e: Error) => setMessage(e.message));
  }, []);

  async function loadModels(id: string, quiet = false) {
    if (!quiet) setStatus((s) => ({ ...s, [id]: "Probando…" }));
    try {
      const r = await configApi.testProvider(id);
      setModels((m) => ({ ...m, [id]: r.models }));
      setStatus((s) => ({ ...s, [id]: `Conexión OK · ${r.models.length} modelos disponibles` }));
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: `Error: ${(e as Error).message}` }));
    }
  }

  // Load the model list of every saved provider that has a key, so the agent selectors show real models.
  useEffect(() => {
    for (const p of config?.providers ?? []) if (p.keyMask && !models[p.id]) void loadModels(p.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  if (!config || !agents) return <p className="muted">Cargando modelos…</p>;

  const providersDirty =
    providers.length !== config.providers.length ||
    providers.some((p, i) => {
      const o = config.providers[i];
      return !o || p.key !== "" || p.apiKey === "" || p.name !== o.name || p.kind !== o.kind || p.baseUrl !== o.baseUrl;
    });
  const agentsDirty = JSON.stringify(agents) !== JSON.stringify(config.agents);

  async function run(action: () => Promise<AIConfigView>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      apply(await action());
      setMessage(done);
      onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // apiKey: a typed key replaces the stored one, "" (after "Borrar clave") removes it, undefined keeps it.
  const saveProviders = () =>
    run(
      () =>
        configApi.saveProviders(
          providers.map(({ keyMask: _m, key, apiKey, ...p }) => ({
            ...p,
            baseUrl: p.baseUrl?.trim() ? p.baseUrl.trim() : null,
            apiKey: key ? key : apiKey === "" ? "" : undefined,
          })),
        ),
      "Proveedores guardados",
    );

  /** Models an agent can use: the provider's live list minus image/audio/embedding models, else suggestions. */
  const textModels = (providerId: string): string[] => {
    const live = models[providerId]?.filter((m) => !NON_TEXT.test(m));
    if (live?.length) return live;
    const kind = providerOf(providerId)?.kind;
    return kind ? SUGGESTED[kind] : [];
  };

  function changeAgentProvider(id: AgentId, providerId: string) {
    const a = agents![id];
    const list = textModels(providerId);
    const kind = providerOf(providerId)?.kind;
    const preferred = kind ? SUGGESTED[kind].find((m) => list.includes(m)) : undefined;
    const model = list.includes(a.model) ? a.model : preferred ?? list[0] ?? a.model;
    setAgents({ ...agents!, [id]: { ...a, providerId, model } });
  }

  const update = (i: number, patch: Partial<DraftProvider>) => setProviders((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const providerOf = (id: string) => providers.find((p) => p.id === id) ?? config.providers.find((p) => p.id === id);

  return (
    <div className="models">
      <h3>Proveedores</h3>
      <p className="hint">
        Las claves se guardan en <code>data/secrets.json</code> (fuera de git) y nunca se muestran completas. Deja el campo de clave vacío para
        conservar la actual. Las pasarelas de terceros reciben todo el texto que les envías.
      </p>
      <div className="provider-list">
        {providers.map((p, i) => (
          <div key={p.id || `new-${i}`} className="provider">
            <div className="grid3">
              <label className="field">
                <span>Nombre</span>
                <input value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
              </label>
              <label className="field">
                <span>Protocolo</span>
                <select value={p.kind} onChange={(e) => update(i, { kind: e.target.value as ProviderKind })}>
                  <option value="anthropic">Anthropic (Messages API)</option>
                  <option value="openai">OpenAI-compatible (Chat Completions)</option>
                </select>
              </label>
              <label className="field">
                <span>URL base (vacío = oficial)</span>
                <input
                  placeholder={p.kind === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"}
                  value={p.baseUrl ?? ""}
                  onChange={(e) => update(i, { baseUrl: e.target.value || null })}
                />
              </label>
              <label className="field">
                <span>API key {p.keyMask ? `(guardada: ${p.keyMask})` : "(sin clave)"}</span>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={p.keyMask ? "Dejar vacío para conservar" : "sk-…"}
                  value={p.key}
                  onChange={(e) => update(i, { key: e.target.value })}
                />
              </label>
            </div>
            <div className="actions">
              {p.id && config.providers.some((c) => c.id === p.id) && (
                <button type="button" className="ghost" disabled={busy || !p.keyMask} onClick={() => loadModels(p.id)}>
                  {models[p.id] ? "Volver a probar" : "Probar conexión"}
                </button>
              )}
              {p.keyMask && (
                <button type="button" className="ghost" disabled={busy} onClick={() => update(i, { key: "", keyMask: "", apiKey: "" })}>
                  Borrar clave
                </button>
              )}
              {providers.length > 1 && (
                <button type="button" className="icon" title="Quitar proveedor" onClick={() => setProviders((list) => list.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
              {status[p.id] && <span className={`small ${status[p.id].startsWith("Error") ? "error" : "note"}`}>{status[p.id]}</span>}
            </div>
            {models[p.id] && models[p.id].length > 0 && (
              <div className="model-chips">
                {models[p.id].map((m) => (
                  <code key={m} className={NON_TEXT.test(m) ? "muted" : ""} title={NON_TEXT.test(m) ? "No es un modelo de texto" : undefined}>
                    {m}
                  </code>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="actions">
        <select
          value=""
          onChange={(e) => {
            const preset = PRESETS[Number(e.target.value)];
            if (preset) setProviders((list) => [...list, { id: "", name: preset.name, kind: preset.kind, baseUrl: preset.baseUrl, keyMask: "", key: "" }]);
          }}
          style={{ maxWidth: 260 }}
        >
          <option value="">+ Agregar proveedor…</option>
          {PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary"
          disabled={busy || !providersDirty}
          onClick={saveProviders}
        >
          Guardar proveedores
        </button>
      </div>

      <h3>Modelo por agente</h3>
      <div className="agent-table">
        {config.agentMeta.map((meta) => {
          const a = agents[meta.id];
          const live = Boolean(models[a.providerId]?.length);
          const options = textModels(a.providerId);
          const custom = customModel[meta.id] || (a.model !== "" && !options.includes(a.model));
          return (
            <div key={meta.id} className="agent-row">
              <div>
                <strong>{meta.label}</strong>
                <div className="small muted">{meta.description}</div>
                <div className={`small ${config.agentStatus[meta.id] ? "note" : "warn"}`}>
                  {config.agentStatus[meta.id] ? `Activo: ${config.agentStatus[meta.id]}` : "Sin configurar (falta clave del proveedor)"}
                </div>
              </div>
              <select value={a.providerId} onChange={(e) => changeAgentProvider(meta.id, e.target.value)}>
                {config.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {custom ? (
                <div className="row">
                  <input
                    placeholder="id del modelo"
                    value={a.model}
                    onChange={(e) => setAgents({ ...agents, [meta.id]: { ...a, model: e.target.value } })}
                  />
                  <button
                    type="button"
                    className="icon"
                    title="Elegir de la lista"
                    onClick={() => {
                      setCustomModel((c) => ({ ...c, [meta.id]: false }));
                      if (!options.includes(a.model) && options[0]) setAgents({ ...agents, [meta.id]: { ...a, model: options[0] } });
                    }}
                  >
                    ☰
                  </button>
                </div>
              ) : (
                <select
                  value={a.model}
                  title={live ? "Modelos que ofrece este proveedor" : "Sugerencias (prueba la conexión para ver los modelos reales)"}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM) setCustomModel((c) => ({ ...c, [meta.id]: true }));
                    else setAgents({ ...agents, [meta.id]: { ...a, model: e.target.value } });
                  }}
                >
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={CUSTOM}>Otro (escribir id)…</option>
                </select>
              )}
              <select value={a.effort} onChange={(e) => setAgents({ ...agents, [meta.id]: { ...a, effort: e.target.value as AgentModel["effort"] } })}>
                {(["low", "medium", "high"] as const).map((e) => (
                  <option key={e} value={e}>
                    Esfuerzo {EFFORT_LABEL[e].toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => {
          const first = agents.writer;
          setAgents(Object.fromEntries(Object.entries(agents).map(([id, a]) => [id, { ...a, providerId: first.providerId, model: first.model }])) as Record<AgentId, AgentModel>);
        }}>
          Usar el modelo del Escritor en todos
        </button>
        <button type="button" className="primary" disabled={busy || !agentsDirty} onClick={() => run(() => configApi.saveAgents(agents), "Modelos por agente guardados")}>
          Guardar modelos
        </button>
        {message && <span className={message.includes("guardad") ? "note" : "error"}>{message}</span>}
      </div>
    </div>
  );
}

export function CredentialsSettings({ group, onSaved }: { group: "reddit" | "youtube" | "tiktok" | "facebook"; onSaved: () => void }) {
  const [config, setConfig] = useState<AIConfigView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    configApi.get().then(setConfig, () => {});
  }, []);
  if (!config) return null;
  const fields = config.credentials.filter((c) => c.group === group);

  async function save(clear?: string) {
    setMessage(null);
    try {
      const payload: Record<string, string | null> = clear ? { [clear]: null } : Object.fromEntries(Object.entries(values).filter(([, v]) => v));
      setConfig(await configApi.saveCredentials(payload));
      setValues({});
      setMessage(clear ? "Credencial borrada" : "Credenciales guardadas");
      onSaved();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <div className="credentials">
      <div className="grid3">
        {fields.map((f) => (
          <label key={f.name} className="field">
            <span>
              {f.label} {f.mask ? `(guardada: ${f.mask})` : ""}
            </span>
            <div className="row">
              <input
                type="password"
                autoComplete="off"
                placeholder={f.mask ? "Dejar vacío para conservar" : ""}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              />
              {f.mask && (
                <button type="button" className="icon" title="Borrar" onClick={() => save(f.name)}>
                  ✕
                </button>
              )}
            </div>
          </label>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="ghost" disabled={!Object.values(values).some(Boolean)} onClick={() => save()}>
          Guardar credenciales
        </button>
        {message && <span className={message.includes("guardad") || message.includes("borrada") ? "note small" : "error small"}>{message}</span>}
      </div>
    </div>
  );
}
