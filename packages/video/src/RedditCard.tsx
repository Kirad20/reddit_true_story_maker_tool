import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PostCard } from "./types";

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** Reddit-style post card shown while the title is narrated. */
export const RedditCard: React.FC<{ post: PostCard; durationInFrames: number }> = ({ post, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 140 } });
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = interpolate(enter, [0, 1], [0.6, 1]) * interpolate(exit, [0, 1], [0.85, 1]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 60 }}>
      <div
        style={{
          width: "100%",
          background: "#ffffff",
          borderRadius: 36,
          padding: "40px 44px",
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          transform: `scale(${scale})`,
          opacity: Math.min(enter, exit),
          fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
          color: "#1a1a1b",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 26 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "#ff4500",
              color: "white",
              fontSize: 44,
              fontWeight: 900,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            r/
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 38, fontWeight: 800 }}>r/{post.subreddit}</span>
            <span style={{ fontSize: 30, color: "#787c7e" }}>u/{post.author}</span>
          </div>
        </div>
        <div style={{ fontSize: 54, fontWeight: 800, lineHeight: 1.18 }}>{post.title}</div>
        {post.upvotes > 0 || post.comments > 0 ? (
          <div style={{ display: "flex", gap: 40, marginTop: 30, fontSize: 32, color: "#787c7e", fontWeight: 700 }}>
            <span>⬆ {compact(post.upvotes)}</span>
            <span>💬 {compact(post.comments)}</span>
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
