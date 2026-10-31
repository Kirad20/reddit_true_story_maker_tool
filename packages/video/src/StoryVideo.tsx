import React from "react";
import { AbsoluteFill, Html5Audio, Sequence, useVideoConfig } from "remotion";
import { Background } from "./Background";
import { Captions } from "./Captions";
import { PartBadge } from "./PartBadge";
import { RedditCard } from "./RedditCard";
import type { VideoComposition } from "./types";

export const StoryVideo: React.FC<VideoComposition> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const title = props.scenes.find((s) => s.kind === "title");
  const titleFrom = title ? Math.round(title.start * fps) : 0;
  const titleFrames = title ? Math.max(1, Math.round((title.end - title.start) * fps) + 6) : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Background background={props.background} totalFrames={durationInFrames} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)" }} />
      {title ? (
        <Sequence from={titleFrom} durationInFrames={titleFrames} name="Reddit card">
          <RedditCard post={props.post} durationInFrames={titleFrames} />
        </Sequence>
      ) : null}
      <Captions words={props.words} style={props.captionStyle} hiddenUntil={title ? title.end : 0} />
      {props.part ? <PartBadge label={props.part.label} /> : null}
      {props.audio.src ? <Html5Audio src={props.audio.src} /> : null}
      {props.music ? <Html5Audio src={props.music.src} volume={props.music.volume} loop /> : null}
    </AbsoluteFill>
  );
};
