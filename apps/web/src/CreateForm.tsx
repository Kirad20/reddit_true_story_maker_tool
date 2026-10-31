import { useMemo, useRef, useState } from "react";
import { BackgroundPicker } from "./BackgroundPicker";
import { api, type BackgroundChoice, type Job, type JobOptions, type Options } from "./api";

export const CAPTION_LABELS: Record<string, string> = { pop: "Pop", karaoke: "Karaoke", boxed: "Resaltado" };

const voiceLabel = (v: string) => {
  const [prefix, name] = v.split("_");
  const accent = { a: "US", b: "UK", e: "ES" }[prefix[0]] ?? prefix[0].toUpperCase();
  const gender = prefix[1] === "f" ? "♀" : "♂";
  return `${name[0].toUpperCase()}${name.slice(1)} · ${accent} ${gender}`;
};

export function CreateForm({ options, onCreated }: { options: Options; onCreated: (job: Job) => void }) {
  const [sourceType, setSourceType] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [subreddit, setSubreddit] = useState("AskReddit");
  const [commentCount, setCommentCount] = useState(3);
  const [scriptMode, setScriptMode] = useState<"literal" | "claude">("literal");
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [voice, setVoice] = useState<string>("");
  const [speed, setSpeed] = useState(1.05);
  const [background, setBackground] = useState<BackgroundChoice>(
    options.backgrounds[0] ? { type: "clip", category: options.backgrounds[0].name } : { type: "procedural", preset: "sunset" },
  );
  const [captionStyle, setCaptionStyle] = useState(options.captionStyles[0] ?? "pop");
  const [music, setMusic] = useState<string | null>(null);
  const [maxDurationSec, setMaxDurationSec] = useState(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const voices = useMemo(
    () => options.voices.filter((v) => (language === "es" ? v.startsWith("e") : /^[ab]/.test(v))),
    [options.voices, language],
  );
  const selectedVoice = voices.includes(voice) ? voice : options.defaultVoices[language];
  const needsClaude = scriptMode === "claude" || language === "es";

  async function previewVoice() {
    setPreviewing(true);
    try {
      const src = await api.voicePreview(selectedVoice, language, speed);
      audio.current?.pause();
      audio.current = new Audio(src);
      await audio.current.play();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload: JobOptions = {
      source: sourceType === "url" ? { type: "url", url: url.trim() } : { type: "text", title, body, subreddit, author: "anonymous" },
      commentCount,
      scriptMode,
      language,
      voice: selectedVoice,
      speed,
      background,
      captionStyle,
      music,
      musicVolume: 0.12,
      maxDurationSec,
    };
    try {
      onCreated(await api.create(payload));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Nuevo video</h2>

      <div className="field">
        <div className="segmented" role="tablist">
          <button type="button" className={sourceType === "url" ? "on" : ""} onClick={() => setSourceType("url")}>
            Link de Reddit
          </button>
          <button type="button" className={sourceType === "text" ? "on" : ""} onClick={() => setSourceType("text")}>
            Pegar texto
          </button>
        </div>
        {sourceType === "url" ? (
          <>
            <input
              type="url"
              required
              placeholder="https://www.reddit.com/r/AskReddit/comments/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="hint">Elige un post con muchos comentarios: tomamos el post y los más votados.</p>
            {!options.reddit && (
              <p className="warn">
                Reddit bloquea las descargas anónimas. Agrega una clave de redditapis.com o credenciales aprobadas de Reddit en
                Ajustes → Fuentes, o usa “Pegar texto”.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="row">
              <input placeholder="r/" value={subreddit} onChange={(e) => setSubreddit(e.target.value)} style={{ maxWidth: 160 }} />
              <input required placeholder="Título del post" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <textarea rows={5} placeholder="Historia (opcional)" value={body} onChange={(e) => setBody(e.target.value)} />
          </>
        )}
      </div>

      <div className="grid2">
        {sourceType === "url" && (
          <label className="field">
            <span>Comentarios a incluir</span>
            <input type="number" min={0} max={10} value={commentCount} onChange={(e) => setCommentCount(Number(e.target.value))} />
          </label>
        )}
        <label className="field">
          <span>Duración máxima</span>
          <select value={maxDurationSec} onChange={(e) => setMaxDurationSec(Number(e.target.value))}>
            <option value={30}>30 s</option>
            <option value={60}>60 s</option>
            <option value={90}>90 s</option>
            <option value={120}>2 min</option>
            <option value={180}>3 min</option>
          </select>
        </label>
      </div>

      <div className="grid2">
        <div className="field">
          <span>Guion</span>
          <div className="segmented">
            <button type="button" className={scriptMode === "literal" ? "on" : ""} onClick={() => setScriptMode("literal")}>
              Literal
            </button>
            <button type="button" className={scriptMode === "claude" ? "on" : ""} onClick={() => setScriptMode("claude")}>
              Con Claude
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
      {needsClaude && !options.claude && (
        <p className="warn">
          {language === "es" ? "Traducir al español" : "Reescribir"} necesita un modelo para el agente de Guion (Ajustes → Modelos de IA).
        </p>
      )}

      <div className="field">
        <span>Voz</span>
        {options.ttsError ? (
          <p className="warn">{options.ttsError}</p>
        ) : (
          <div className="row">
            <select value={selectedVoice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => (
                <option key={v} value={v}>
                  {voiceLabel(v)}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={previewVoice} disabled={previewing}>
              {previewing ? "…" : "▶ Escuchar"}
            </button>
          </div>
        )}
        <label className="inline">
          Velocidad {speed.toFixed(2)}×
          <input type="range" min={0.8} max={1.4} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
      </div>

      <div className="field">
        <span>Fondo</span>
        <BackgroundPicker options={options} value={background} onChange={setBackground} />
      </div>

      <div className="grid2">
        <div className="field">
          <span>Subtítulos</span>
          <div className="segmented">
            {options.captionStyles.map((s) => (
              <button type="button" key={s} className={captionStyle === s ? "on" : ""} onClick={() => setCaptionStyle(s)}>
                {CAPTION_LABELS[s] ?? s}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Música</span>
          <select value={music ?? ""} onChange={(e) => setMusic(e.target.value || null)}>
            <option value="">Sin música</option>
            {options.music.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={busy || Boolean(options.ttsError)}>
        {busy ? "Creando…" : "Generar video"}
      </button>
    </form>
  );
}
