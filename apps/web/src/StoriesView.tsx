import { useState } from "react";
import { pipelineApi, type Pipeline, type Story } from "./api";

const STATUS: Record<Story["status"], string> = {
  candidate: "Por revisar",
  approved: "Aprobada",
  rejected: "Rechazada",
  producing: "Produciendo",
  produced: "Video listo",
  failed: "Falló",
};
const SOURCE: Record<Story["source"], string> = { original: "Original (IA)", reddit: "Reddit API", manual: "Manual" };
const FILTERS: { key: string; label: string; match: (s: Story) => boolean }[] = [
  { key: "inbox", label: "Por revisar", match: (s) => s.status === "candidate" },
  { key: "approved", label: "Aprobadas", match: (s) => s.status === "approved" },
  { key: "pipeline", label: "En video", match: (s) => ["producing", "produced", "failed"].includes(s.status) },
  { key: "rejected", label: "Rechazadas", match: (s) => s.status === "rejected" },
  { key: "all", label: "Todas", match: () => true },
];

export function StoriesView({
  pipeline,
  stories,
  refresh,
  openJob,
}: {
  pipeline: Pipeline;
  stories: Story[];
  refresh: () => void;
  openJob: (jobId: string) => void;
}) {
  const [filter, setFilter] = useState("inbox");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "", subreddit: "AskReddit", comments: "" });

  const shown = stories.filter(FILTERS.find((f) => f.key === filter)!.match);

  async function act(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      if (done) setMessage(done);
      refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function discover() {
    await act(
      "discover",
      async () => {
        const r = await pipelineApi.discover();
        setMessage(`${r.added} historia(s) nuevas.${r.errors.length ? ` ${r.errors.join(" · ")}` : ""}`);
      },
    );
  }

  async function addManual(event: React.FormEvent) {
    event.preventDefault();
    const comments = draft.comments
      .split(/\n{2,}|\n-{3,}\n/)
      .map((c) => c.trim())
      .filter(Boolean)
      .map((body) => ({ author: "anonymous", body }));
    await act("add", () => pipelineApi.addStory({ title: draft.title, body: draft.body, subreddit: draft.subreddit, comments }), "Historia agregada");
    setDraft({ title: "", body: "", subreddit: "AskReddit", comments: "" });
    setAdding(false);
  }

  return (
    <section className="panel">
      <header className="view-head">
        <div>
          <h2>Historias</h2>
          <p className="muted">
            El agente de descubrimiento escribe historias originales con Claude
            {pipeline.capabilities.reddit ? " y trae posts top de tus subreddits" : ""}; el curador las puntúa.
          </p>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => setAdding((a) => !a)}>
            + Agregar manual
          </button>
          <button className="primary" disabled={busy === "discover" || !pipeline.capabilities.claude} onClick={discover}>
            {busy === "discover" ? "Buscando…" : "Buscar historias ahora"}
          </button>
        </div>
      </header>
      {!pipeline.capabilities.claude && (
        <p className="warn">
          Las historias originales y la curación necesitan un modelo configurado para el Escritor y el Curador (Ajustes → Modelos de IA).
          Puedes agregar historias manuales.
        </p>
      )}
      {message && <p className="note">{message}</p>}

      {adding && (
        <form className="manual" onSubmit={addManual}>
          <div className="row">
            <input placeholder="r/" value={draft.subreddit} onChange={(e) => setDraft({ ...draft, subreddit: e.target.value })} style={{ maxWidth: 160 }} />
            <input required placeholder="Título" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <textarea rows={6} placeholder="Historia" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <textarea
            rows={3}
            placeholder="Comentarios (opcional, separados por una línea en blanco)"
            value={draft.comments}
            onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
          />
          <p className="hint">Usa solo textos que tengas derecho a usar (tuyos, con permiso o de dominio público).</p>
          <button className="primary" disabled={busy === "add"}>
            Guardar historia
          </button>
        </form>
      )}

      <div className="chips filters">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label} <span className="muted">{stories.filter(f.match).length}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="muted">No hay historias en esta lista.</p>}
      <ul className="cards">
        {shown.map((s) => (
          <li key={s.id} className="card">
            <div className="card-head">
              <span className={`badge ${s.status}`}>{STATUS[s.status]}</span>
              <span className="muted small">
                {SOURCE[s.source]} · r/{s.subreddit}
                {s.score ? ` · ⬆ ${s.score}` : ""}
              </span>
              {s.curation && (
                <span className={`score ${s.curation.score >= 7 ? "good" : s.curation.score >= 5 ? "mid" : "bad"}`} title={s.curation.reason}>
                  {s.curation.score}/10
                </span>
              )}
            </div>
            <h3>{s.title}</h3>
            <p className="excerpt">{s.body}</p>
            {s.curation && (
              <p className="small muted">
                {s.curation.reason}
                {s.curation.flags.map((f) => (
                  <span key={f} className="flag">
                    {f}
                  </span>
                ))}
              </p>
            )}
            {s.split && (
              <p className="small muted">
                <span className="flag parts">{s.split.parts > 1 ? `${s.split.parts} partes en TikTok/Facebook` : "1 parte"}</span> {s.split.reason}
              </p>
            )}
            {s.url && (
              <a className="small" href={s.url} target="_blank" rel="noreferrer">
                Ver en Reddit
              </a>
            )}
            {s.error && <p className="error small">{s.error}</p>}
            <div className="actions">
              {s.status === "candidate" && (
                <>
                  <button className="ghost" disabled={!!busy} onClick={() => act(s.id, () => pipelineApi.approve(s.id))}>
                    ✓ Aprobar
                  </button>
                  <button className="ghost" disabled={!!busy} onClick={() => act(s.id, () => pipelineApi.reject(s.id))}>
                    ✕ Rechazar
                  </button>
                </>
              )}
              {["candidate", "approved", "failed"].includes(s.status) && (
                <button className="ghost" disabled={!!busy} onClick={() => act(s.id, () => pipelineApi.produce(s.id), "Video en producción")}>
                  ▶ Crear video ahora
                </button>
              )}
              {s.jobId && (
                <button className="ghost" onClick={() => openJob(s.jobId!)}>
                  {s.partJobIds?.length ? "Video completo" : "Ver video"}
                </button>
              )}
              {s.partJobIds?.map((id, i) => (
                <button key={id} className="ghost" onClick={() => openJob(id)}>
                  Parte {i + 1}
                </button>
              ))}
              {s.status !== "producing" && (
                <button className="icon" title="Borrar" disabled={!!busy} onClick={() => act(s.id, () => pipelineApi.removeStory(s.id))}>
                  ✕
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
