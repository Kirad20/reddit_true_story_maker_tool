// End-to-end smoke test without network: fixture post → Kokoro voice → Remotion MP4.
// Requires the TTS service (npm run tts). Run: npm run smoke
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { getVideoMetadata } from "@remotion/renderer";
import { buildComposition, withOrigin } from "../src/composition";
import { DEFAULT_VOICES, JOBS_DIR } from "../src/config";
import { parseRedditListing } from "../src/reddit";
import { renderVideo } from "../src/render";
import { buildLiteralBlocks, fitToDuration } from "../src/script";
import { synthesize } from "../src/tts";

const fixture = JSON.parse(await fs.readFile(new URL("../test/fixtures/reddit-post.json", import.meta.url), "utf8"));
const dir = path.join(JOBS_DIR, "_smoke");
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });

const post = parseRedditListing(fixture, 1);
const blocks = fitToDuration(buildLiteralBlocks(post), 30);
console.log(`script: ${blocks.length} blocks`);

let t = Date.now();
const tts = await synthesize({
  texts: blocks.map((b) => b.text),
  voice: DEFAULT_VOICES.en,
  lang: "en",
  speed: 1.05,
  outPath: path.join(dir, "voice.wav"),
});
console.log(`tts: ${tts.duration}s audio, ${tts.words.length} words (${tts.timing_source}) in ${Date.now() - t}ms`);

const composition = buildComposition({
  audioSrc: "/media/jobs/_smoke/voice.wav",
  tts,
  blocks,
  post: { subreddit: post.subreddit, author: post.author, title: blocks[0].text, upvotes: post.score, comments: post.numComments },
  background: { kind: "procedural", preset: "neon" },
  music: null,
  captionStyle: "pop",
});

// Serve the job media to the renderer from a throwaway port.
const app = express();
app.use("/media/jobs", express.static(JOBS_DIR));
const server = app.listen(0);
const port = (server.address() as { port: number }).port;

t = Date.now();
const output = path.join(dir, "final.mp4");
let shown = -10;
await renderVideo(withOrigin(composition, `http://127.0.0.1:${port}`), output, (p) => {
  if (p * 100 - shown >= 10) {
    shown = Math.floor(p * 100);
    console.log(`render ${shown}%`);
  }
});
server.close();
console.log(`render: ${Date.now() - t}ms`);

const meta = await getVideoMetadata(output);
const expected = composition.durationInFrames / composition.fps;
console.log(`output: ${output} ${meta.width}x${meta.height} ${meta.durationInSeconds?.toFixed(2)}s (expected ${expected.toFixed(2)}s)`);
const ok = meta.width === 1080 && meta.height === 1920 && Math.abs((meta.durationInSeconds ?? 0) - expected) < 0.5;
console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
process.exit(ok ? 0 : 1);
