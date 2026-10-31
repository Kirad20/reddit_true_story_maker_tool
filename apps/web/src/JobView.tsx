import { Player } from "@remotion/player";
import { StoryVideo } from "@tsm/video";
import { useState } from "react";
import { BackgroundPicker } from "./BackgroundPicker";
import { CAPTION_LABELS } from "./CreateForm";
import { PLATFORM_LABEL, api, pipelineApi, type BackgroundChoice, type Job, type Options, type Pipeline } from "./api";

const STEPS: { status: Job["status"]; label: string }[] = [
  { status: "fetching", label: "Leyendo Reddit" },
  { status: "scripting", label: "Guion" },
  { status: "tts", label: "Voz" },
  { status: "composing", label: "Composición" },
  { status: "rendering", label: "Render MP4" },
];
const ORDER: Job["status"][] = ["queued", "fetching", "scripting", "tts", "composing", "ready", "rendering", "done"];

function stepState(job: Job, step: Job["status"]): "done" | "active" | "todo" {
  if (job.status === "failed") return "todo";
  const at = ORDER.indexOf(job.status);
  const idx = ORDER.indexOf(step);
  if (job.status === "ready" && step === "rendering") return "todo";
  if (at > idx) return "done";
  return at === idx ? "active" : "todo";
}

export function JobView({
  job,
  options,
  pipeline,
  onPublished,
}: {
  job: Job;
  options: Options;
  pipeline: Pipeline | null;
  onPublished: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const connected = pipeline?.accounts.filter((a) => a.connected).map((a) => a.platform) ?? [];
  const comp = job.composition;
  const editable = job.status === "ready" || job.status === "done";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel job">
      <header className="job-head">
        <div>
          <h2>{job.post?.title ?? (job.options.source.type === "url" ? job.options.source.url : job.options.source.title)}</h2>
          {job.post && (
            <p className="muted">
              r/{job.post.subreddit} · {job.blocks?.length ?? 0} bloques
              {comp ? ` · ${comp.audio.durationSec.toFixed(0)} s` : ""}
            </p>
          )}
        </div>
      </header>

      {job.status !== "failed" && (
        <ol className="steps">
          {STEPS.map((s) => {
            const state = stepState(job, s.status);
            return (
              <li key={s.status} className={state}>
                <span className="dot" />
                {s.label}
                {state === "active" && s.status === "rendering" ? ` ${Math.round(job.progress * 100)}%` : ""}
              </li>
            );
          })}
        </ol>
      )}

      {job.status === "failed" && (
        <div className="error-box">
          <strong>Falló:</strong> {job.error}
          <button className="ghost" disabled={busy} onClick={() => run(() => api.retry(job.id))}>
            Reintentar
          </button>
        </div>
      )}
      {job.warnings.map((w) => (
        <p key={w} className="warn">
          {w}
        </p>
      ))}

      {comp && (
        <div className="preview">
          <div className="player-wrap">
            <Player
              component={StoryVideo}
              inputProps={comp}
              durationInFrames={comp.durationInFrames}
              fps={comp.fps}
              compositionWidth={comp.width}
              compositionHeight={comp.height}
              controls
              acknowledgeRemotionLicense
              style={{ width: "100%", aspectRatio: "9 / 16", borderRadius: 16, overflow: "hidden" }}
            />
          </div>

          <div className="tweaks">
            <div className="field">
              <span>Subtítulos</span>
              <div className="segmented">
                {options.captionStyles.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!editable || busy}
                    className={comp.captionStyle === s ? "on" : ""}
                    onClick={() => run(() => api.patch(job.id, { captionStyle: s }))}
                  >
                    {CAPTION_LABELS[s] ?? s}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>Fondo</span>
              <BackgroundPicker
                options={options}
                value={job.options.background}
                disabled={!editable || busy}
                onChange={(background: BackgroundChoice) => run(() => api.patch(job.id, { background }))}
              />
            </div>
            <label className="field">
              <span>Música</span>
              <select
                value={job.options.music ?? ""}
                disabled={!editable || busy}
                onChange={(e) => run(() => api.patch(job.id, { music: e.target.value || null }))}
              >
                <option value="">Sin música</option>
                {options.music.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            {error && <p className="error">{error}</p>}

            <div className="actions">
              {job.status === "done" && job.output ? (
                <a className="primary" href={job.output} download={`${job.id}.mp4`}>
                  ⬇ Descargar MP4
                </a>
              ) : (
                <button
                  className="primary"
                  disabled={!editable || busy}
                  onClick={() => run(() => api.render(job.id))}
                >
                  {job.status === "rendering" || job.status === "queued"
                    ? `Renderizando ${Math.round(job.progress * 100)}%`
                    : "Renderizar MP4"}
                </button>
              )}
              {job.status === "done" && (
                <button className="ghost" disabled={busy} onClick={() => run(() => api.render(job.id))}>
                  Volver a renderizar
                </button>
              )}
              {job.status === "done" && (
                <button
                  className="ghost"
                  disabled={busy || connected.length === 0}
                  title={connected.length === 0 ? "Conecta una cuenta en Ajustes" : undefined}
                  onClick={() =>
                    run(async () => {
                      const created = await pipelineApi.publishJob(job.id, connected);
                      setNote(
                        created.length
                          ? `Preparado para ${created.map((p) => PLATFORM_LABEL[p.platform]).join(", ")}: revísalo en Publicaciones.`
                          : "Ya estaba en la cola de publicaciones.",
                      );
                      onPublished();
                    })
                  }
                >
                  📤 Publicar{connected.length ? ` (${connected.map((p) => PLATFORM_LABEL[p]).join(", ")})` : ""}
                </button>
              )}
            </div>
            {note && <p className="note">{note}</p>}

            {job.blocks && (
              <details className="script">
                <summary>Ver guion</summary>
                {job.blocks.map((b, i) => (
                  <p key={i}>
                    <span className={`tag ${b.kind}`}>{b.kind === "title" ? "título" : b.kind === "post" ? "post" : "comentario"}</span>
                    {b.text}
                  </p>
                ))}
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
