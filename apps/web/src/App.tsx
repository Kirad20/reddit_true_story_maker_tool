import { useCallback, useEffect, useState } from "react";
import { CreateForm } from "./CreateForm";
import { JobView } from "./JobView";
import { PublicationsView } from "./PublicationsView";
import { SettingsView } from "./SettingsView";
import { StoriesView } from "./StoriesView";
import { PLATFORM_LABEL, api, useJob, usePipelineData, type Job, type Options, type Pipeline, type Publication, type Story } from "./api";

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "En cola",
  fetching: "Leyendo",
  scripting: "Guion",
  tts: "Voz",
  composing: "Componiendo",
  ready: "Vista previa",
  rendering: "Renderizando",
  done: "Listo",
  failed: "Falló",
};

type Tab = "panel" | "stories" | "videos" | "publications" | "settings";
const TABS: { id: Tab; label: string }[] = [
  { id: "panel", label: "Panel" },
  { id: "stories", label: "Historias" },
  { id: "videos", label: "Videos" },
  { id: "publications", label: "Publicaciones" },
  { id: "settings", label: "Ajustes" },
];

function initialTab(): Tab {
  const t = new URLSearchParams(location.search).get("tab");
  return TABS.some((x) => x.id === t) ? (t as Tab) : "panel";
}

function Dashboard({ pipeline, stories, pubs, go }: { pipeline: Pipeline; stories: Story[]; pubs: Publication[]; go: (t: Tab) => void }) {
  const count = (fn: (s: Story) => boolean) => stories.filter(fn).length;
  const connected = pipeline.accounts.filter((a) => a.connected);
  const steps = [
    { label: "Historias por revisar", value: count((s) => s.status === "candidate"), tab: "stories" as Tab },
    { label: "Aprobadas en reserva", value: count((s) => s.status === "approved"), tab: "stories" as Tab },
    { label: "Videos en producción", value: count((s) => s.status === "producing"), tab: "videos" as Tab },
    { label: "Publicaciones por revisar", value: pubs.filter((p) => p.status === "needs_review").length, tab: "publications" as Tab },
    { label: "Programadas", value: pubs.filter((p) => p.status === "scheduled").length, tab: "publications" as Tab },
    { label: "Publicadas", value: pubs.filter((p) => p.status === "published").length, tab: "publications" as Tab },
  ];
  const next = pubs
    .filter((p) => p.status === "scheduled" && p.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];

  const missing: string[] = [];
  if (!pipeline.capabilities.claude) missing.push("un modelo para el Escritor (Ajustes → Modelos de IA)");
  if (connected.length === 0) missing.push("conectar al menos una cuenta (YouTube, TikTok o Facebook)");

  return (
    <div className="dashboard">
      <section className="panel">
        <header className="view-head">
          <div>
            <h2>Pipeline</h2>
            <p className="muted">
              Descubrir → curar → producir video → revisar → publicar en {connected.length ? connected.map((a) => PLATFORM_LABEL[a.platform]).join(", ") : "tus redes"}.
            </p>
          </div>
          <span className={`badge ${pipeline.status.enabled ? "done" : ""}`}>{pipeline.status.enabled ? "Piloto automático activo" : "Piloto automático apagado"}</span>
        </header>
        {missing.length > 0 && <p className="warn">Para el modo automático falta: {missing.join("; ")}. Configúralo en Ajustes.</p>}
        <div className="stats">
          {steps.map((s) => (
            <button key={s.label} className="stat" onClick={() => go(s.tab)}>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <p className="small muted">
          {next ? `Próxima publicación: ${PLATFORM_LABEL[next.platform]} el ${new Date(next.scheduledAt!).toLocaleString()}` : "No hay publicaciones programadas."}
          {pipeline.status.lastCycle ? ` · Último ciclo: ${new Date(pipeline.status.lastCycle).toLocaleTimeString()}` : ""}
          {pipeline.capabilities.model ? ` · Modelo: ${pipeline.capabilities.model}` : ""}
        </p>
      </section>
      <section className="panel">
        <h2>Actividad</h2>
        {pipeline.activity.length === 0 && <p className="muted">Sin actividad todavía.</p>}
        <ul className="activity">
          {pipeline.activity.slice(0, 40).map((a, i) => (
            <li key={i} className={a.level}>
              <time>{new Date(a.at).toLocaleString()}</time>
              <span>{a.message}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { pipeline, stories, pubs, refresh: refreshPipeline } = usePipelineData();

  const refresh = useCallback(() => api.jobs().then(setJobs).catch(() => {}), []);

  useEffect(() => {
    api.options().then(setOptions, (e: Error) => setLoadError(e.message));
    refresh();
  }, [refresh]);

  // Pipeline-created jobs show up in the history as they appear.
  useEffect(() => {
    refresh();
  }, [stories.length, pubs.length, refresh]);

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", t === "panel" ? "/" : `/?tab=${t}`);
  };

  const openJob = (jobId: string) => {
    setSelectedId(jobId);
    go("videos");
    refresh();
  };

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const live = useJob(selectedId, selected);

  useEffect(() => {
    if (live) setJobs((list) => list.map((j) => (j.id === live.id ? live : j)));
  }, [live]);

  async function remove(job: Job) {
    if (!confirm(`¿Borrar "${job.post?.title ?? job.id}" y sus archivos?`)) return;
    await api.remove(job.id).catch((e: Error) => alert(e.message));
    if (selectedId === job.id) setSelectedId(null);
    refresh();
  }

  const reviewCount = pubs.filter((p) => p.status === "needs_review").length;
  const inboxCount = stories.filter((s) => s.status === "candidate").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▶</span> TrueStory<b>Maker</b>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => go(t.id)}>
              {t.label}
              {t.id === "stories" && inboxCount > 0 && <span className="count">{inboxCount}</span>}
              {t.id === "publications" && reviewCount > 0 && <span className="count">{reviewCount}</span>}
            </button>
          ))}
        </nav>
      </header>

      {loadError && (
        <p className="error">
          No se pudo conectar con la API ({loadError}). ¿Está corriendo <code>npm run dev</code>?
        </p>
      )}

      {!pipeline && tab !== "videos" && !loadError && <p className="muted">Cargando…</p>}
      {tab === "panel" && pipeline && <Dashboard pipeline={pipeline} stories={stories} pubs={pubs} go={go} />}
      {tab === "stories" && pipeline && <StoriesView pipeline={pipeline} stories={stories} refresh={refreshPipeline} openJob={openJob} />}
      {tab === "publications" && <PublicationsView pubs={pubs} refresh={refreshPipeline} openJob={openJob} />}
      {tab === "settings" && pipeline && options && <SettingsView pipeline={pipeline} options={options} refresh={refreshPipeline} />}

      {tab === "videos" && (
        <main className="layout">
          <div className="left">
            {options && (
              <CreateForm
                options={options}
                onCreated={(job) => {
                  setJobs((list) => [job, ...list]);
                  setSelectedId(job.id);
                }}
              />
            )}
          </div>
          <div className="right">
            {live && options ? (
              <JobView job={live} options={options} pipeline={pipeline} onPublished={refreshPipeline} />
            ) : (
              <section className="panel empty">
                <h2>Tu video aparecerá aquí</h2>
                <p className="muted">
                  Crea un video a mano con el formulario, o deja que el pipeline lo haga desde la pestaña Historias. Cuando la voz esté
                  lista verás la vista previa, podrás cambiar subtítulos y fondo, y luego renderizar y publicar.
                </p>
              </section>
            )}

            <section className="panel history">
              <h2>Videos</h2>
              {jobs.length === 0 && <p className="muted">Todavía no hay videos.</p>}
              <ul>
                {jobs.map((job) => (
                  <li key={job.id} className={job.id === selectedId ? "on" : ""}>
                    <button className="link" onClick={() => setSelectedId(job.id)}>
                      <span className={`badge ${job.status}`}>{STATUS_LABEL[job.status]}</span>
                      <span className="title">
                        {job.options.part ? `Parte ${job.options.part.index}/${job.options.part.total} · ` : ""}
                        {job.post?.title ?? (job.options.source.type === "url" ? job.options.source.url : job.options.source.title)}
                      </span>
                    </button>
                    <button className="icon" title="Borrar" onClick={() => remove(job)}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
