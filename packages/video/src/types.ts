export type CaptionStyle = "pop" | "karaoke" | "boxed";

export type ProceduralPreset = "sunset" | "ocean" | "neon";

export type Background =
  | { kind: "video"; src: string; startAt: number; durationSec: number }
  | { kind: "procedural"; preset: ProceduralPreset };

export type SceneKind = "title" | "post" | "comment" | "outro";

export type Scene = {
  kind: SceneKind;
  text: string;
  author?: string;
  start: number;
  end: number;
};

export type TimedWord = { text: string; start: number; end: number };

export type PostCard = {
  subreddit: string;
  author: string;
  title: string;
  upvotes: number;
  comments: number;
};

export type VideoComposition = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  audio: { src: string; durationSec: number };
  music: { src: string; volume: number } | null;
  background: Background;
  post: PostCard;
  scenes: Scene[];
  words: TimedWord[];
  captionStyle: CaptionStyle;
  /** Set when the story is split for TikTok/Facebook, e.g. { index: 2, total: 3, label: "Parte 2/3" }. */
  part?: { index: number; total: number; label: string } | null;
};

export const VIDEO_FPS = 30;
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
/** Silence kept after the narration ends. */
export const TAIL_SEC = 0.8;

export function durationInFrames(audioSec: number, fps = VIDEO_FPS): number {
  return Math.max(1, Math.ceil((audioSec + TAIL_SEC) * fps));
}
