import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ImageStore } from "../ports";

export const STUDIO_MEDIA_PREFIX = "/media/studio/";

/** Stores generated images on disk; the server exposes the folder under /media/studio. */
export class FileImageStore implements ImageStore {
  constructor(readonly dir: string) {}

  async save(png: Buffer): Promise<{ url: string; filePath: string }> {
    await fs.mkdir(this.dir, { recursive: true });
    const name = `${randomUUID()}.png`;
    const filePath = path.join(this.dir, name);
    await fs.writeFile(filePath, png);
    return { url: `${STUDIO_MEDIA_PREFIX}${name}`, filePath };
  }

  /** Media url → file path, refusing anything that escapes the folder. */
  pathOf(url: string): string {
    if (!url.startsWith(STUDIO_MEDIA_PREFIX)) throw new Error("Not a studio media url");
    const name = url.slice(STUDIO_MEDIA_PREFIX.length);
    if (!/^[\w.-]+$/.test(name) || name.includes("..")) throw new Error("Invalid studio media url");
    return path.join(this.dir, name);
  }
}
