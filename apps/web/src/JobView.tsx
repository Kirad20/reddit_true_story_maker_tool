import { Player } from "@remotion/player";
import { StoryVideo } from "@tsm/video";
import { useEffect, useState } from "react";
import { BackgroundPicker } from "./BackgroundPicker";
import { CAPTION_LABELS } from "./CreateForm";
import { STEP_LABEL, formatMs, formatTokens, formatUsd } from "./ObservabilityView";
import { VoiceField, voiceLabel } from "./VoiceField";
import {
  AUTO_VOICE,
  PLATFORM_LABEL,
  api,
  pipelineApi,
  type BackgroundChoice,
  type Job,
  type JobTrace,
  type Options,
  type Pipeline,
  type RedoOptions,
} from "./api";

const STEPS: { status: Job["status"]; label: string }[] = [
  { status: "fetching", label: "Leyendo Reddit" },
  { status: "scripting", label: "Guion" },
  { status: "tts", label: "Voz" },
  { status: "composing", label: "Composición" },
  { status: "rendering", label: "Render MP4" },
];
const BUSY: Job["status"][] = ["queued", "fetching", "scripting", "tts", "composing", "rendering"];

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
  const busyJob = BUSY.includes(job.status);
  const [redoOpen, setRedoOpen] = useState(false);

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
          <button className="ghost" disabled={busy} onClick={() => setRedoOpen(true)}>
            ↻ Rehacer con otros ajustes
          </button>
        </div>
      )}

      {redoOpen && !busyJob && (
        <RedoPanel
          job={job}
          options={options}
          busy={busy}
          onCancel={() => setRedoOpen(false)}
          onRedo={(o) =>
            run(async () => {
              await api.redo(job.id, o);
              setRedoOpen(false);
              setNote(null);
            })
          }
        />
      )}
      {job.voiceChoice && (
        <p className="note small">
          🎙 Voz {voiceLabel(job.voiceChoice.voice)} ·{" "}
          {job.voiceChoice.by === "agent" ? "elegida por el Director de voz" : job.voiceChoice.by === "heuristic" ? "elegida por pistas del texto" : "por defecto"}
          : {job.voiceChoice.reason}
        </p>
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
                <button className="ghost" disabled={busy} title="Mismo guion y voz, vuelve a generar el MP4" onClick={() => run(() => api.render(job.id))}>
                  Volver a renderizar
                </button>
              )}
              {editable && (
                <button
                  className="ghost"
                  disabled={busy}
                  title="Vuelve a procesar todo: fuente, guion, voz, composición"
                  onClick={() => setRedoOpen((o) => !o)}
                >
                  ↻ Rehacer video
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

      <JobTraceView job={job} />
    </section>
  );
}

/** Make the whole video again (script, voice, composition), optionally with new settings. */
function RedoPanel({
  job,
  options,
  busy,
  onRedo,
  onCancel,
}: {
  job: Job;
  options: Options;
  busy: boolean;
  onRedo: (options: RedoOptions) => void;
  onCancel: () => void;
}) {
  const o = job.options;
  const [scriptMode, setScriptMode] = useState(o.scriptMode);
  const [language, setLanguage] = useState(o.language);
  const [voice, setVoice] = useState(o.voice ?? options.defaultVoices[o.language]);
  const [speed, setSpeed] = useState(o.speed);
  const [maxDurationSec, setMaxDurationSec] = useState(o.maxDurationSec);
  const [error, setError] = useState<string | null>(null);
  // A voice from the other language falls back to automatic.
  const voiceFits = voice === AUTO_VOICE || (language === "es" ? voice.startsWith("e") : /^[ab]/.test(voice));

  return (
    <div className="redo-panel">
      <h3>Rehacer video</h3>
      <p className="hint">
        Vuelve a procesar todo desde la fuente: guion, voz, composición. La vista previa y el MP4 actuales se reemplazan
        {job.status === "done" ? " (vuelve a renderizar al terminar)" : ""}.
      </p>
      <div className="grid2">
        <div className="field">
          <span>Guion</span>
          <div className="segmented">
            <button type="button" className={scriptMode === "literal" ? "on" : ""} onClick={() => setScriptMode("literal")}>
              Literal
            </button>
            <button type="button" className={scriptMode === "claude" ? "on" : ""} onClick={() => setScriptMode("claude")}>
              Con IA
            </button>
          </div>
        </div>
        <div className="field">
          <span>Idioma</span>
          <div className="segmented">
            <button type="button" className={language === "en" ? "on" : ""} onClick={() => setLanguage("en")}>
              Inglés
            </button>
            <button type="button" className={language === "es" ? "on" : ""} onClick={() => setLanguage("es")}>
              Español
            </button>
          </div>
        </div>
      </div>
      <VoiceField
        options={options}
        language={language}
        voice={voiceFits ? voice : AUTO_VOICE}
        speed={speed}
        onVoice={setVoice}
        onSpeed={setSpeed}
        onError={setError}
      />
      <label className="field">
        <span>Duración máxima</span>
        <select value={maxDurationSec} onChange={(e) => setMaxDurationSec(Number(e.target.value))}>
          {[30, 60, 90, 120, 180].map((s) => (
            <option key={s} value={s}>
              {s < 120 ? `${s} s` : `${s / 60} min`}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => onRedo({ scriptMode, language, voice: voiceFits ? voice : AUTO_VOICE, speed, maxDurationSec })}
        >
          ↻ Rehacer ahora
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** What happened inside this video: steps with their duration and every model call with its cost. */
function JobTraceView({ job }: { job: Job }) {
  const [trace, setTrace] = useState<JobTrace | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.trace(job.id).then(setTrace, () => setTrace(null));
  }, [open, job.id, job.status]);

  const cost = trace?.calls.reduce((s, c) => s + (c.costUsd ?? 0), 0) ?? 0;
  const tokens = trace?.calls.reduce((s, c) => s + c.usage.input + c.usage.output + c.usage.cacheRead + c.usage.cacheWrite, 0) ?? 0;
  return (
    <details className="trace" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>🔍 Traza interna de este video</summary>
      {!trace ? (
        <p className="muted small">Cargando…</p>
      ) : (
        <>
          <p className="small muted">
            {trace.calls.length} llamadas a modelos · {formatTokens(tokens)} tokens · {formatUsd(cost)}
          </p>
          <ul className="timeline">
            {[...trace.steps.map((s) => ({ kind: "step" as const, at: s.at, s })), ...trace.calls.map((c) => ({ kind: "call" as const, at: c.at, c }))]
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((e) =>
                e.kind === "step" ? (
                  <li key={e.s.id} className={e.s.ok ? "ok" : "bad"}>
                    <time>{new Date(e.at).toLocaleTimeString()}</time>
                    <b>{STEP_LABEL[e.s.step] ?? e.s.step}</b> · {formatMs(e.s.durationMs)}
                    {e.s.detail ? ` · ${e.s.detail}` : ""}
                    {e.s.error ? <span className="error"> · {e.s.error}</span> : null}
                  </li>
                ) : (
                  <li key={e.c.id} className={`call ${e.c.ok ? "ok" : "bad"}`}>
                    <time>{new Date(e.at).toLocaleTimeString()}</time>
                    🤖 <b>{e.c.agent}</b> · {e.c.servedModel ?? e.c.model} · {formatTokens(e.c.usage.input + e.c.usage.cacheRead)} in /{" "}
                    {formatTokens(e.c.usage.output)} out · {formatMs(e.c.durationMs)} · {formatUsd(e.c.costUsd)}
                    {e.c.error ? <span className="error"> · {e.c.error}</span> : null}
                  </li>
                ),
              )}
          </ul>
          {trace.steps.length === 0 && trace.calls.length === 0 && <p className="muted small">Sin registros (videos anteriores a la observabilidad).</p>}
        </>
      )}
    </details>
  );
}
