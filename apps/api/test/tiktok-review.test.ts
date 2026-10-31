import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approvePublication, publishNow, publishToTikTok } from "../src/automation";
import { DEFAULT_SETTINGS, publications, settings, type Publication } from "../src/domain";
import { tiktok } from "../src/publish/tiktok";
import { tokenSource } from "../src/publish/tokens";

process.env.TIKTOK_POLL_MS = "1";

type Call = { url: string; body: any };
let calls: Call[] = [];
let creator: Record<string, unknown>;

function fakeTikTok(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ url, body });
  const json = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data, error: { code: "ok" } }), { headers: { "Content-Type": "application/json" } }));
  if (url.endsWith("/post/publish/creator_info/query/")) return json(creator);
  if (url.endsWith("/post/publish/video/init/")) return json({ publish_id: "p-1", upload_url: "https://upload.tiktok.test/1" });
  if (url.startsWith("https://upload.tiktok.test/")) return Promise.resolve(new Response(null, { status: 201 }));
  if (url.endsWith("/post/publish/status/fetch/")) return json({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["123"] });
  throw new Error(`unexpected fetch ${url}`);
}

let video = "";
beforeAll(() => {
  video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsm-tt-")), "final.mp4");
  fs.writeFileSync(video, Buffer.alloc(1024));
});

beforeEach(async () => {
  calls = [];
  creator = {
    creator_nickname: "Demo",
    creator_avatar_url: "https://a.test/x.png",
    privacy_level_options: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 600,
  };
  vi.stubGlobal("fetch", fakeTikTok);
  vi.spyOn(tokenSource, "accessToken").mockResolvedValue("TT");
  const s = structuredClone(DEFAULT_SETTINGS);
  s.publish.platforms.tiktok.reviewDemo = true;
  await settings.set(s);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const input = { filePath: "", title: "Title", description: "", tags: [], aiGenerated: true };
const choices = { privacy: "PUBLIC_TO_EVERYONE" as const, allowComment: true, allowDuet: true, allowStitch: false, brandOrganic: false, brandedContent: true };

async function newPub(): Promise<Publication> {
  return publications.put({
    id: `pub-${Math.random().toString(36).slice(2)}`,
    storyId: null,
    jobId: "missing-job",
    platform: "tiktok",
    status: "needs_review",
    createdAt: new Date().toISOString(),
    scheduledAt: null,
    publishedAt: null,
    title: "Title",
    description: "Body",
    tags: [],
    remoteId: null,
    url: null,
    error: null,
    attempts: 0,
  });
}

describe("TikTok publisher with Direct Post choices", () => {
  it("sends the creator's privacy, interactions (respecting creator_info) and disclosure", async () => {
    const result = await tiktok.publish({ ...input, filePath: video }, { privacy: "SELF_ONLY", post: choices });
    expect(result.url).toBe("https://www.tiktok.com/video/123");
    const init = calls.find((c) => c.url.endsWith("/video/init/"))!.body.post_info;
    expect(init).toMatchObject({
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_comment: false,
      disable_duet: true, // disabled in the creator's TikTok settings
      disable_stitch: true,
      brand_organic_toggle: false,
      brand_content_toggle: true,
      is_aigc: true,
    });
  });

  it("never swaps a privacy level the creator picked", async () => {
    creator.privacy_level_options = ["SELF_ONLY"];
    await expect(tiktok.publish({ ...input, filePath: video }, { privacy: "SELF_ONLY", post: choices })).rejects.toThrow(/no longer allows/);
  });
});

describe("TikTok review flag", () => {
  it("blocks approving or posting TikTok without the Direct Post screen", async () => {
    const pub = await newPub();
    await expect(approvePublication(pub.id)).rejects.toThrow(/Post to TikTok/);
    await expect(publishNow(pub.id)).rejects.toThrow(/Post to TikTok/);
  });

  it("validates the choices against creator_info and stores them", async () => {
    const pub = await newPub();
    await expect(publishToTikTok(pub.id, { ...choices, privacy: "FOLLOWER_OF_CREATOR", title: "T" })).rejects.toThrow(/not available/);
    await expect(publishToTikTok(pub.id, { ...choices, privacy: "SELF_ONLY", title: "T" })).rejects.toThrow(/cannot be set to private/);
    const done = await publishToTikTok(pub.id, { ...choices, title: "Edited caption" });
    expect(done).toMatchObject({ status: "scheduled", title: "Edited caption", description: "" });
    expect(done.tiktok).toMatchObject({ privacy: "PUBLIC_TO_EVERYONE", allowDuet: false, brandedContent: true });
  });

  it("leaves the normal flow alone when the flag is off", async () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    await settings.set(s);
    const pub = await newPub();
    await expect(approvePublication(pub.id)).resolves.toMatchObject({ status: "scheduled" });
  });
});
