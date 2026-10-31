import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { activeChunk, activeWordIndex, chunkWords } from "./captionChunks";
import type { CaptionStyle, TimedWord } from "./types";

const FONT = "'Arial Black', 'Segoe UI Black', Impact, sans-serif";
const STROKE = "-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000, 0 8px 18px rgba(0,0,0,0.6)";

export const Captions: React.FC<{ words: TimedWord[]; style: CaptionStyle; hiddenUntil: number }> = ({
  words,
  style,
  hiddenUntil,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const chunks = useMemo(() => chunkWords(words, style === "karaoke" ? 4 : 3), [words, style]);
  if (t < hiddenUntil) return null;

  const chunk = activeChunk(chunks, t);
  if (!chunk) return null;
  const active = activeWordIndex(chunk, t);
  const pop = spring({ frame: frame - Math.round(chunk.start * fps), fps, config: { damping: 12, stiffness: 220 } });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 70px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.05em 0.38em",
          transform: style === "pop" ? `scale(${interpolate(pop, [0, 1], [0.7, 1])})` : undefined,
          fontFamily: FONT,
          fontSize: style === "karaoke" ? 84 : 104,
          lineHeight: 1.1,
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        {chunk.words.map((w, i) => {
          const isActive = i === active;
          if (style === "boxed") {
            return (
              <span
                key={i}
                style={{
                  color: isActive ? "#111" : "#fff",
                  background: isActive ? "#ffe234" : "transparent",
                  borderRadius: 18,
                  padding: "0 14px",
                  textShadow: isActive ? "none" : STROKE,
                }}
              >
                {w.text}
              </span>
            );
          }
          if (style === "karaoke") {
            const spoken = i <= active;
            return (
              <span key={i} style={{ color: spoken ? "#3cff9a" : "#ffffff", textShadow: STROKE }}>
                {w.text}
              </span>
            );
          }
          return (
            <span
              key={i}
              style={{
                color: isActive ? "#ffe234" : "#ffffff",
                textShadow: STROKE,
                transform: isActive ? "scale(1.08)" : undefined,
                display: "inline-block",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
