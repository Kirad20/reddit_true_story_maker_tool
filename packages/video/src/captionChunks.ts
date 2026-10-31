import type { TimedWord } from "./types";

export type CaptionChunk = { words: TimedWord[]; start: number; end: number };

const SENTENCE_END = /[.!?…:;]["')\]]*$/;
const CLAUSE_END = /[,]["')\]]*$/;

/**
 * Group words into short on-screen chunks (TikTok-style captions).
 * A chunk ends after `maxWords`, at punctuation, or before a long pause.
 */
export function chunkWords(words: TimedWord[], maxWords = 3, maxChars = 18, pauseSec = 0.35): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: TimedWord[] = [];

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const prev = current[current.length - 1];
    const chars = current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
    if (current.length > 0 && (current.length >= maxWords || chars > maxChars || (prev && word.start - prev.end > pauseSec))) {
      flush();
    }
    current.push(word);
    if (SENTENCE_END.test(word.text) || CLAUSE_END.test(word.text)) flush();
  }
  flush();

  // Keep each chunk on screen until the next one starts so captions don't flicker.
  for (let i = 0; i < chunks.length - 1; i++) {
    const gap = chunks[i + 1].start - chunks[i].end;
    if (gap > 0 && gap < 0.6) chunks[i].end = chunks[i + 1].start;
  }
  return chunks;
}

export function activeChunk(chunks: CaptionChunk[], t: number): CaptionChunk | null {
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chunks[mid];
    if (t < c.start) hi = mid - 1;
    else if (t >= c.end) lo = mid + 1;
    else return c;
  }
  return null;
}

export function activeWordIndex(chunk: CaptionChunk, t: number): number {
  for (let i = chunk.words.length - 1; i >= 0; i--) {
    if (t >= chunk.words[i].start) return i;
  }
  return 0;
}
