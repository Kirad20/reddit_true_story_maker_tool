import fs from "node:fs/promises";
import path from "node:path";
import { getVideoMetadata } from "@remotion/renderer";
import type { ProceduralPreset } from "@tsm/video";
import { BACKGROUNDS_DIR, MUSIC_DIR } from "./config";

const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

export const PROCEDURAL_PRESETS: ProceduralPreset[] = ["sunset", "ocean", "neon"];

export type BackgroundCategory = { name: string; clips: string[] };

async function listFiles(dir: string, exts: Set<string>): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && exts.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function listBackgrounds(): Promise<BackgroundCategory[]> {
  let dirs: string[] = [];
  try {
    dirs = (await fs.readdir(BACKGROUNDS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const categories = await Promise.all(
    dirs.sort().map(async (name) => ({ name, clips: await listFiles(path.join(BACKGROUNDS_DIR, name), VIDEO_EXT) })),
  );
  return categories.filter((c) => c.clips.length > 0);
}

export async function listMusic(): Promise<string[]> {
  return listFiles(MUSIC_DIR, AUDIO_EXT);
}

/** Resolve a clip inside assets/backgrounds without allowing path traversal. */
export function clipPath(category: string, file: string): string {
  const resolved = path.resolve(BACKGROUNDS_DIR, category, file);
  if (!resolved.startsWith(path.resolve(BACKGROUNDS_DIR) + path.sep)) throw new Error("Invalid background path");
  return resolved;
}

export function musicPath(file: string): string {
  const resolved = path.resolve(MUSIC_DIR, file);
  if (!resolved.startsWith(path.resolve(MUSIC_DIR) + path.sep)) throw new Error("Invalid music path");
  return resolved;
}

export async function clipDuration(file: string): Promise<number> {
  const meta = await getVideoMetadata(file);
  return meta.durationInSeconds ?? 0;
}
