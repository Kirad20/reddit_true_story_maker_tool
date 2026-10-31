import { useEffect, useState } from "react";
import { authClient } from "./auth";
import { CAPTION_LABELS } from "./CreateForm";
import { CredentialsSettings, ModelsSettings } from "./ModelsSettings";
import { PLATFORMS, PLATFORM_LABEL, pipelineApi, type AccountStatus, type Genre, type Options, type Pipeline, type Platform, type Settings } from "./api";

const GENRES: { id: Genre; label: string }[] = [
  { id: "aita", label: "¿Soy el malo? (AITA)" },
  { id: "tifu", label: "Hoy la regué (TIFU)" },
  { id: "revenge", label: "Venganza" },
  { id: "relationship", label: "Pareja / familia" },
  { id: "workplace", label: "Trabajo" },
  { id: "creepy", label: "Misterio / creepy" },
  { id: "wholesome", label: "Conmovedoras" },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Connect through Better Auth: the account is linked to the logged-in user and used to publish. */
async function connect(a: AccountStatus, onError: (message: string) => void) {
  const { error } = await authClient.linkSocial({
    provider: a.provider,
    // Absolute: in development the provider calls back the API (:8787), not Vite (:5173).
    callbackURL: `${location.origin}/?tab=settings&connected=${a.platform}`,
    errorCallbackURL: `${location.origin}/?tab=settings&linkFailed=${a.platform}`,
  });
  if (error) onError(error.message ?? `No se pudo conectar ${PLATFORM_LABEL[a.platform]}`);
}

function Accounts({ pipeline, refresh }: { pipeline: Pipeline; refresh: () => void }) {
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pages, setPages] = useState<{ pages: { id: string; name: string }[]; pageId: string | null } | null>(null);
  const fb = pipeline.accounts.find((a) => a.platform === "facebook");
  useEffect(() => {
    if (fb?.connected) pipelineApi.facebookPages().then(setPages, () => {});
  }, [fb?.connected]);

  return (
    <div className="accounts">
      {connectError && <p className="error">{connectError}</p>}
      {pipeline.accounts.map((a) => (
        <div key={a.platform} className="account">
          <div className="account-body">
            <strong className={`platform ${a.platform}`}>{PLATFORM_LABEL[a.platform]}</strong>
            <div className="small muted">
              {a.connected
                ? `Conectado${a.accountName ? `: ${a.accountName}` : ""}${a.linkedBy ? ` · por ${a.linkedBy}` : ""}`
                : a.configured
                  ? "Sin conectar"
                  : "Faltan las credenciales de tu app (abajo)"}
            </div>
            {a.note && <div className="small muted">{a.note}</div>}
            {a.platform === "facebook" && a.connected && pages && pages.pages.length > 1 && (
              <select
                value={pages.pageId ?? ""}
                onChange={(e) => pipelineApi.selectFacebookPage(e.target.value).then(refresh)}
              >
                {pages.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <details className="creds">
              <summary className="small">Credenciales de la app de {PLATFORM_LABEL[a.platform]}</summary>
              <p className="hint">
                Redirect URI para registrar en la app: <code>{a.redirectUri}</code>
              </p>
              <CredentialsSettings group={a.platform} onSaved={refresh} />
            </details>
          </div>
          {a.connected ? (
            <button className="ghost" onClick={() => pipelineApi.disconnect(a.platform).then(refresh)}>
              Desconectar
            </button>
          ) : (
            <button className="ghost" disabled={!a.configured} onClick={() => connect(a, setConnectError)}>
              Conectar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function SettingsView({ pipeline, options, refresh }: { pipeline: Pipeline; options: Options; refresh: () => void }) {
  const [s, setS] = useState<Settings>(pipeline.settings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const params = new URLSearchParams(location.search);
  // Better Auth sends errors back as ?error=<code>&error_description=…
  const linkFailed = params.get("linkFailed");
  const authError = linkFailed
    ? `${PLATFORM_LABEL[linkFailed as Platform] ?? linkFailed}: ${params.get("error_description") ?? params.get("error") ?? "error desconocido"}`
    : params.get("authError");
  const connected = params.get("connected");

  useEffect(() => setS(pipeline.settings), [pipeline.settings]);

  const set = (fn: (draft: Settings) => void) =>
    setS((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await pipelineApi.saveSettings(s);
      setMessage("Ajustes guardados");
      refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const voices = options.voices.filter((v) => (s.video.language === "es" ? v.startsWith("e") : /^[ab]/.test(v)));
  const bgValue = s.video.background.type === "clip" ? `clip:${s.video.background.category}` : `proc:${s.video.background.preset}`;

  return (
    <div className="settings">
      {authError && <p className="error">No se pudo conectar: {authError}</p>}
      {connected && <p className="note">{PLATFORM_LABEL[connected as Platform] ?? connected} conectado.</p>}

      <section className="panel">
        <h2>Modelos de IA</h2>
        <p className="muted small">
          Configura los proveedores (Anthropic, OpenAI o pasarelas compatibles como teamsoclo) y elige qué modelo usa cada agente.
        </p>
        <ModelsSettings onSaved={refresh} />
      </section>

      <section className="panel">
        <h2>Cuentas para publicar</h2>
        <p className="muted small">
          Cada plataforma necesita tu propia app de desarrollador: pega sus credenciales en la tarjeta de la plataforma, registra el redirect
          URI que aparece ahí y pulsa Conectar. La cuenta queda vinculada a tu usuario (Better Auth) y el pipeline publica con ella. Ver
          README.
        </p>
        <Accounts pipeline={pipeline} refresh={refresh} />
      </section>

      <section className="panel">
        <h2>Automatización</h2>
        <Toggle
          checked={s.automation.enabled}
          onChange={(v) => set((d) => void (d.automation.enabled = v))}
          label="Piloto automático: buscar historias, producir videos y programar publicaciones"
        />
        <div className="grid3">
          <label className="field">
            <span>Cada (minutos)</span>
            <input type="number" min={5} value={s.automation.intervalMinutes} onChange={(e) => set((d) => void (d.automation.intervalMinutes = Number(e.target.value)))} />
          </label>
          <label className="field">
            <span>Historias aprobadas en reserva</span>
            <input type="number" min={1} max={20} value={s.automation.targetBacklog} onChange={(e) => set((d) => void (d.automation.targetBacklog = Number(e.target.value)))} />
          </label>
        </div>
        <button className="ghost" onClick={() => pipelineApi.run().then(() => setMessage("Ciclo iniciado"))}>
          Ejecutar un ciclo ahora
        </button>
      </section>

      <section className="panel">
        <h2>Fuentes de historias</h2>
        <Toggle
          checked={s.sources.original.enabled}
          onChange={(v) => set((d) => void (d.sources.original.enabled = v))}
          label="Historias originales escritas por Claude (ficción, se marca como tal)"
        />
        <div className="chips">
          {GENRES.map((g) => {
            const on = s.sources.original.genres.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                className={`chip ${on ? "on" : ""}`}
                onClick={() =>
                  set((d) => {
                    const list = d.sources.original.genres;
                    d.sources.original.genres = on ? list.filter((x) => x !== g.id) : [...list, g.id];
                  })
                }
              >
                {g.label}
              </button>
            );
          })}
        </div>
        <label className="field narrow">
          <span>Historias por búsqueda</span>
          <input type="number" min={1} max={10} value={s.sources.original.perRun} onChange={(e) => set((d) => void (d.sources.original.perRun = Number(e.target.value)))} />
        </label>

        <Toggle
          checked={s.sources.reddit.enabled}
          onChange={(v) => set((d) => void (d.sources.reddit.enabled = v))}
          label="Reddit (vía redditapis.com o la API oficial aprobada)"
        />
        {!pipeline.capabilities.reddit && (
          <p className="warn small">Sin una clave de redditapis.com ni credenciales aprobadas de Reddit esta fuente se omite.</p>
        )}
        <details className="creds">
          <summary className="small">Credenciales de Reddit (redditapis.com o API oficial aprobada)</summary>
          <CredentialsSettings group="reddit" onSaved={refresh} />
        </details>
        <p className="hint">Uso comercial de posts de Reddit: Reddit exige su aprobación escrita, y los textos son de sus autores.</p>
        <div className="grid3">
          <label className="field">
            <span>Subreddits (separados por coma)</span>
            <input
              value={s.sources.reddit.subreddits.join(", ")}
              onChange={(e) => set((d) => void (d.sources.reddit.subreddits = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))}
            />
          </label>
          <label className="field">
            <span>Votos mínimos</span>
            <input type="number" min={0} value={s.sources.reddit.minScore} onChange={(e) => set((d) => void (d.sources.reddit.minScore = Number(e.target.value)))} />
          </label>
          <label className="field">
            <span>Periodo</span>
            <select value={s.sources.reddit.timeframe} onChange={(e) => set((d) => void (d.sources.reddit.timeframe = e.target.value as "day" | "week"))}>
              <option value="day">Hoy</option>
              <option value="week">Semana</option>
            </select>
          </label>
        </div>

        <h3>Curación</h3>
        <Toggle
          checked={s.curation.autoApprove}
          onChange={(v) => set((d) => void (d.curation.autoApprove = v))}
          label="Aprobar automáticamente las historias bien puntuadas y sin alertas"
        />
        <label className="field narrow">
          <span>Puntaje mínimo (1-10)</span>
          <input type="number" min={1} max={10} value={s.curation.minScore} onChange={(e) => set((d) => void (d.curation.minScore = Number(e.target.value)))} />
        </label>
      </section>

      <section className="panel">
        <h2>Partes</h2>
        <Toggle
          checked={s.parts.enabled}
          onChange={(v) => set((d) => void (d.parts.enabled = v))}
          label="Dividir historias largas en partes para TikTok y Facebook (YouTube siempre recibe el video completo)"
        />
        <p className="hint">
          Un agente elige dónde cortar (en momentos de suspenso) o la deja en una sola parte. Cada parte muestra “Parte k/N”, la voz la
          anuncia y, si no es la última, invita a seguir para la siguiente. Las partes se publican siempre en orden.
        </p>
        <div className="grid3">
          <label className="field">
            <span>Dividir si dura más de (s)</span>
            <input type="number" min={30} max={600} value={s.parts.splitAboveSec} onChange={(e) => set((d) => void (d.parts.splitAboveSec = Number(e.target.value)))} />
          </label>
          <label className="field">
            <span>Duración mínima por parte (s)</span>
            <input type="number" min={15} max={120} value={s.parts.minPartSec} onChange={(e) => set((d) => void (d.parts.minPartSec = Number(e.target.value)))} />
          </label>
          <label className="field">
            <span>Máximo de partes</span>
            <select value={s.parts.maxParts} onChange={(e) => set((d) => void (d.parts.maxParts = Number(e.target.value) as 2 | 3))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Video</h2>
        <div className="grid3">
          <label className="field">
            <span>Idioma</span>
            <select value={s.video.language} onChange={(e) => set((d) => void ((d.video.language = e.target.value as "en" | "es"), (d.video.voice = null)))}>
              <option value="en">Inglés</option>
              <option value="es">Español (traduce con Claude)</option>
            </select>
          </label>
          <label className="field">
            <span>Voz</span>
            <select value={s.video.voice ?? ""} onChange={(e) => set((d) => void (d.video.voice = e.target.value || null))}>
              <option value="">Por defecto</option>
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Guion</span>
            <select value={s.video.scriptMode} onChange={(e) => set((d) => void (d.video.scriptMode = e.target.value as "literal" | "claude"))}>
              <option value="literal">Literal</option>
              <option value="claude">Reescrito con Claude</option>
            </select>
          </label>
          <label className="field">
            <span>Fondo</span>
            <select
              value={bgValue}
              onChange={(e) =>
                set((d) => {
                  const [kind, name] = e.target.value.split(":");
                  d.video.background = kind === "clip" ? { type: "clip", category: name } : { type: "procedural", preset: name as "sunset" };
                })
              }
            >
              {options.procedural.map((p) => (
                <option key={p} value={`proc:${p}`}>
                  Animado: {p}
                </option>
              ))}
              {options.backgrounds.map((b) => (
                <option key={b.name} value={`clip:${b.name}`}>
                  Clips: {b.name} ({b.clips.length})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Subtítulos</span>
            <select value={s.video.captionStyle} onChange={(e) => set((d) => void (d.video.captionStyle = e.target.value as Settings["video"]["captionStyle"]))}>
              {options.captionStyles.map((c) => (
                <option key={c} value={c}>
                  {CAPTION_LABELS[c] ?? c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Música</span>
            <select value={s.video.music ?? ""} onChange={(e) => set((d) => void (d.video.music = e.target.value || null))}>
              <option value="">Sin música</option>
              {options.music.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Duración máxima (s)</span>
            <input type="number" min={15} max={180} value={s.video.maxDurationSec} onChange={(e) => set((d) => void (d.video.maxDurationSec = Number(e.target.value)))} />
          </label>
          <label className="field">
            <span>Comentarios por video</span>
            <input type="number" min={0} max={5} value={s.video.commentCount} onChange={(e) => set((d) => void (d.video.commentCount = Number(e.target.value)))} />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Publicación</h2>
        <Toggle
          checked={s.publish.requireReview}
          onChange={(v) => set((d) => void (d.publish.requireReview = v))}
          label="Revisar cada publicación antes de que salga (recomendado)"
        />
        <div className="grid3">
          <label className="field">
            <span>Horarios (HH:MM, separados por coma)</span>
            <input
              value={s.publish.slots.join(", ")}
              onChange={(e) => set((d) => void (d.publish.slots = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))}
            />
          </label>
          <label className="field">
            <span>Máximo por día y plataforma</span>
            <input
              type="number"
              min={1}
              max={20}
              value={s.publish.dailyLimitPerPlatform}
              onChange={(e) => set((d) => void (d.publish.dailyLimitPerPlatform = Number(e.target.value)))}
            />
          </label>
        </div>
        <div className="platform-settings">
          {PLATFORMS.map((p) => (
            <div key={p} className="row-inline">
              <Toggle
                checked={s.publish.platforms[p].enabled}
                onChange={(v) => set((d) => void (d.publish.platforms[p].enabled = v))}
                label={`Publicar en ${PLATFORM_LABEL[p]}`}
              />
              {p === "youtube" && (
                <select
                  value={s.publish.platforms.youtube.privacy}
                  onChange={(e) => set((d) => void (d.publish.platforms.youtube.privacy = e.target.value as "private"))}
                >
                  <option value="private">Privado</option>
                  <option value="unlisted">No listado</option>
                  <option value="public">Público</option>
                </select>
              )}
              {p === "tiktok" && (
                <select
                  value={s.publish.platforms.tiktok.privacy}
                  onChange={(e) => set((d) => void (d.publish.platforms.tiktok.privacy = e.target.value as "SELF_ONLY"))}
                >
                  <option value="SELF_ONLY">Solo yo</option>
                  <option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option>
                  <option value="FOLLOWER_OF_CREATOR">Seguidores</option>
                  <option value="PUBLIC_TO_EVERYONE">Público</option>
                </select>
              )}
            </div>
          ))}
        </div>
        <p className="hint">
          Los videos se marcan como contenido generado con IA en cada plataforma. Publicar muchos videos casi idénticos puede afectar la
          monetización: varía géneros, voces y fondos.
        </p>
      </section>

      <div className="save-bar">
        {message && <span className="note">{message}</span>}
        <button className="primary" disabled={saving} onClick={save}>
          {saving ? "Guardando…" : "Guardar ajustes"}
        </button>
      </div>
    </div>
  );
}
