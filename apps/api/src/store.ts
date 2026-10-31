import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config";

/**
 * A tiny JSON-file collection: the whole set lives in memory and is rewritten
 * atomically on every change. Plenty for a single-user local tool.
 */
export class Collection<T extends { id: string }> {
  private items = new Map<string, T>();
  private file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(name: string) {
    this.file = path.join(DATA_DIR, `${name}.json`);
  }

  async load(): Promise<void> {
    try {
      const list = JSON.parse(await fs.readFile(this.file, "utf8")) as T[];
      this.items = new Map(list.map((item) => [item.id, item]));
    } catch {
      this.items = new Map();
    }
  }

  all(): T[] {
    return [...this.items.values()];
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  find(predicate: (item: T) => boolean): T | undefined {
    return this.all().find(predicate);
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  async put(item: T): Promise<T> {
    this.items.set(item.id, item);
    await this.flush();
    return item;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const current = this.items.get(id);
    if (!current) throw new Error(`Not found: ${id}`);
    const next = { ...current, ...patch };
    this.items.set(id, next);
    await this.flush();
    return next;
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
    await this.flush();
  }

  private flush(): Promise<void> {
    const data = JSON.stringify(this.all(), null, 2);
    this.writing = this.writing.then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, this.file);
    });
    return this.writing;
  }
}

/** A single JSON document with defaults merged in on load. */
export class Doc<T extends object> {
  private value: T;
  private file: string;

  constructor(name: string, private defaults: T) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    this.value = structuredClone(defaults);
  }

  async load(): Promise<T> {
    try {
      this.value = deepMerge(structuredClone(this.defaults), JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch {
      this.value = structuredClone(this.defaults);
    }
    return this.value;
  }

  get(): T {
    return this.value;
  }

  async set(value: T): Promise<T> {
    this.value = value;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(value, null, 2));
    return value;
  }
}

function deepMerge<T>(base: T, extra: unknown): T {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return (extra ?? base) as T;
  const out = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(extra as Record<string, unknown>)) {
    const current = out[key];
    out[key] =
      current && typeof current === "object" && !Array.isArray(current) && value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(current, value)
        : value;
  }
  return out as T;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
