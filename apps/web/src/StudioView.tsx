import { useCallback, useEffect, useState } from "react";
import {
  FORMATS_BY_PLATFORM,
  FORMAT_LABEL,
  PLATFORM_LABEL,
  pipelineApi,
  studioApi,
  type Platform,
  type PostFormat,
  type StudioAnalytics,
  type StudioConfig,
  type StudioDraft,
  type StudioKind,
} from "./api";
import { toast } from "./toast";

const KINDS: { id: StudioKind; label: string; hint: string }[] = [
  { id: "post", label: "Publicación", hint: "Texto + hashtags adaptados a cada red" },
  { id: "video", label: "Video", hint: "Gancho, guion y tomas; conviértelo en video" },
  { id: "ads", label: "Anuncios (Ads)", hint: "Variantes de anuncio y segmentación" },
  { id: "seo", label: "SEO", hint: "Palabras clave, título, meta y hashtags" },
  { id: "plan", label: "Calendario", hint: "Plan de contenido de 7 días" },
];
const ALL: Platform[] = ["tiktok", "instagram", "youtube", "facebook"];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast("Copiado"), () => toast("No se pudo copiar", "error"));

function DraftBody({
  draft,
  onVideo,
  onPublish,
  onIllustrate,
}: {
  draft: StudioDraft;
  onVideo: (d: StudioDraft) => void;
  onPublish: (d: StudioDraft, p: Platform) => void;
  onIllustrate: (d: StudioDraft, p: Platform) => void;
}) {
  const c = draft.content;
  switch (c.kind) {
    case "post":
      return (
        <div className="studio-list">
          {c.variants.map((v, i) => {
            const text = `${v.text}\n\n${v.hashtags.map((h) => `#${h}`).join(" ")}`.trim();
            const published = draft.published?.find((p) => p.platform === v.platform);
            const canImage = (v.platform === "facebook" || v.platform === "instagram") && Boolean(v.imagePrompt);
            const canPublish = (v.platform === "facebook" || (v.platform === "instagram" && v.imageUrl)) && draft.status === "approved" && !published;
            return (
              <div key={i} className="studio-item">
                <strong>{PLATFORM_LABEL[v.platform]}</strong>
                {v.format && <span className="badge">{FORMAT_LABEL[v.format]}</span>}
                {v.imageUrl && <img className="studio-image" src={v.imageUrl} alt={v.imagePrompt ?? ""} />}
                <p style={{ whiteSpace: "pre-wrap" }}>{text}</p>
                {v.slides && v.slides.length > 0 && (
                  <ol className="small muted">{v.slides.map((s, n) => <li key={n}>{s}</li>)}</ol>
                )}
                <button className="ghost" onClick={() => copy(text)}>Copiar</button>
                {canImage && <button className="ghost" onClick={() => onIllustrate(draft, v.platform)}>{v.imageUrl ? "Regenerar imagen" : "Generar imagen"}</button>}
                {canPublish && <button className="primary" onClick={() => onPublish(draft, v.platform)}>Publicar en {PLATFORM_LABEL[v.platform]}</button>}
                {published && <span className="badge published">Publicado{published.url ? <> · <a href={published.url} target="_blank" rel="noreferrer">ver</a></> : null}</span>}
              </div>
            );
          })}
        </div>
      );
    case "ads":
      return (
        <div className="studio-list">
          <p className="small muted">Objetivo: {c.objective} · Público: {c.audience}</p>
          {c.variants.map((v, i) => (
            <div key={i} className="studio-item">
              <strong>{v.headline}</strong>
              <p>{v.primaryText}</p>
              <span className="badge">{v.cta}</span>
            </div>
          ))}
        </div>
      );
    case "seo":
      return (
        <div className="studio-list">
          <p><strong>{c.title}</strong></p>
          <p>{c.description}</p>
          <p className="small muted">Palabras clave: {c.keywords.join(", ")}</p>
          <p className="small muted">{c.hashtags.map((h) => `#${h}`).join(" ")}</p>
        </div>
      );
    case "video":
      return (
        <div className="studio-list">
          <p><strong>Gancho:</strong> {c.hook}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{c.script}</p>
          <ul className="small muted">{c.shots.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <p className="small muted">Duración: {c.durationSec}s</p>
          <button className="primary" onClick={() => onVideo(draft)}>Crear video con este guion</button>
        </div>
      );
    case "plan":
      return (
        <table className="studio-table">
          <tbody>
            {c.items.map((it, i) => (
              <tr key={i}>
                <td>Día {it.day}</td>
                <td>{PLATFORM_LABEL[it.platform]}</td>
                <td>{it.format}</td>
                <td>{it.topic}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

function Generator({ onCreated, ready }: { onCreated: (d: StudioDraft) => void; ready: boolean }) {
  const [kind, setKind] = useState<StudioKind>("post");
  const [topic, setTopic] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>(ALL);
  const [formats, setFormats] = useState<Partial<Record<Platform, PostFormat>>>({});
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const chosen = Object.fromEntries(platforms.filter((p) => formats[p]).map((p) => [p, formats[p]]));
      onCreated(await studioApi.generate({ kind, topic, platforms, ...(kind === "post" ? { formats: chosen } : {}) }));
      toast("Contenido generado");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Generar con IA</h3>
      {!ready && <p className="small muted">Configura un modelo para el agente «Estudio social» en Ajustes → Modelos de IA.</p>}
      <div className="tabs" role="tablist">
        {KINDS.map((k) => (
          <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)} title={k.hint}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="small muted">{KINDS.find((k) => k.id === kind)?.hint}</p>
      <label className="field">
        Tema o producto
        <textarea rows={3} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej. lanzamiento de mi curso de cocina vegana" />
      </label>
      {(kind === "post" || kind === "plan") && (
        <div className="row-inline">
          {ALL.map((p) => (
            <label key={p}>
              <input
                type="checkbox"
                checked={platforms.includes(p)}
                onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p] : platforms.filter((x) => x !== p))}
              />{" "}
              {PLATFORM_LABEL[p]}
            </label>
          ))}
        </div>
      )}
      {kind === "post" && (
        <div className="row-inline">
          {platforms.map((p) => (
            <label key={p}>
              {PLATFORM_LABEL[p]}{" "}
              <select value={formats[p] ?? ""} onChange={(e) => setFormats({ ...formats, [p]: e.target.value || undefined })}>
                <option value="">Automático</option>
                {FORMATS_BY_PLATFORM[p].map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || !topic.trim()} onClick={go}>{busy ? "Generando…" : "Generar"}</button>
      </div>
    </section>
  );
}

function Drafts({ drafts, refresh, onVideo }: { drafts: StudioDraft[]; refresh: () => void; onVideo: (d: StudioDraft) => void }) {
  const act = (fn: () => Promise<unknown>) => fn().then(refresh, (e: Error) => toast(e.message, "error"));
  if (drafts.length === 0) return <p className="muted">Aún no hay contenido. Genera el primero arriba o activa el agente automático.</p>;
  return (
    <div className="studio-grid">
      {drafts.map((d) => (
        <article key={d.id} className="card">
          <div className="card-head">
            <span className="badge">{KINDS.find((k) => k.id === d.kind)?.label}</span>
            <span className={`badge ${d.status === "approved" ? "approved" : ""}`}>{d.status === "draft" ? "Borrador" : d.status === "approved" ? "Aprobado" : "Archivado"}</span>
            <time className="small muted">{new Date(d.createdAt).toLocaleString()}</time>
          </div>
          <h3>{d.topic}</h3>
          <DraftBody
            draft={d}
            onVideo={onVideo}
            onPublish={(draft, p) => act(() => studioApi.publish(draft.id, p).then(() => toast("Publicado")))}
            onIllustrate={(draft, p) => act(() => studioApi.illustrate(draft.id, p).then(() => toast("Imagen generada")))}
          />
          <div className="actions">
            {d.status !== "approved" && <button className="ghost" onClick={() => act(() => studioApi.setStatus(d.id, "approved"))}>Aprobar</button>}
            {d.status !== "archived" && <button className="ghost" onClick={() => act(() => studioApi.setStatus(d.id, "archived"))}>Archivar</button>}
            <button className="ghost" onClick={() => act(() => studioApi.remove(d.id))}>Eliminar</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Analytics() {
  const [data, setData] = useState<StudioAnalytics | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    (insights: boolean) => {
      setBusy(true);
      studioApi.analytics(insights).then(setData, (e: Error) => toast(e.message, "error")).finally(() => setBusy(false));
    },
    [],
  );
  useEffect(() => load(false), [load]);
  if (!data) return <p className="muted">Cargando estadísticas…</p>;
  const t = data.summary.totals;
  const cards = [
    ["Publicaciones", t.posts],
    ["Vistas", t.views],
    ["Me gusta", t.likes],
    ["Comentarios", t.comments],
    ["Compartidos", t.shares],
    ["Interacción", pct(t.engagementRate)],
  ];
  return (
    <section className="panel">
      <header className="view-head">
        <div>
          <h3>Estadísticas</h3>
          <p className="muted">
            {data.source === "remote" ? "Datos reales de tus redes (Zernio)." : "Zernio no está disponible: solo se cuentan las publicaciones hechas desde la app."}
          </p>
        </div>
        <div className="actions">
          <button className="ghost" disabled={busy} onClick={() => load(false)}>Actualizar</button>
          <button className="primary" disabled={busy} onClick={() => load(true)}>Análisis con IA</button>
        </div>
      </header>
      <div className="stats">
        {cards.map(([label, value]) => (
          <div key={label} className="stat"><strong>{value}</strong><span>{label}</span></div>
        ))}
      </div>
      {data.insights && (
        <div className="studio-insights">
          <h4>Recomendaciones del agente</h4>
          <ul>{data.insights.map((i, n) => <li key={n}>{i}</li>)}</ul>
        </div>
      )}
      <h4>Por red</h4>
      <table className="studio-table">
        <thead><tr><th>Red</th><th>Posts</th><th>Vistas</th><th>Interacción</th></tr></thead>
        <tbody>
          {(Object.entries(data.summary.byPlatform) as [Platform, NonNullable<StudioAnalytics["summary"]["byPlatform"][Platform]>][]).map(([p, s]) => (
            <tr key={p}><td>{PLATFORM_LABEL[p]}</td><td>{s.posts}</td><td>{s.views}</td><td>{pct(s.engagementRate)}</td></tr>
          ))}
        </tbody>
      </table>
      {data.summary.bestHours.length > 0 && (
        <p className="small muted">Mejores horas para publicar: {data.summary.bestHours.slice(0, 3).map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}</p>
      )}
      <h4>Mejores publicaciones</h4>
      <table className="studio-table">
        <tbody>
          {data.summary.topPosts.map((p) => (
            <tr key={p.postId}><td>{PLATFORM_LABEL[p.platform]}</td><td>{p.title}</td><td>{p.views} vistas</td><td>{pct(p.engagementRate)}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Agent() {
  const [cfg, setCfg] = useState<StudioConfig | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void studioApi.config().then(setCfg, (e: Error) => toast(e.message, "error")), []);
  if (!cfg) return <p className="muted">Cargando…</p>;

  const setBrand = (k: keyof StudioConfig["brand"], v: string) => setCfg({ ...cfg, brand: { ...cfg.brand, [k]: v } });
  const setAuto = (patch: Partial<StudioConfig["automation"]>) => setCfg({ ...cfg, automation: { ...cfg.automation, ...patch } });
  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      setCfg(await studioApi.saveConfig({ brand: cfg.brand, automation: cfg.automation }));
      toast("Guardado");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function runNow() {
    setBusy(true);
    try {
      const r = await studioApi.runAgent();
      toast(r.ok ? "El agente generó nuevos borradores" : "El agente falló; revisa el modelo en Ajustes", r.ok ? "ok" : "error");
      setCfg(await studioApi.config());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h3>Marca y agente automático</h3>
      <p className="muted small">El agente planea la semana y deja borradores para que los apruebes. Nunca publica solo.</p>
      <div className="studio-form">
        <label className="field">Nombre<input value={cfg.brand.name} onChange={(e) => setBrand("name", e.target.value)} /></label>
        <label className="field">Nicho<input value={cfg.brand.niche} onChange={(e) => setBrand("niche", e.target.value)} /></label>
        <label className="field">Tono de voz<input value={cfg.brand.voice} onChange={(e) => setBrand("voice", e.target.value)} /></label>
        <label className="field">Público objetivo<input value={cfg.brand.audience} onChange={(e) => setBrand("audience", e.target.value)} /></label>
        <label className="field">
          Idioma
          <select value={cfg.brand.language} onChange={(e) => setBrand("language", e.target.value)}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field">Tema del agente (opcional)<input value={cfg.automation.theme ?? ""} onChange={(e) => setAuto({ theme: e.target.value })} /></label>
        <label className="field">Cada (horas)<input type="number" min={1} max={168} value={cfg.automation.intervalHours} onChange={(e) => setAuto({ intervalHours: Number(e.target.value) })} /></label>
        <label className="field">Borradores por corrida<input type="number" min={1} max={7} value={cfg.automation.maxDrafts} onChange={(e) => setAuto({ maxDrafts: Number(e.target.value) })} /></label>
      </div>
      <label>
        <input type="checkbox" checked={cfg.automation.enabled} onChange={(e) => setAuto({ enabled: e.target.checked })} /> Agente automático activo
      </label>
      <p className="small muted">Última corrida: {cfg.automation.lastRun ? new Date(cfg.automation.lastRun).toLocaleString() : "nunca"}</p>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={save}>Guardar</button>
        <button className="ghost" disabled={busy || !cfg.ready} onClick={runNow}>Ejecutar agente ahora</button>
      </div>
    </section>
  );
}

type Section = "create" | "analytics" | "agent";

export function StudioView({ aiReady, goTab }: { aiReady: boolean; goTab: (t: "stories") => void }) {
  const [section, setSection] = useState<Section>("create");
  const [drafts, setDrafts] = useState<StudioDraft[]>([]);
  const refresh = useCallback(() => void studioApi.drafts().then(setDrafts, () => undefined), []);
  useEffect(refresh, [refresh]);

  async function toVideo(d: StudioDraft) {
    if (d.content.kind !== "video") return;
    try {
      await pipelineApi.addStory({ title: d.content.hook, body: d.content.script });
      toast("Historia creada: apruébala para producir el video");
      goTab("stories");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <header className="view-head">
        <div>
          <h2>Estudio social</h2>
          <p className="muted">Crea publicaciones, videos, anuncios y SEO con agentes de IA, mide resultados y automatiza el calendario.</p>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button className={section === "create" ? "on" : ""} onClick={() => setSection("create")}>Crear</button>
        <button className={section === "analytics" ? "on" : ""} onClick={() => setSection("analytics")}>Estadísticas</button>
        <button className={section === "agent" ? "on" : ""} onClick={() => setSection("agent")}>Agente</button>
      </div>
      {section === "create" && (
        <>
          <Generator ready={aiReady} onCreated={(d) => setDrafts([d, ...drafts])} />
          <h3>Contenido generado</h3>
          <Drafts drafts={drafts} refresh={refresh} onVideo={toVideo} />
        </>
      )}
      {section === "analytics" && <Analytics />}
      {section === "agent" && <Agent />}
    </div>
  );
}
