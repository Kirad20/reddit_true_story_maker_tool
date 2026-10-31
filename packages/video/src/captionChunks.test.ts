import { describe, expect, it } from "vitest";
import { activeChunk, activeWordIndex, chunkWords } from "./captionChunks";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("chunkWords", () => {
  it("groups at most maxWords, breaks on punctuation and long lines", () => {
    const chunks = chunkWords([
      w("Coffee", 0, 0.3), w("grounds", 0.3, 0.6), w("are", 0.6, 0.8), w("natural", 0.8, 1.1),
      w("deodorizers.", 1.1, 1.6), w("Try", 1.7, 1.9), w("it", 1.9, 2.0),
    ]);
    expect(chunks.map((c) => c.words.map((x) => x.text).join(" "))).toEqual([
      "Coffee grounds are",
      "natural",
      "deodorizers.",
      "Try it",
    ]);
  });

  it("breaks before a long pause", () => {
    const chunks = chunkWords([w("Wait", 0, 0.3), w("what", 1.5, 1.8)]);
    expect(chunks).toHaveLength(2);
  });

  it("bridges short gaps so captions do not flicker", () => {
    const chunks = chunkWords([w("Hello.", 0, 0.5), w("World", 0.8, 1.2)]);
    expect(chunks[0].end).toBe(0.8);
  });
});

describe("activeChunk / activeWordIndex", () => {
  const chunks = chunkWords([w("one", 0, 0.4), w("two", 0.4, 0.8), w("three.", 0.8, 1.2), w("four", 2, 2.4)]);

  it("finds the chunk on screen and the spoken word", () => {
    const c = activeChunk(chunks, 0.5);
    expect(c?.words[0].text).toBe("one");
    expect(activeWordIndex(c!, 0.5)).toBe(1);
  });

  it("returns null between distant chunks", () => {
    expect(activeChunk(chunks, 1.6)).toBeNull();
  });
});
