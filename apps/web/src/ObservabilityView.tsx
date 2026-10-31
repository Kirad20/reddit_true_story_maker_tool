import { useEffect, useState } from "react";
import { observabilityApi, type Bucket, type FlowStage, type LlmCall, type Observability } from "./api";

export const STEP_LABEL: Record<string, string> = {
  fetching: "Fuente",
  scripting: "Guion",
  "voice-casting": "Elegir voz",
  tts: "Voz (TTS)",
  composing: "Composición",
  rendering: "Render MP4",
};

const AGENT_LABEL: Record<string, string> = {
  writer: "Escritor",
  curator: "Curador",
  splitter: "Divisor",
  script: "Guion",
  voice: "Director de voz",
  metadata: "Publicación",
};

export const formatTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n);
export const formatUsd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
export const formatMs = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const tokensOf = (b: Bucket) => b.usage.input + b.usage.output + b.usage.cacheRead + b.usage.cacheWrite;

type Section = "overview" | "calls" | "steps" | "audit" | "architecture";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Resumen" },
  { id: "calls", label: "Llamadas a agentes" },
  { id: "steps", label: "Pasos del pipeline" },
  { id: "audit", label: "Auditoría" },
  { id: "architecture", label: "Cómo funciona" },
];

export function ObservabilityView({ openJob }: { openJob: (jobId: string) => void }) {
  const [range, setRange] = useState("7d");
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<Observability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    observabilityApi.get(range).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [range, tick]);

  // Live: refresh (debounced) whenever a call, step or action is recorded.
  useEffect(() => {
    const source = new EventSource("/api/observability/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.onmessage = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        setTick((t) => t + 1);
      }, 1000);
    };
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="observability">
      <section className="panel">
        <header className="view-head">
          <div>
            <h2>Observabilidad y auditoría</h2>
            <p className="muted">
              Cada llamada a un agente (modelo, tokens, costo, latencia, prompt y respuesta), cada paso del pipeline y cada acción de los
              usuarios. Se guarda en <code>data/telemetry</code>.
            </p>
          </div>
          <div className="segmented">
            {["24h", "7d", "30d", "all"].map((r) => (
              <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                {r === "all" ? "Todo" : r}
              </button>
            ))}
          </div>
        </header>
        <nav className="subtabs">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? "on" : ""} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        {error && <p className="error">{error}</p>}
        {!data && !error && <p className="muted">Cargando…</p>}
      </section>

      {data && section === "overview" && <Overview data={data} openJob={openJob} />}
      {data && section === "calls" && <Calls data={data} openJob={openJob} />}
      {data && section === "steps" && <Steps data={data} openJob={openJob} />}
      {data && section === "audit" && <Audit data={data} />}
      {data && section === "architecture" && <Architecture data={data} />}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function Overview({ data, openJob }: { data: Observability; openJob: (id: string) => void }) {
  const t = data.total;
  const avg = t.calls ? t.durationMs / t.calls : 0;
  const jobs = Object.entries(data.perJob)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)
    .slice(0, 10);
  return (
    <>
      <section className="panel">
        <div className="stats kpis">
          <Kpi value={String(t.calls)} label="Llamadas a modelos" />
          <Kpi value={formatTokens(tokensOf(t))} label={`Tokens (${formatTokens(t.usage.input + t.usage.cacheRead)} in · ${formatTokens(t.usage.output)} out)`} />
          <Kpi value={formatUsd(t.costUsd)} label={t.unpriced ? `Costo estimado (+${t.unpriced} sin precio conocido)` : "Costo estimado"} />
          <Kpi value={String(t.errors)} label={`Errores (${t.calls ? ((t.errors / t.calls) * 100).toFixed(0) : 0}%)`} tone={t.errors ? "bad" : undefined} />
          <Kpi value={formatMs(Math.round(avg))} label="Latencia media" />
          <Kpi value={formatTokens(t.usage.cacheRead)} label="Tokens leídos de caché" />
        </div>
        <DailyChart days={data.byDay} />
        {data.queue.length > 0 && (
          <p className="small">
            En cola / procesando:{" "}
            {data.queue.map((q) => (
              <button key={q.id} className="link inline-link" onClick={() => openJob(q.id)}>
                {q.title ?? q.id} ({q.status}
                {q.status === "rendering" ? ` ${Math.round(q.progress * 100)}%` : ""})
              </button>
            ))}
          </p>
        )}
      </section>

      <div className="obs-grid">
        <section className="panel">
          <h2>Por agente</h2>
          <BucketTable rows={Object.entries(data.byAgent).map(([k, b]) => [AGENT_LABEL[k] ?? k, b])} />
        </section>
        <section className="panel">
          <h2>Por modelo</h2>
          <BucketTable rows={Object.entries(data.byModel).map(([k, b]) => [k, b])} />
        </section>
      </div>

      <section className="panel">
        <h2>Costo por video</h2>
        {jobs.length === 0 ? (
          <p className="muted small">Ningún video usó modelos en este periodo.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Video</th>
                <th className="num">Llamadas</th>
                <th className="num">Tokens</th>
                <th className="num">Costo</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(([id, j]) => (
                <tr key={id}>
                  <td>
                    <button className="link inline-link" onClick={() => openJob(id)}>
                      {id}
                    </button>
                  </td>
                  <td className="num">{j.calls}</td>
                  <td className="num">{formatTokens(j.tokens)}</td>
                  <td className="num">{formatUsd(j.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Kpi({ value, label, tone }: { value: string; label: string; tone?: "bad" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/** Tokens per day: one series, so no legend; hover shows the exact numbers. */
function DailyChart({ days }: { days: Observability["byDay"] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return <p className="muted small">Sin llamadas en este periodo.</p>;
  const max = Math.max(...days.map(tokensOf), 1);
  const h = hover === null ? null : days[hover];
  return (
    <figure className="daily">
      <figcaption className="small muted">Tokens por día</figcaption>
      <div className="bars" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <div key={d.day} className="bar-slot" onMouseEnter={() => setHover(i)}>
            <div className={`bar ${hover === i ? "on" : ""}`} style={{ height: `${Math.max(2, (tokensOf(d) / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-axis small muted">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
      <p className="small chart-tip">
        {h
          ? `${h.day}: ${formatTokens(tokensOf(h))} tokens · ${h.calls} llamadas · ${formatUsd(h.costUsd)}${h.errors ? ` · ${h.errors} errores` : ""}`
          : "Pasa el cursor sobre una barra para ver el detalle."}
      </p>
    </figure>
  );
}

function BucketTable({ rows }: { rows: [string, Bucket][] }) {
  if (rows.length === 0) return <p className="muted small">Sin datos.</p>;
  return (
    <table className="data">
      <thead>
        <tr>
          <th />
          <th className="num">Llamadas</th>
          <th className="num">Entrada</th>
          <th className="num">Salida</th>
          <th className="num">Caché</th>
          <th className="num">Costo</th>
          <th className="num">Latencia</th>
        </tr>
      </thead>
      <tbody>
        {rows
          .sort(([, a], [, b]) => b.costUsd - a.costUsd || b.calls - a.calls)
          .map(([name, b]) => (
            <tr key={name}>
              <td>
                {name}
                {b.errors > 0 && <span className="flag">{b.errors} err</span>}
              </td>
              <td className="num">{b.calls}</td>
              <td className="num">{formatTokens(b.usage.input)}</td>
              <td className="num">{formatTokens(b.usage.output)}</td>
              <td className="num">{formatTokens(b.usage.cacheRead + b.usage.cacheWrite)}</td>
              <td className="num">{b.unpriced === b.calls ? "—" : formatUsd(b.costUsd)}</td>
              <td className="num">{formatMs(Math.round(b.durationMs / Math.max(1, b.calls)))}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- calls

function Calls({ data, openJob }: { data: Observability; openJob: (id: string) => void }) {
  const [agent, setAgent] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [open, setOpen] = useState<LlmCall | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const agents = [...new Set(data.recentCalls.map((c) => c.agent))];
  const list = data.recentCalls.filter((c) => (!agent || c.agent === agent) && (!onlyErrors || !c.ok));

  async function show(id: string) {
    setLoading(id);
    try {
      setOpen(await observabilityApi.call(id));
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="panel">
      <div className="row filters">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">Todos los agentes</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {AGENT_LABEL[a] ?? a}
            </option>
          ))}
        </select>
        <label className="toggle">
          <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Solo errores
        </label>
      </div>
      {list.length === 0 ? (
        <p className="muted">Sin llamadas registradas.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Agente</th>
                <th>Modelo</th>
                <th>Origen</th>
                <th className="num">Entrada</th>
                <th className="num">Salida</th>
                <th className="num">Latencia</th>
                <th className="num">Costo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={c.ok ? "" : "bad"}>
                  <td className="nowrap">{new Date(c.at).toLocaleString()}</td>
                  <td>{AGENT_LABEL[c.agent] ?? c.agent}</td>
                  <td>
                    {c.servedModel ?? c.model}
                    {c.servedModel && c.servedModel !== c.model && <span className="flag parts">pedido {c.model}</span>}
                    <div className="small muted">
                      {c.provider} · esfuerzo {c.effort} · {c.mode}
                    </div>
                  </td>
                  <td className="small">
                    {c.context.jobId ? (
                      <button className="link inline-link" onClick={() => openJob(c.context.jobId!)}>
                        video {c.context.jobId}
                      </button>
                    ) : c.context.storyId ? (
                      `historia ${c.context.storyId}`
                    ) : (
                      c.context.trigger ?? "—"
                    )}
                  </td>
                  <td className="num">{formatTokens(c.usage.input + c.usage.cacheRead + c.usage.cacheWrite)}</td>
                  <td className="num">
                    {formatTokens(c.usage.output)}
                    {c.usage.reasoning > 0 && <div className="small muted">{formatTokens(c.usage.reasoning)} razon.</div>}
                  </td>
                  <td className="num">{formatMs(c.durationMs)}</td>
                  <td className="num">{formatUsd(c.costUsd)}</td>
                  <td>
                    <button className="ghost" disabled={loading === c.id} onClick={() => show(c.id)}>
                      {c.ok ? "Ver" : "⚠ Ver"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <CallDetail call={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function CallDetail({ call, onClose }: { call: LlmCall; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body panel" onClick={(e) => e.stopPropagation()}>
        <header className="view-head">
          <h2>
            {AGENT_LABEL[call.agent] ?? call.agent} · {call.servedModel ?? call.model}
          </h2>
          <button className="ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <p className="small muted">
          {new Date(call.at).toLocaleString()} · {call.provider} ({call.providerKind}) · esfuerzo {call.effort} · {call.mode} · {formatMs(call.durationMs)} ·
          parada: {call.stopReason ?? "—"}
        </p>
        <p className="small">
          Entrada {call.usage.input} · salida {call.usage.output} · caché leída {call.usage.cacheRead} · caché escrita {call.usage.cacheWrite}
          {call.usage.reasoning ? ` · razonamiento ${call.usage.reasoning}` : ""} · <b>{formatUsd(call.costUsd)}</b>
        </p>
        {call.error && <p className="error">{call.error}</p>}
        <h3>System</h3>
        <pre className="code">{call.system}</pre>
        <h3>Prompt</h3>
        <pre className="code">{call.prompt}</pre>
        <h3>Respuesta</h3>
        <pre className="code">{call.response ?? "(sin respuesta)"}</pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- steps

function Steps({ data, openJob }: { data: Observability; openJob: (id: string) => void }) {
  const order = ["fetching", "scripting", "voice-casting", "tts", "composing", "rendering"];
  const names = Object.keys(data.steps).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <>
      <section className="panel">
        <h2>Duración por paso</h2>
        {names.length === 0 ? (
          <p className="muted small">Sin pasos registrados.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Paso</th>
                <th className="num">Ejecuciones</th>
                <th className="num">Fallos</th>
                <th className="num">Media</th>
                <th className="num">Máximo</th>
              </tr>
            </thead>
            <tbody>
              {names.map((n) => {
                const s = data.steps[n];
                return (
                  <tr key={n}>
                    <td>{STEP_LABEL[n] ?? n}</td>
                    <td className="num">{s.runs}</td>
                    <td className="num">{s.failures}</td>
                    <td className="num">{formatMs(Math.round(s.totalMs / s.runs))}</td>
                    <td className="num">{formatMs(s.maxMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Últimos pasos</h2>
        <ul className="timeline">
          {data.recentSteps.map((s) => (
            <li key={s.id} className={s.ok ? "ok" : "bad"}>
              <time>{new Date(s.at).toLocaleString()}</time>
              <button className="link inline-link" onClick={() => openJob(s.jobId)}>
                {s.jobId}
              </button>{" "}
              · <b>{STEP_LABEL[s.step] ?? s.step}</b> · {formatMs(s.durationMs)}
              {s.detail ? ` · ${s.detail}` : ""}
              {s.error && <span className="error"> · {s.error}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- audit

function Audit({ data }: { data: Observability }) {
  return (
    <section className="panel">
      <h2>Acciones de usuarios</h2>
      <p className="small muted">Todo cambio hecho por la API: quién, qué, sobre qué y con qué resultado.</p>
      {data.audit.length === 0 ? (
        <p className="muted small">Sin acciones registradas.</p>
      ) : (
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Objeto</th>
                <th className="num">Resultado</th>
                <th className="num">Tiempo</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((a) => (
                <tr key={a.id} className={a.status >= 400 ? "bad" : ""}>
                  <td className="nowrap">{new Date(a.at).toLocaleString()}</td>
                  <td>{a.user ?? "—"}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>{a.target ?? ""}</td>
                  <td className="num">{a.status}</td>
                  <td className="num">{formatMs(a.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- architecture

function Architecture({ data }: { data: Observability }) {
  const agent = (id: string | null) => data.agents.find((a) => a.id === id);
  const stage = (s: FlowStage) => {
    const a = agent(s.agent);
    const stats = s.step ? data.steps[s.step] : null;
    const usage = s.agent ? data.byAgent[s.agent] : null;
    return (
      <li key={s.id} className="stage">
        <strong>{s.label}</strong>
        <p className="small">{s.description}</p>
        {a && (
          <p className="small">
            🤖 {a.label}: {a.model ?? <span className="warn-inline">sin modelo</span>}
          </p>
        )}
        <p className="small muted">
          {stats ? `${stats.runs} ejecuciones · media ${formatMs(Math.round(stats.totalMs / stats.runs))}` : ""}
          {usage ? `${stats ? " · " : ""}${usage.calls} llamadas · ${formatUsd(usage.costUsd)}` : ""}
        </p>
        <code className="small">{s.where}</code>
      </li>
    );
  };
  return (
    <>
      <section className="panel">
        <h2>Cómo funciona por dentro</h2>
        <p className="small muted">
          El pipeline automático descubre y cura historias, produce los videos y los publica. Cada video pasa por una cola única (voz y render usan toda la
          CPU, así que va uno a la vez). Piloto automático: {data.pipeline.enabled ? "activo" : "apagado"}
          {data.pipeline.lastCycle ? ` · último ciclo ${new Date(data.pipeline.lastCycle).toLocaleString()}` : ""}.
        </p>
        <h3>1 · Historias</h3>
        <ol className="flow">{data.flow.pipeline.map(stage)}</ol>
        <h3>2 · Producción de cada video</h3>
        <ol className="flow">{data.flow.video.map(stage)}</ol>
        <h3>3 · Publicación</h3>
        <ol className="flow">{data.flow.publishing.map(stage)}</ol>
      </section>
      <section className="panel">
        <h2>Agentes configurados</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Agente</th>
              <th>Qué hace</th>
              <th>Modelo</th>
            </tr>
          </thead>
          <tbody>
            {data.agents.map((a) => (
              <tr key={a.id}>
                <td>{a.label}</td>
                <td className="small">{a.description}</td>
                <td>{a.model ?? <span className="muted">sin modelo (Ajustes → Modelos de IA)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
