import { LLMError, structured } from "./llm";
import type { ScriptBlock } from "./script";

export type RewriteOptions = { rewrite: boolean; language: "en" | "es" };

const SCHEMA = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["title", "post", "comment"] },
          text: { type: "string" },
        },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["blocks"],
  additionalProperties: false,
};

const SYSTEM = `You adapt Reddit posts into narration scripts for short vertical videos (TikTok, Reels, Shorts).
The text is read aloud by a text-to-speech voice, so write only words meant to be spoken: no emojis, hashtags, URLs, markdown, or stage directions.
Keep the story's facts, voice and first-person perspective. Never invent events.`;

function instructions(blocks: ScriptBlock[], opts: RewriteOptions): string {
  const tasks: string[] = [];
  if (opts.rewrite) {
    tasks.push(
      "Rewrite each block to be punchy and easy to follow when heard: make the title a curiosity hook, tighten rambling sentences, keep each block roughly the same length or shorter.",
    );
  } else {
    tasks.push("Keep the wording as close to the original as possible.");
  }
  if (opts.language === "es") {
    tasks.push("Translate everything into natural, neutral Latin American Spanish.");
  }
  tasks.push(
    `Return exactly ${blocks.length} blocks, in the same order and with the same kind values as the input.`,
  );
  return `${tasks.join("\n")}\n\nInput blocks (JSON):\n${JSON.stringify(blocks.map(({ kind, text }) => ({ kind, text })))}`;
}

// Model calls go through llm.ts (Anthropic or an OpenAI-compatible provider).
export { LLMError as ClaudeError, structured };

export async function adaptScript(blocks: ScriptBlock[], opts: RewriteOptions): Promise<ScriptBlock[]> {
  const parsed = await structured<{ blocks: { kind: ScriptBlock["kind"]; text: string }[] }>({
    agent: "script",
    system: SYSTEM,
    prompt: instructions(blocks, opts),
    schema: SCHEMA,
  });
  if (parsed.blocks.length !== blocks.length) {
    throw new LLMError(`The model returned ${parsed.blocks.length} blocks, expected ${blocks.length}`);
  }
  return parsed.blocks.map((b, i) => ({ kind: blocks[i].kind, text: b.text.trim(), author: blocks[i].author }));
}
