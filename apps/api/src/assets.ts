import fs from "node:fs/promises";
import path from "node:path";
import type { RequestHandler } from "express";
import express from "express";
import { getVideoMetadata } from "@remotion/renderer";
import type { ProceduralPreset } from "@tsm/video";
import { ASSETS_DIR, BACKGROUNDS_DIR, MUSIC_DIR, S3_ASSETS } from "./config";
import { createS3AssetStore, type S3AssetStore } from "./s3assets";

const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

export const PROCEDURAL_PRESETS: ProceduralPreset[] = ["sunset", "ocean", "neon"];

export type BackgroundCategory = { name: string; clips: string[] };

/**
 * Where backgrounds and music live: the local assets/ folder (development, single volume) or an
 * S3-compatible bucket such as SeaweedFS (production). Both are served to the preview player and the
 * renderer under /media/assets/<backgrounds|music>/..., so compositions do not depend on the backend.
 */
export interface AssetStore {
  readonly kind: "local" | "s3";
  /** Relative keys ("backgrounds/<category>/<file>", "music/<file>"). */
  listKeys(): Promise<string[]>;
  clipDuration(key: string): Promise<number>;
  /** Express handler mounted at /media/assets (range requests supported). */
  handler(): RequestHandler;
  /** Null when reachable, otherwise the reason (for /api/ready and the startup log). */
  check(): Promise<string | null>;
}

const isVideo = (name: string) => VIDEO_EXT.has(path.extname(name).toLowerCase());
const isAudio = (name: string) => AUDIO_EXT.has(path.extname(name).toLowerCase());

/** A single path segment: no separators, no traversal, no hidden files. */
export function validSegment(segment: string): boolean {
  return segment.length > 0 && segment.length <= 255 && !/[\\/\u0000]/.test(segment) && !segment.startsWith(".");
}

/** Relative key of an asset; throws on names that could escape the asset root. */
export function assetKey(kind: "backgrounds", category: string, file: string): string;
export function assetKey(kind: "music", file: string): string;
export function assetKey(kind: "backgrounds" | "music", ...parts: string[]): string {
  if (!parts.every(validSegment)) throw new Error(`Invalid ${kind === "music" ? "music" : "background"} path`);
  return [kind, ...parts].join("/");
}

/** Parse a /media/assets request path into a key, or null if it is not a valid asset path. */
export function keyFromUrlPath(urlPath: string): string | null {
  let segments: string[];
  try {
    segments = urlPath.replace(/^\/+/, "").split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  if (!segments.every(validSegment)) return null;
  const [kind] = segments;
  if (kind === "backgrounds" && segments.length === 3 && isVideo(segments[2])) return segments.join("/");
  if (kind === "music" && segments.length === 2 && isAudio(segments[1])) return segments.join("/");
  return null;
}

/** Group keys into background categories and music files. */
export function groupKeys(keys: string[]): { backgrounds: BackgroundCategory[]; music: string[] } {
  const categories = new Map<string, string[]>();
  const music: string[] = [];
  for (const key of keys) {
    const parts = key.split("/");
    if (!parts.every(validSegment)) continue;
    if (parts[0] === "backgrounds" && parts.length === 3 && isVideo(parts[2])) {
      categories.set(parts[1], [...(categories.get(parts[1]) ?? []), parts[2]]);
    } else if (parts[0] === "music" && parts.length === 2 && isAudio(parts[1])) {
      music.push(parts[1]);
    }
  }
  return {
    backgrounds: [...categories.keys()].sort().map((name) => ({ name, clips: categories.get(name)!.sort() })),
    music: music.sort(),
  };
}

class LocalAssetStore implements AssetStore {
  readonly kind = "local";

  async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    const files = async (dir: string) => {
      try {
        return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
      } catch {
        return [];
      }
    };
    let categories: string[] = [];
    try {
      categories = (await fs.readdir(BACKGROUNDS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      // no backgrounds folder
    }
    for (const category of categories) {
      for (const file of await files(path.join(BACKGROUNDS_DIR, category))) keys.push(`backgrounds/${category}/${file}`);
    }
    for (const file of await files(MUSIC_DIR)) keys.push(`music/${file}`);
    return keys;
  }

  async clipDuration(key: string): Promise<number> {
    const meta = await getVideoMetadata(path.join(ASSETS_DIR, ...key.split("/")));
    return meta.durationInSeconds ?? 0;
  }

  handler(): RequestHandler {
    return express.static(ASSETS_DIR, { index: false, dotfiles: "deny" });
  }

  async check(): Promise<string | null> {
    return null;
  }
}

let store: AssetStore | null = null;

export function assetStore(): AssetStore {
  store ??= S3_ASSETS ? createS3AssetStore(S3_ASSETS) : new LocalAssetStore();
  return store;
}

/** Tests swap the backend. */
export function setAssetStore(next: AssetStore | S3AssetStore | null): void {
  store = next;
  listing = null;
  durations.clear();
}

// Listing a bucket on every /api/options call is wasteful: keep it for a short while.
const LISTING_TTL_MS = 30_000;
let listing: { at: number; value: Promise<{ backgrounds: BackgroundCategory[]; music: string[] }> } | null = null;

function listAssets() {
  if (listing && Date.now() - listing.at < LISTING_TTL_MS) return listing.value;
  const value = assetStore().listKeys().then(groupKeys);
  listing = { at: Date.now(), value };
  value.catch(() => {
    if (listing?.value === value) listing = null;
  });
  return value;
}

export async function listBackgrounds(): Promise<BackgroundCategory[]> {
  return (await listAssets()).backgrounds;
}

export async function listMusic(): Promise<string[]> {
  return (await listAssets()).music;
}

const durations = new Map<string, number>();

/** Length of a background clip in seconds (cached: clips do not change under the same name often). */
export async function clipDuration(category: string, file: string): Promise<number> {
  const key = assetKey("backgrounds", category, file);
  const cached = durations.get(key);
  if (cached !== undefined) return cached;
  const seconds = await assetStore().clipDuration(key);
  durations.set(key, seconds);
  return seconds;
}

/** URL path the preview and the renderer use for an asset. */
export function assetUrl(key: string): string {
  return `/media/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}
