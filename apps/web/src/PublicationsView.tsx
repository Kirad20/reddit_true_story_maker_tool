import { useState } from "react";
import { PLATFORM_LABEL, pipelineApi, type Publication } from "./api";
import { TikTokComposer } from "./TikTokComposer";

const STATUS: Record<Publication["status"], string> = {
  needs_review: "Revisar",
  scheduled: "Programada",
  publishing: "Publicando",
  published: "Publicada",
  failed: "Falló",
  canceled: "Cancelada",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

function PublicationCard({
  pub,
  refresh,
  openJob,
  tiktokReview,
}: {
  pub: Publication;
  refresh: () => void;
  openJob: (id: string) => void;
  tiktokReview: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  // Feature flag: TikTok posts go only through the Direct Post screen (TikTok app review).
  const directPost = tiktokReview && pub.platform === "tiktok";
  const [title, setTitle] = useState(pub.title);
  const [description, setDescription] = useState(pub.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = !["publishing", "published"].includes(pub.status);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`card ${composing ? "composing" : ""}`}>
      <div className="card-head">
        <span className={`platform ${pub.platform}`}>{PLATFORM_LABEL[pub.platform]}</span>
        {pub.part && (
          <span className="flag parts">
            Parte {pub.part.index}/{pub.part.total}
          </span>
        )}
        <span className={`badge ${pub.status}`}>{STATUS[pub.status]}</span>
        <span className="muted small">
          {pub.status === "published" ? `Publicada ${when(pub.publishedAt)}` : pub.scheduledAt ? `Sale ${when(pub.scheduledAt)}` : ""}
        </span>
      </div>
      {editing ? (
        <div className="manual">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      ) : (
        <>
          <h3>{pub.title}</h3>
          <p className="excerpt small">{pub.description}</p>
          {pub.tags.length > 0 && <p className="small muted">{pub.tags.map((t) => `#${t}`).join(" ")}</p>}
        </>
      )}
      {pub.error && <p className="error small">{pub.error}{pub.attempts ? ` (intento ${pub.attempts})` : ""}</p>}
      {pub.url && (
        <a className="small" href={pub.url} target="_blank" rel="noreferrer">
          Abrir publicación
        </a>
      )}
      {error && <p className="error small">{error}</p>}
      {composing && <TikTokComposer pub={pub} onClose={() => setComposing(false)} onPosted={refresh} />}
      <div className="actions">
        <button className="ghost" onClick={() => openJob(pub.jobId)}>
          Ver video
        </button>
        {directPost && open && pub.status !== "canceled" && !composing && (
          <button className="primary" onClick={() => setComposing(true)}>
            Post to TikTok
          </button>
        )}
        {open && !editing && !directPost && (
          <button className="ghost" disabled={busy} onClick={() => setEditing(true)}>
            Editar texto
          </button>
        )}
        {editing && (
          <button className="ghost" disabled={busy} onClick={() => act(() => pipelineApi.editPublication(pub.id, { title, description }))}>
            Guardar
          </button>
        )}
        {!directPost && ["needs_review", "failed", "canceled"].includes(pub.status) && (
          <button className="ghost" disabled={busy} onClick={() => act(() => pipelineApi.approvePublication(pub.id, editing ? { title, description } : undefined))}>
            ✓ Aprobar y programar
          </button>
        )}
        {!directPost && open && pub.status !== "canceled" && (
          <button className="ghost" disabled={busy} onClick={() => act(() => pipelineApi.publishNow(pub.id))}>
            Publicar ya
          </button>
        )}
        {open && pub.status !== "canceled" && (
          <button className="ghost" disabled={busy} onClick={() => act(() => pipelineApi.cancelPublication(pub.id))}>
            Cancelar
          </button>
        )}
      </div>
    </li>
  );
}

export function PublicationsView({
  pubs,
  refresh,
  openJob,
  tiktokReview = false,
}: {
  pubs: Publication[];
  refresh: () => void;
  openJob: (id: string) => void;
  tiktokReview?: boolean;
}) {
  const [filter, setFilter] = useState<"open" | "published" | "all">("open");
  const shown = pubs.filter((p) =>
    filter === "open" ? ["needs_review", "scheduled", "publishing", "failed"].includes(p.status) : filter === "published" ? p.status === "published" : true,
  );
  return (
    <section className="panel">
      <header className="view-head">
        <div>
          <h2>Publicaciones</h2>
          <p className="muted">
            Cada video terminado se prepara para tus plataformas conectadas. Revisa títulos y descripciones, apruébalos y salen en
            los horarios configurados.
          </p>
        </div>
      </header>
      <div className="chips filters">
        {(["open", "published", "all"] as const).map((f) => (
          <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {f === "open" ? "Pendientes" : f === "published" ? "Publicadas" : "Todas"}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="muted">Nada por aquí todavía.</p>}
      <ul className="cards">
        {shown.map((p) => (
          <PublicationCard key={`${p.id}-${p.status}-${p.title}`} pub={p} refresh={refresh} openJob={openJob} tiktokReview={tiktokReview} />
        ))}
      </ul>
    </section>
  );
}
