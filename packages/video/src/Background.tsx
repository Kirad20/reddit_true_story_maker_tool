import React from "react";
import { AbsoluteFill, Loop, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Background as BackgroundProps, ProceduralPreset } from "./types";

const PRESETS: Record<ProceduralPreset, { from: string; to: string; shapes: string[] }> = {
  sunset: { from: "#ff7e5f", to: "#6a3093", shapes: ["#ffd86f", "#fc6262", "#ffffff"] },
  ocean: { from: "#00c6ff", to: "#0b2a6f", shapes: ["#7ef9ff", "#2ee59d", "#ffffff"] },
  neon: { from: "#0f0c29", to: "#302b63", shapes: ["#ff00e5", "#00f0ff", "#b6ff00"] },
};

/** Endless "satisfying" motion used when the user has no gameplay clips yet. */
const Procedural: React.FC<{ preset: ProceduralPreset }> = ({ preset }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const p = PRESETS[preset] ?? PRESETS.sunset;
  const rows = 9;
  const cols = 5;
  const size = width / cols;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${p.from}, ${p.to})`, overflow: "hidden" }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        const phase = (frame / 30 + r * 0.35 + c * 0.2) % 4;
        const rot = interpolate(phase, [0, 4], [0, 360]);
        const scale = 0.55 + 0.25 * Math.sin((frame / 20) + i);
        const y = ((r * size + frame * 3) % (height + size)) - size;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: c * size + size * 0.15,
              top: y,
              width: size * 0.7,
              height: size * 0.7,
              borderRadius: i % 3 === 0 ? "50%" : 28,
              background: p.shapes[i % p.shapes.length],
              opacity: 0.4,
              transform: `rotate(${rot}deg) scale(${scale})`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const Background: React.FC<{ background: BackgroundProps; totalFrames: number }> = ({ background, totalFrames }) => {
  const { fps } = useVideoConfig();
  if (background.kind === "procedural") return <Procedural preset={background.preset} />;

  const trimBefore = Math.floor(background.startAt * fps);
  const remaining = Math.floor(background.durationSec * fps) - trimBefore;
  const videoStyle: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

  if (remaining >= totalFrames) {
    return (
      <AbsoluteFill>
        <OffthreadVideo src={background.src} trimBefore={trimBefore} muted style={videoStyle} />
      </AbsoluteFill>
    );
  }
  // Clip shorter than the narration: loop the whole clip.
  return (
    <AbsoluteFill>
      <Loop durationInFrames={Math.max(1, Math.floor(background.durationSec * fps))}>
        <OffthreadVideo src={background.src} muted style={videoStyle} />
      </Loop>
    </AbsoluteFill>
  );
};
