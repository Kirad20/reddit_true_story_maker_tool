import { agentReady } from "./aiconfig";
import { LLMError, structured } from "./llm";
import type { ScriptBlock } from "./script";

/** Option value meaning "let the voice director pick". */
export const AUTO_VOICE = "auto";

export type VoiceChoice = {
  voice: string;
  reason: string;
  by: "agent" | "heuristic" | "default";
};

/** Known Kokoro voices with a short character note; unknown ones get a generic description. */
const VOICE_NOTES: Record<string, string> = {
  af_heart: "warm, friendly, expressive",
  af_bella: "energetic, bright, youthful",
  af_nicole: "soft, intimate, almost whispered",
  af_sarah: "clear, calm, neutral",
  af_sky: "light, youthful",
  af_nova: "confident, modern",
  af_river: "relaxed, conversational",
  af_jessica: "casual, chatty",
  af_alloy: "neutral, even",
  af_aoede: "smooth, melodic",
  af_kore: "steady, mature",
  am_adam: "deep, serious, dramatic",
  am_michael: "warm, trustworthy, storyteller",
  am_eric: "confident, clear",
  am_liam: "young, casual",
  am_onyx: "very deep, ominous, good for creepy stories",
  am_fenrir: "rough, intense",
  am_puck: "playful, comedic",
  am_echo: "neutral, even",
  am_santa: "jolly, old",
  bf_emma: "polished British, calm",
  bf_isabella: "British, warm",
  bf_alice: "British, crisp",
  bf_lily: "British, gentle",
  bm_george: "British, mature, authoritative",
  bm_lewis: "British, deep, dramatic",
  bm_daniel: "British, measured",
  bm_fable: "British, storyteller",
  ef_dora: "Spanish, warm, clear",
  em_alex: "Spanish, natural, conversational",
  em_santa: "Spanish, jolly, old",
};

export function describeVoice(id: string): { id: string; gender: "female" | "male"; accent: string; note: string } {
  const [prefix = ""] = id.split("_");
  const accent = { a: "American English", b: "British English", e: "Spanish" }[prefix[0]] ?? prefix[0]?.toUpperCase() ?? "?";
  return { id, gender: prefix[1] === "m" ? "male" : "female", accent, note: VOICE_NOTES[id] ?? "general purpose" };
}

/** Voices that can read a language (Kokoro: "a"/"b" prefixes English, "e" Spanish). */
export function voicesFor(language: "en" | "es", all: string[]): string[] {
  return all.filter((v) => (language === "es" ? v.startsWith("e") : /^[ab]/.test(v)));
}

const SYSTEM = `You are the casting director for narrated short story videos (TikTok, Reels, Shorts).
Pick the single text-to-speech voice that best fits the story:
- Match the narrator: if the first-person narrator is clearly a woman (mentions her husband/boyfriend as a woman, "as a mom", etc.) choose a female voice; if clearly a man, a male voice. When unclear, choose by tone.
- Match the tone: creepy or tense stories suit deep or soft voices; comedic stories suit playful or energetic voices; wholesome stories suit warm voices; drama suits expressive voices.
- Only choose from the list you are given.`;

const SCHEMA = {
  type: "object",
  properties: {
    voice: { type: "string" },
    narrator: { type: "string", enum: ["female", "male", "unclear"] },
    tone: { type: "string" },
    reason: { type: "string" },
  },
  required: ["voice", "narrator", "tone", "reason"],
  additionalProperties: false,
};

// Narrator cues used when no model is configured.
const FEMALE_CUES = /\b(my (husband|boyfriend|bf|hubby)|i \(\d{1,2} ?f\)|i \(f\d{1,2}\)|\(\d{1,2}f\)|as a (woman|mom|mother|girl)|i'm a (woman|mom|girl)|mi (esposo|marido|novio)\b|soy (mujer|mamá|madre))/i;
const MALE_CUES = /\b(my (wife|girlfriend|gf)|i \(\d{1,2} ?m\)|i \(m\d{1,2}\)|\(\d{1,2}m\)|as a (man|dad|father|guy)|i'm a (man|dad|guy)|mi (esposa|mujer|novia)\b|soy (hombre|papá|padre))/i;

/** Rule-based pick: narrator gender from common cues, else the language default. */
export function heuristicVoice(blocks: Pick<ScriptBlock, "kind" | "text">[], language: "en" | "es", available: string[], fallback: string): VoiceChoice {
  const text = blocks.filter((b) => b.kind !== "comment").map((b) => b.text).join(" ");
  const pool = voicesFor(language, available);
  const female = FEMALE_CUES.test(text);
  const male = MALE_CUES.test(text);
  const pick = (gender: "f" | "m") =>
    [fallback, ...pool].find((v) => v[1] === gender && pool.includes(v)) ?? (pool.includes(fallback) ? fallback : pool[0] ?? fallback);
  if (female && !male) return { voice: pick("f"), reason: "The narrator reads as a woman (heuristic).", by: "heuristic" };
  if (male && !female) return { voice: pick("m"), reason: "The narrator reads as a man (heuristic).", by: "heuristic" };
  return { voice: pool.includes(fallback) ? fallback : pool[0] ?? fallback, reason: "No clear narrator cues: default voice.", by: "default" };
}

/**
 * Voice director: an agent reads the story and picks the voice that fits the
 * narrator and tone. Falls back to the heuristic when no model is set or it fails.
 */
export async function chooseVoice(opts: {
  blocks: Pick<ScriptBlock, "kind" | "text">[];
  language: "en" | "es";
  available: string[];
  fallback: string;
}): Promise<VoiceChoice & { warning?: string }> {
  const pool = voicesFor(opts.language, opts.available);
  const heuristic = heuristicVoice(opts.blocks, opts.language, opts.available, opts.fallback);
  if (pool.length <= 1 || !agentReady("voice")) return heuristic;

  const story = opts.blocks
    .filter((b) => b.kind !== "comment")
    .map((b) => b.text)
    .join("\n\n")
    .slice(0, 5000);
  try {
    const result = await structured<{ voice: string; narrator: string; tone: string; reason: string }>({
      agent: "voice",
      system: SYSTEM,
      prompt: `Available voices (JSON):\n${JSON.stringify(pool.map(describeVoice))}\n\nStory:\n${story}\n\nReturn the chosen voice id, the narrator gender you inferred, the tone in a few words, and a one-sentence reason.`,
      schema: SCHEMA,
      maxTokens: 2000,
    });
    if (!pool.includes(result.voice)) {
      return { ...heuristic, warning: `The voice director picked an unknown voice (${result.voice}); used ${heuristic.voice}.` };
    }
    return { voice: result.voice, reason: `${result.reason} (${result.tone})`.trim(), by: "agent" };
  } catch (error) {
    if (!(error instanceof LLMError)) throw error;
    return { ...heuristic, warning: `Voice director failed (${error.message}); used ${heuristic.voice}.` };
  }
}
