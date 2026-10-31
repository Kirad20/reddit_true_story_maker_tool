import type { SceneKind } from "@tsm/video";
import type { RedditPost } from "./reddit";

export type ScriptBlock = { kind: SceneKind; text: string; author?: string };

// Reddit shorthand the voice would otherwise spell out letter by letter.
const ACRONYMS: [RegExp, string][] = [
  [/\bAITAH?\b/g, "Am I the jerk"],
  [/\bWIBTA\b/g, "Would I be the jerk"],
  [/\bNTA\b/g, "Not the jerk"],
  [/\bYTA\b/g, "You're the jerk"],
  [/\bESH\b/g, "Everyone sucks here"],
  [/\bNAH\b/g, "No jerks here"],
  [/\bTIFU\b/g, "Today I messed up"],
  [/\bTIL\b/g, "Today I learned"],
  [/\bTL;?DR:?/gi, "In short:"],
  [/\bELI5\b/g, "Explain like I'm five"],
  [/\bIMO\b/g, "in my opinion"],
  [/\bIMHO\b/g, "in my humble opinion"],
  [/\bIIRC\b/g, "if I remember correctly"],
  [/\bAFAIK\b/g, "as far as I know"],
  [/\bOP\b/g, "O.P."],
  [/\bMIL\b/g, "mother-in-law"],
  [/\bFIL\b/g, "father-in-law"],
];

export function cleanText(input: string): string {
  let text = input
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]+\)/g, "$1") // markdown links → label
    .replace(/https?:\/\/\S+/g, "") // bare links
    .replace(/^>+\s?/gm, "") // quotes
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/[*_~`^]+/g, "") // emphasis / code
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x200B;/g, "")
    .replace(/\b([ru])\/(\w+)/g, "$2"); // r/sub, u/name read badly
  for (const [pattern, replacement] of ACRONYMS) text = text.replace(pattern, replacement);
  return text
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Rough narration time at Kokoro's default pace (~165 wpm). */
export function estimateSeconds(text: string, speed = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / (2.75 * speed);
}

function truncateToSeconds(text: string, seconds: number, speed: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*|\S[^.!?]*$/g) ?? [text];
  let out = "";
  for (const sentence of sentences) {
    const next = (out + " " + sentence).trim();
    if (out && estimateSeconds(next, speed) > seconds) break;
    out = next;
  }
  return out;
}

export function buildLiteralBlocks(post: RedditPost): ScriptBlock[] {
  const blocks: ScriptBlock[] = [{ kind: "title", text: cleanText(post.title), author: post.author }];
  const body = cleanText(post.body);
  if (body) blocks.push({ kind: "post", text: body, author: post.author });
  for (const comment of post.comments) {
    const text = cleanText(comment.body);
    if (text) blocks.push({ kind: "comment", text, author: comment.author });
  }
  return blocks;
}

const NUMBER_WORDS = { en: ["one", "two", "three"], es: ["uno", "dos", "tres"] };

export function partLabel(part: { index: number; total: number }, language: "en" | "es"): string {
  return `${language === "es" ? "Parte" : "Part"} ${part.index}/${part.total}`;
}

/**
 * Announce the part in the narrated title and, except for the last part,
 * close with a call to follow for the next one.
 */
export function withPartNarration(
  blocks: ScriptBlock[],
  part: { index: number; total: number },
  language: "en" | "es",
): ScriptBlock[] {
  const words = NUMBER_WORDS[language];
  const out = blocks.map((b) => ({ ...b }));
  const title = out.find((b) => b.kind === "title");
  if (title) {
    const spoken = language === "es" ? `Parte ${words[part.index - 1]}.` : `Part ${words[part.index - 1]}.`;
    title.text = `${title.text.replace(/[.!?]*$/, (p) => p || ".")} ${spoken}`;
  }
  if (part.index < part.total) {
    const next = words[part.index];
    out.push({
      kind: "outro",
      text: language === "es" ? `Sígueme para no perderte la parte ${next}.` : `Follow so you don't miss part ${next}.`,
    });
  }
  return out;
}

/** Drop trailing comments (then shorten the post) until the narration fits. */
export function fitToDuration(blocks: ScriptBlock[], maxSeconds: number, speed = 1): ScriptBlock[] {
  const total = (list: ScriptBlock[]) => list.reduce((s, b) => s + estimateSeconds(b.text, speed) + 0.35, 0);
  const out = [...blocks];
  while (out.length > 2 && out[out.length - 1].kind === "comment" && total(out) > maxSeconds) out.pop();
  if (total(out) > maxSeconds) {
    const fixed = total(out.filter((b) => b.kind !== "post"));
    const index = out.findIndex((b) => b.kind === "post");
    if (index >= 0) {
      out[index] = { ...out[index], text: truncateToSeconds(out[index].text, Math.max(5, maxSeconds - fixed), speed) };
    }
  }
  return out.filter((b) => b.text.length > 0);
}
