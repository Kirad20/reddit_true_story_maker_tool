import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvePublication, publishNow, publishToTikTok } from "../src/automation";
import { DEFAULT_SETTINGS, publications, settings, type Publication } from "../src/domain";
import type { TikTokCreatorInfo } from "../src/publish/types";

const creator = vi.hoisted(() => ({ value: null as unknown as TikTokCreatorInfo }));
vi.mock("../src/zernio", async (original) => ({ ...(await original<typeof import("../src/zernio")>()), tiktokCreatorInfo: async () => creator.value }));

beforeEach(async () => {
  creator.value = {
    nickname: "Demo",
    username: null,
    avatarUrl: "https://a.test/x.png",
    privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"],
    commentDisabled: false,
    duetDisabled: true,
    stitchDisabled: false,
    maxVideoPostDurationSec: 600,
  };
  const s = structuredClone(DEFAULT_SETTINGS);
  s.publish.platforms.tiktok.reviewDemo = true;
  await settings.set(s);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
