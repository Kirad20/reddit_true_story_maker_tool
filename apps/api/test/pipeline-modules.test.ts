import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackMetadata } from "../src/agents";
import type { Story } from "../src/domain";
import { accounts } from "../src/publish/accounts";
import { facebook } from "../src/publish/facebook";
import { tiktok } from "../src/publish/tiktok";
import { PublishError } from "../src/publish/types";
import { youtube } from "../src/publish/youtube";
import { nextSlot, parseSlots } from "../src/schedule";

describe("nextSlot", () => {
  const base = { platform: "youtube" as const, slots: ["18:00", "12:00", "bad", "21:00"], dailyLimit: 2 };

  it("parses and sorts valid HH:MM slots", () => {
    expect(parseSlots(["18:00", "9:30", "25:00", "x"])).toEqual([570, 1080]);
  });

  it("returns the next slot later today", () => {
    const now = new Date(2026, 9, 31, 13, 0);
    const slot = nextSlot({ ...base, now, existing: [] });
    expect([slot.getDate(), slot.getHours(), slot.getMinutes()]).toEqual([31, 18, 0]);
  });

  it("skips taken slots and full days", () => {
    const now = new Date(2026, 9, 31, 8, 0);
    const at = (h: number, d = 31) => new Date(2026, 9, d, h, 0).toISOString();
    const existing = [
      { platform: "youtube" as const, status: "scheduled" as const, scheduledAt: at(12), publishedAt: null },
      { platform: "youtube" as const, status: "published" as const, scheduledAt: at(18), publishedAt: at(18) },
      { platform: "tiktok" as const, status: "scheduled" as const, scheduledAt: at(12, 1), publishedAt: null },
    ];
    const slot = nextSlot({ ...base, now, existing });
    // Today already has 2 (the limit) → first slot tomorrow.
    expect([slot.getMonth(), slot.getDate(), slot.getHours()]).toEqual([10, 1, 12]);
  });

  it("ignores other platforms and canceled publications", () => {
    const now = new Date(2026, 9, 31, 8, 0);
    const slot = nextSlot({
      ...base,
      now,
      existing: [
        { platform: "tiktok", status: "scheduled", scheduledAt: new Date(2026, 9, 31, 12).toISOString(), publishedAt: null },
        { platform: "youtube", status: "canceled", scheduledAt: new Date(2026, 9, 31, 12).toISOString(), publishedAt: null },
      ],
    });
    expect(slot.getHours()).toBe(12);
  });
});

const story: Story = {
  id: "st_1",
  source: "original",
  status: "produced",
  createdAt: "",
  title: "I refused to switch seats on a plane and now my family is mad",
  body: "…",
  comments: [],
  subreddit: "AmItheAsshole",
  author: "storyteller",
  url: null,
  score: 0,
  curation: null,
  fictional: true,
  jobId: "job",
  error: null,
};

describe("fallbackMetadata", () => {
  it("discloses fiction and adds #shorts on YouTube", () => {
    const meta = fallbackMetadata(story, "youtube");
    expect(meta.description).toContain("Fictional story.");
    expect(meta.description).toContain("#shorts");
  });

  it("credits the subreddit for Reddit posts and keeps TikTok captions short", () => {
    const meta = fallbackMetadata({ ...story, source: "reddit", fictional: false, title: "x".repeat(200) }, "tiktok");
    expect(meta.description).toContain("Story from r/AmItheAsshole.");
    expect(meta.title.length).toBeLessThanOrEqual(150);
  });

  it("adds no source credit to the user's own stories", () => {
    const meta = fallbackMetadata({ ...story, source: "manual", fictional: false }, "facebook");
    expect(meta.description).not.toMatch(/Story from|Fictional/);
  });
});

// ---------------------------------------------------------------- publishers (fetch mocked)

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let tmp: string;
let video: string;

function respond(responses: ((call: Call) => Response | undefined)[]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      for (const r of responses) {
        const res = r(call);
        if (res) return res;
      }
      throw new Error(`Unexpected fetch ${url}`);
    }),
  );
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tsm-"));
  video = path.join(tmp, "final.mp4");
  await fs.writeFile(video, Buffer.alloc(1024, 1));
  // Avoid touching data/accounts.json: keep tokens in memory only.
  vi.spyOn(accounts, "set").mockImplementation(async (value) => {
    (accounts as unknown as { value: unknown }).value = value;
    return value;
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const input = { title: "My title", description: "Desc #storytime", tags: ["storytime"], aiGenerated: true };
const future = Date.now() + 3600_000;

describe("youtube publisher", () => {
  it("creates a resumable session with AI disclosure, then uploads the bytes", async () => {
    await accounts.set({ youtube: { accessToken: "AT", refreshToken: "RT", expiresAt: future, accountName: "Ch", accountId: "1" }, tiktok: null, facebook: null });
    respond([
      (c) => (c.url.includes("uploadType=resumable") ? new Response(null, { status: 200, headers: { location: "https://upload.example/session" } }) : undefined),
      (c) => (c.url === "https://upload.example/session" ? json({ id: "abc123" }) : undefined),
    ]);
    const result = await youtube.publish({ ...input, filePath: video }, { privacy: "private" });
    expect(result).toEqual({ remoteId: "abc123", url: "https://www.youtube.com/shorts/abc123" });
    const meta = JSON.parse(String(calls[0].init?.body));
    expect(meta.status).toMatchObject({ privacyStatus: "private", containsSyntheticMedia: true, selfDeclaredMadeForKids: false });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer AT");
    expect(calls[1].init?.method).toBe("PUT");
  });

  it("refreshes an expired token first", async () => {
    await accounts.set({ youtube: { accessToken: "OLD", refreshToken: "RT", expiresAt: 0, accountName: null, accountId: null }, tiktok: null, facebook: null });
    respond([
      (c) => (c.url.includes("oauth2.googleapis.com/token") ? json({ access_token: "NEW", expires_in: 3600 }) : undefined),
      (c) => (c.url.includes("uploadType=resumable") ? new Response(null, { headers: { location: "https://upload.example/s" } }) : undefined),
      (c) => (c.url === "https://upload.example/s" ? json({ id: "x" }) : undefined),
    ]);
    await youtube.publish({ ...input, filePath: video }, { privacy: "public" });
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer NEW");
    expect(accounts.get().youtube?.accessToken).toBe("NEW");
  });

  it("fails without retry when not connected", async () => {
    await accounts.set({ youtube: null, tiktok: null, facebook: null });
    await expect(youtube.publish({ ...input, filePath: video }, { privacy: "private" })).rejects.toMatchObject({ retryable: false });
  });
});

describe("tiktok publisher", () => {
  it("queries creator info, falls back to an allowed privacy, uploads and polls", async () => {
    vi.stubEnv("TIKTOK_POLL_MS", "1");
    await accounts.set({ youtube: null, tiktok: { accessToken: "TT", refreshToken: "R", expiresAt: future, accountName: null, accountId: null }, facebook: null });
    respond([
      (c) => (c.url.endsWith("/creator_info/query/") ? json({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }) : undefined),
      (c) => (c.url.endsWith("/video/init/") ? json({ data: { publish_id: "p1", upload_url: "https://up.tiktok/x" }, error: { code: "ok" } }) : undefined),
      (c) => (c.url === "https://up.tiktok/x" ? new Response(null, { status: 201 }) : undefined),
      (c) =>
        c.url.endsWith("/status/fetch/")
          ? json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [777] }, error: { code: "ok" } })
          : undefined,
    ]);
    const result = await tiktok.publish({ ...input, filePath: video }, { privacy: "PUBLIC_TO_EVERYONE" });
    vi.unstubAllEnvs();
    expect(result.remoteId).toBe("777");
    const init = JSON.parse(String(calls[1].init?.body));
    expect(init.post_info).toMatchObject({ privacy_level: "SELF_ONLY", is_aigc: true });
    expect(init.source_info).toMatchObject({ source: "FILE_UPLOAD", video_size: 1024, total_chunk_count: 1 });
    expect((calls[2].init?.headers as Record<string, string>)["Content-Range"]).toBe("bytes 0-1023/1024");
  });

  it("reports API errors", async () => {
    await accounts.set({ youtube: null, tiktok: { accessToken: "TT", refreshToken: null, expiresAt: future, accountName: null, accountId: null }, facebook: null });
    respond([(c) => (c.url.endsWith("/creator_info/query/") ? json({ error: { code: "spam_risk_too_many_posts", message: "Too many posts" } }) : undefined)]);
    await expect(tiktok.publish({ ...input, filePath: video }, { privacy: "SELF_ONLY" })).rejects.toBeInstanceOf(PublishError);
  });
});

describe("facebook publisher", () => {
  it("runs the start → upload → finish Reels flow with the page token", async () => {
    await accounts.set({ youtube: null, tiktok: null, facebook: { userToken: "U", pages: [{ id: "PG", name: "Page", token: "PT" }], pageId: "PG" } });
    respond([
      (c) => (c.url.includes("upload_phase=start") ? json({ video_id: "V1", upload_url: "https://rupload.example/V1" }) : undefined),
      (c) => (c.url === "https://rupload.example/V1" ? json({ success: true }) : undefined),
      (c) => (c.url.includes("upload_phase=finish") ? json({ success: true }) : undefined),
    ]);
    const result = await facebook.publish({ ...input, filePath: video }, {});
    expect(result).toEqual({ remoteId: "V1", url: "https://www.facebook.com/reel/V1" });
    expect(calls[0].url).toContain("/PG/video_reels");
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("OAuth PT");
    expect(calls[2].url).toContain("video_state=PUBLISHED");
  });
});
