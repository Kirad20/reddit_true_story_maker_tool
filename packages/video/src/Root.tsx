import React from "react";
import { Composition } from "remotion";
import { sampleComposition } from "./sample";
import { StoryVideo } from "./StoryVideo";
import type { VideoComposition } from "./types";

export const COMPOSITION_ID = "StoryVideo";

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={StoryVideo}
    defaultProps={sampleComposition}
    fps={sampleComposition.fps}
    width={sampleComposition.width}
    height={sampleComposition.height}
    durationInFrames={sampleComposition.durationInFrames}
    calculateMetadata={({ props }: { props: VideoComposition }) => ({
      durationInFrames: props.durationInFrames,
      fps: props.fps,
      width: props.width,
      height: props.height,
    })}
  />
);
