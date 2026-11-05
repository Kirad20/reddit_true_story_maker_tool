import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  accounts: [] as { _id: string; platform: string; displayName?: string }[],
  creator: {} as Record<string, unknown>,
  post: {} as Record<string, unknown>,
  created: [] as any[],
  connectQuery: null as any,
  deleted: [] as string[],
}));

vi.mock("@zernio/node", () => ({
  default: class {
    accounts = {
      listAccounts: async () => ({ data: { accounts: fake.accounts } }),
      deleteAccount: async ({ path }: any) => (fake.deleted.push(path.accountId), { data: { message: "ok" } }),
      getTikTokCreatorInfo: async () => ({ data: fake.creator }),
    };
    profiles = { listProfiles: async () => ({ data: { profiles: [{ _id: "prof1" }] } }) };
    connect = { getConnectUrl: async (opts: any) => ((fake.connectQuery = opts), { data: { authUrl: "https://zernio.test/auth" } }) };
    media = { getMediaPresignedUrl: async () => ({ data: { uploadUrl: "https://up.test/put", publicUrl: "https://cdn.test/v.mp4" } }) };
    posts = { createPost: async (opts: any) => (fake.created.push(opts.body), { data: fake.post }) };
  },
}));

import { publishers } from "../src/publish";
import { PublishError } from "../src/publish/types";
import { connectUrl, disconnectAccount, refreshAccounts, tiktokCreatorInfo } from "../src/zernio";

let video = "";
beforeAll(() => {
  video = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tsm-zn-")), "final.mp4");
  fs.writeFileSync(video, Buffer.alloc(64));
});

beforeEach(async () => {
  vi.stubEnv("ZERNIO_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  fake.created = [];
  fake.deleted = [];
  fake.accounts = [
    { _id: "a-yt", platform: "youtube", displayName: "Mi canal" },
    { _id: "a-tt", platform: "tiktok", displayName: "Demo" },
    { _id: "a-ig", platform: "instagram" },
  ];
  fake.creator = {
    creator: { nickname: "Demo", avatarUrl: "https://a.test/x.png" },
    privacyLevels: [{ value: "SELF_ONLY" }, { value: "PUBLIC_TO_EVERYONE" }],
    postingLimits: { maxVideoDurationSec: 600, interactionSettings: { allow_comment: { enabled: true }, allow_duet: { enabled: false }, allow_stitch: { enabled: true } } },
  };
  fake.post = { post: { _id: "p1", platforms: [{ platform: "youtube", status: "published", platformPostId: "abc", platformPostUrl: "https://youtu.be/abc" }] } };
  await refreshAccounts(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const input = { filePath: "", title: "My title", description: "Desc", tags: ["storytime"], aiGenerated: true };

describe("Zernio accounts", () => {
  it("reports which platforms are connected", () => {
    expect(publishers.youtube.status()).toMatchObject({ configured: true, connected: true, accountName: "Mi canal" });
    expect(publishers.facebook.status().connected).toBe(false);
  });

  it("builds the connect URL for the profile and disconnects by account id", async () => {
    expect(await connectUrl("instagram")).toBe("https://zernio.test/auth");
    expect(fake.connectQuery).toMatchObject({ path: { platform: "instagram" }, query: { profileId: "prof1" } });
    await disconnectAccount("tiktok");
    expect(fake.deleted).toEqual(["a-tt"]);
  });
});

describe("Zernio publishing", () => {
  it("uploads the video and posts with the YouTube disclosure", async () => {
    const result = await publishers.youtube.publish({ ...input, filePath: video }, { privacy: "private" });
    expect(result).toEqual({ remoteId: "abc", url: "https://youtu.be/abc" });
    expect(fake.created[0]).toMatchObject({
      publishNow: true,
      mediaItems: [{ type: "video", url: "https://cdn.test/v.mp4" }],
      platforms: [{ platform: "youtube", accountId: "a-yt", platformSpecificData: { visibility: "private", containsSyntheticMedia: true, madeForKids: false } }],
    });
  });

  it("applies the creator's TikTok limits to the Direct Post choices", async () => {
    const post = { privacy: "PUBLIC_TO_EVERYONE" as const, allowComment: true, allowDuet: true, allowStitch: false, brandOrganic: false, brandedContent: true };
    fake.post = { post: { platforms: [{ platform: "tiktok", status: "published", platformPostId: "9" }] } };
    await publishers.tiktok.publish({ ...input, filePath: video }, { privacy: "SELF_ONLY", post });
    expect(fake.created[0].platforms[0].platformSpecificData).toMatchObject({
      privacyLevel: "PUBLIC_TO_EVERYONE",
      allowDuet: false, // disabled in the creator's TikTok settings
      allowStitch: false,
      commercialContentType: "brand_content",
    });
    await expect(publishers.tiktok.publish({ ...input, filePath: video }, { privacy: "SELF_ONLY", post: { ...post, privacy: "FOLLOWER_OF_CREATOR" } })).rejects.toThrow(/no longer allows/);
  });

  it("maps the TikTok creator info", async () => {
    expect(await tiktokCreatorInfo()).toMatchObject({ nickname: "Demo", privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], duetDisabled: true, commentDisabled: false, maxVideoPostDurationSec: 600 });
  });

  it("surfaces a platform failure, retrying only transient ones", async () => {
    fake.post = { post: { platforms: [{ platform: "youtube", status: "failed", errorMessage: "Policy violation", errorCategory: "platform_rejected" }] } };
    await expect(publishers.youtube.publish({ ...input, filePath: video }, { privacy: "private" })).rejects.toMatchObject({ retryable: false });
    fake.post = { post: { platforms: [{ platform: "youtube", status: "failed", errorMessage: "Maintenance", errorCategory: "platform_error" }] } };
    await expect(publishers.youtube.publish({ ...input, filePath: video }, { privacy: "private" })).rejects.toMatchObject({ retryable: true });
  });

  it("fails without retry when the platform is not connected", async () => {
    await expect(publishers.facebook.publish({ ...input, filePath: video }, {})).rejects.toBeInstanceOf(PublishError);
  });
});
