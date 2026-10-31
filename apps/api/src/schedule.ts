import type { Platform, Publication } from "./domain";

/** Parse "HH:MM" slots into minutes after midnight, sorted, invalid ones dropped. */
export function parseSlots(slots: string[]): number[] {
  return slots
    .map((s) => /^(\d{1,2}):(\d{2})$/.exec(s.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m) && Number(m![1]) < 24 && Number(m![2]) < 60)
    .map((m) => Number(m[1]) * 60 + Number(m[2]))
    .sort((a, b) => a - b);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/**
 * Next free publishing slot for a platform: the earliest configured local time
 * after `now` on a day that still has room under the daily limit, and not
 * already taken by another publication of the same platform.
 */
export function nextSlot(opts: {
  platform: Platform;
  now: Date;
  slots: string[];
  dailyLimit: number;
  existing: Pick<Publication, "platform" | "status" | "scheduledAt" | "publishedAt">[];
}): Date {
  const minutes = parseSlots(opts.slots);
  const active = opts.existing.filter(
    (p) => p.platform === opts.platform && ["scheduled", "publishing", "published"].includes(p.status),
  );
  const times = active.map((p) => new Date(p.publishedAt ?? p.scheduledAt ?? 0));
  const perDay = new Map<string, number>();
  for (const t of times) perDay.set(dayKey(t), (perDay.get(dayKey(t)) ?? 0) + 1);
  const taken = new Set(active.map((p) => p.scheduledAt).filter(Boolean));

  if (minutes.length === 0) return new Date(opts.now.getTime() + 60_000);
  for (let day = 0; day < 60; day++) {
    const base = new Date(opts.now);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + day);
    if ((perDay.get(dayKey(base)) ?? 0) >= opts.dailyLimit) continue;
    for (const m of minutes) {
      const slot = new Date(base);
      slot.setMinutes(m);
      if (slot.getTime() <= opts.now.getTime() || taken.has(slot.toISOString())) continue;
      return slot;
    }
  }
  throw new Error("No free publishing slot in the next 60 days");
}
