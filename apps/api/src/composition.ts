import {
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  durationInFrames,
  type Background,
  type CaptionStyle,
  type PostCard,
  type VideoComposition,
} from "@tsm/video";
import type { ScriptBlock } from "./script";
import type { TtsResult } from "./tts";

export function buildComposition(input: {
  audioSrc: string;
  tts: TtsResult;
  blocks: ScriptBlock[];
  post: PostCard;
  background: Background;
  music: VideoComposition["music"];
  captionStyle: CaptionStyle;
  part?: VideoComposition["part"];
}): VideoComposition {
  const { tts, blocks } = input;
  if (tts.blocks.length !== blocks.length) {
    throw new Error(`TTS returned ${tts.blocks.length} timings for ${blocks.length} blocks`);
  }
  return {
    fps: VIDEO_FPS,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    durationInFrames: durationInFrames(tts.duration),
    audio: { src: input.audioSrc, durationSec: tts.duration },
    music: input.music,
    background: input.background,
    post: input.post,
    scenes: blocks.map((b, i) => ({ kind: b.kind, text: b.text, author: b.author, start: tts.blocks[i].start, end: tts.blocks[i].end })),
    words: tts.words,
    captionStyle: input.captionStyle,
    part: input.part ?? null,
  };
}

/** Pick where in the clip to start so the narration never runs past its end. */
export function pickStartAt(clipSec: number, videoSec: number, random = Math.random): number {
  const room = clipSec - videoSec;
  return room > 1 ? Math.round(random() * room * 10) / 10 : 0;
}

/** Media paths are stored relative ("/media/..."); the renderer needs absolute URLs. */
export function withOrigin(comp: VideoComposition, origin: string): VideoComposition {
  const abs = (src: string) => (src.startsWith("/") ? origin + src : src);
  return {
    ...comp,
    audio: { ...comp.audio, src: abs(comp.audio.src) },
    music: comp.music ? { ...comp.music, src: abs(comp.music.src) } : null,
    background: comp.background.kind === "video" ? { ...comp.background, src: abs(comp.background.src) } : comp.background,
  };
}
