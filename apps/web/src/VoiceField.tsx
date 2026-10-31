import { useMemo, useRef, useState } from "react";
import { AUTO_VOICE, api, type Options } from "./api";

export const voiceLabel = (v: string) => {
  if (v === AUTO_VOICE) return "🤖 Automático";
  const [prefix, name = v] = v.split("_");
  const accent = { a: "US", b: "UK", e: "ES" }[prefix[0]] ?? prefix[0]?.toUpperCase();
  const gender = prefix[1] === "f" ? "♀" : "♂";
  return `${name[0].toUpperCase()}${name.slice(1)} · ${accent} ${gender}`;
};

export const voicesForLanguage = (options: Options, language: "en" | "es") =>
  options.voices.filter((v) => (language === "es" ? v.startsWith("e") : /^[ab]/.test(v)));

/** Voice picker with an "automatic" option (the voice director chooses per story) and a preview button. */
export function VoiceField({
  options,
  language,
  voice,
  speed,
  onVoice,
  onSpeed,
  disabled,
  onError,
}: {
  options: Options;
  language: "en" | "es";
  voice: string;
  speed: number;
  onVoice: (voice: string) => void;
  onSpeed: (speed: number) => void;
  disabled?: boolean;
  onError?: (message: string) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const voices = useMemo(() => voicesForLanguage(options, language), [options, language]);
  const auto = voice === AUTO_VOICE;
  const selected = auto || voices.includes(voice) ? voice : options.defaultVoices[language];

  async function preview() {
    setPreviewing(true);
    try {
      const src = await api.voicePreview(selected, language, speed);
      audio.current?.pause();
      audio.current = new Audio(src);
      await audio.current.play();
    } catch (e) {
      onError?.((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="field">
      <span>Voz</span>
      {options.ttsError ? (
        <p className="warn">{options.ttsError}</p>
      ) : (
        <div className="row">
          <select value={selected} disabled={disabled} onChange={(e) => onVoice(e.target.value)}>
            <option value={AUTO_VOICE}>{voiceLabel(AUTO_VOICE)} · según la historia</option>
            {voices.map((v) => (
              <option key={v} value={v}>
                {voiceLabel(v)}
              </option>
            ))}
          </select>
          <button type="button" className="ghost" onClick={preview} disabled={disabled || previewing || auto} title={auto ? "La voz se elige al procesar" : undefined}>
            {previewing ? "…" : "▶ Escuchar"}
          </button>
        </div>
      )}
      {auto && (
        <p className="hint">
          {options.voiceAgent
            ? `El Director de voz (${options.voiceAgent}) lee la historia y elige la voz según el narrador y el tono.`
            : "Sin modelo para el Director de voz (Ajustes → Modelos de IA): se elige por pistas del texto (p. ej. “mi esposo” → voz femenina)."}
        </p>
      )}
      <label className="inline">
        Velocidad {speed.toFixed(2)}×
        <input type="range" min={0.8} max={1.4} step={0.05} value={speed} disabled={disabled} onChange={(e) => onSpeed(Number(e.target.value))} />
      </label>
    </div>
  );
}
