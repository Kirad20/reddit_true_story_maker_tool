import { VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH, durationInFrames, type VideoComposition } from "./types";

const sentence = "Coffee grounds are natural deodorizers. Put a tablespoon in a little cup and the funky smells disappear.";
const words = sentence.split(" ").map((text, i) => ({ text, start: 3 + i * 0.32, end: 3 + i * 0.32 + 0.3 }));
const audioSec = words[words.length - 1].end;

/** Silent placeholder composition for Remotion Studio and empty previews. */
export const sampleComposition: VideoComposition = {
  fps: VIDEO_FPS,
  width: VIDEO_WIDTH,
  height: VIDEO_HEIGHT,
  durationInFrames: durationInFrames(audioSec),
  audio: { src: "", durationSec: audioSec },
  music: null,
  background: { kind: "procedural", preset: "sunset" },
  post: { subreddit: "lifehacks", author: "storyteller", title: "Coffee is a natural deodorizer", upvotes: 12400, comments: 845 },
  scenes: [
    { kind: "title", text: "Coffee is a natural deodorizer", start: 0, end: 2.7 },
    { kind: "post", text: sentence, start: 3, end: audioSec },
  ],
  words,
  captionStyle: "pop",
};
