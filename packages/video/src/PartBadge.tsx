import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

/** "Parte 2/3" pill pinned to the top for the whole video. */
export const PartBadge: React.FC<{ label: string }> = ({ label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
      <div
        style={{
          transform: `translateY(${interpolate(enter, [0, 1], [-40, 0])}px)`,
          opacity: enter,
          background: "#ff4500",
          color: "white",
          fontFamily: "'Arial Black', 'Segoe UI Black', Impact, sans-serif",
          fontSize: 58,
          letterSpacing: 2,
          textTransform: "uppercase",
          padding: "14px 40px",
          borderRadius: 999,
          boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
