import type { TimedWord } from "@tsm/video";
import { TTS_URL } from "./config";

export type TtsResult = {
  duration: number;
  timing_source: "whisper" | "proportional";
  blocks: { start: number; end: number }[];
  words: TimedWord[];
};

export class TtsError extends Error {}

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${TTS_URL}${path}`, init);
  } catch {
    throw new TtsError(`TTS service is not running at ${TTS_URL}. Start it with: npm run tts`);
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new TtsError(`TTS ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return res;
}

export async function synthesize(opts: {
  texts: string[];
  voice: string;
  lang: "en" | "es";
  speed: number;
  outPath: string;
}): Promise<TtsResult> {
  const res = await call("/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: opts.texts, voice: opts.voice, lang: opts.lang, speed: opts.speed, out_path: opts.outPath }),
  });
  return res.json() as Promise<TtsResult>;
}

export async function listVoices(): Promise<string[]> {
  const res = await call("/voices");
  return ((await res.json()) as { voices: string[] }).voices;
}

export async function previewVoice(body: { text: string; voice: string; lang: string; speed: number }): Promise<ArrayBuffer> {
  const res = await call("/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.arrayBuffer();
}
