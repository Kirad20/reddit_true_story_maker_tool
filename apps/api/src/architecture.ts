/**
 * How the project works inside, described for the Observabilidad tab. Keep it in
 * step with the code it points to: it is the map users read to audit the system.
 */
export type FlowStage = {
  id: string;
  label: string;
  /** Agent that runs in this stage (Settings → Modelos), if any. */
  agent: string | null;
  /** Telemetry step name recorded for it, if any. */
  step: string | null;
  where: string;
  description: string;
};

export const AGENT_FLOW: { pipeline: FlowStage[]; video: FlowStage[]; publishing: FlowStage[] } = {
  pipeline: [
    {
      id: "discover",
      label: "Descubrir historias",
      agent: "writer",
      step: null,
      where: "apps/api/src/sources.ts · agents.ts (writeOriginalStories)",
      description:
        "El Escritor inventa historias originales por género; si está activa, la fuente Reddit trae los posts más votados de los subreddits configurados.",
    },
    {
      id: "curate",
      label: "Curar",
      agent: "curator",
      step: null,
      where: "apps/api/src/agents.ts (curateStories) · automation.ts (curate)",
      description:
        "El Curador puntúa cada historia del 1 al 10 y marca problemas (datos personales, contenido sensible, longitud). Con aprobación automática pasan las que superan el mínimo.",
    },
    {
      id: "split",
      label: "Dividir en partes",
      agent: "splitter",
      step: null,
      where: "apps/api/src/splitter.ts (planSplit)",
      description:
        "Para historias largas, el Divisor decide si conviene publicar en 2-3 partes para TikTok/Facebook y en qué frase cortar. Sin modelo usa un corte por longitud.",
    },
  ],
  video: [
    {
      id: "fetching",
      label: "Fuente",
      agent: null,
      step: "fetching",
      where: "apps/api/src/reddit.ts · jobs.ts",
      description: "Lee el post de Reddit (redditapis.com o API oficial) o toma el texto pegado.",
    },
    {
      id: "scripting",
      label: "Guion",
      agent: "script",
      step: "scripting",
      where: "apps/api/src/script.ts · claude.ts (adaptScript)",
      description:
        "Arma bloques (título, post, comentarios) ajustados a la duración máxima. El agente de Guion los reescribe o traduce al español cuando se pide.",
    },
    {
      id: "voice-casting",
      label: "Elegir voz",
      agent: "voice",
      step: "voice-casting",
      where: "apps/api/src/voice.ts (chooseVoice)",
      description:
        "Solo con voz Automática: el Director de voz lee la historia, deduce el género del narrador y el tono, y elige una voz del catálogo. Sin modelo usa pistas del texto.",
    },
    {
      id: "tts",
      label: "Voz",
      agent: null,
      step: "tts",
      where: "services/tts (Kokoro + Whisper) · apps/api/src/tts.ts",
      description: "Kokoro sintetiza la narración local y Whisper alinea cada palabra para los subtítulos.",
    },
    {
      id: "composing",
      label: "Composición",
      agent: null,
      step: "composing",
      where: "apps/api/src/composition.ts",
      description: "Junta audio, tiempos por palabra, fondo, música y tarjeta de Reddit en la composición que ve la vista previa.",
    },
    {
      id: "rendering",
      label: "Render MP4",
      agent: null,
      step: "rendering",
      where: "apps/api/src/render.ts (Remotion)",
      description: "Remotion renderiza el MP4 vertical 1080×1920 con Chrome headless.",
    },
  ],
  publishing: [
    {
      id: "metadata",
      label: "Metadatos",
      agent: "metadata",
      step: null,
      where: "apps/api/src/agents.ts (writeMetadata)",
      description: "El agente de Publicación escribe título, descripción y hashtags por plataforma.",
    },
    {
      id: "publish",
      label: "Publicar",
      agent: null,
      step: null,
      where: "apps/api/src/publish/*",
      description: "Tras la revisión, sube el video a YouTube, TikTok y Facebook en los horarios configurados.",
    },
  ],
};
