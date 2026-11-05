import type { Platform, Settings } from "../domain";
import { PLATFORMS } from "../domain";
import { accountFor, disconnectAccount, publishVideo, tiktokCreatorInfo, zernioConfigured } from "../zernio";
import { PublishError, type Publisher, type PublishInput, type TikTokSettings } from "./types";

// Every platform logs in and publishes through Zernio (see ../zernio.ts).

type PlatformSettings = Settings["publish"]["platforms"];

async function tiktokData(input: PublishInput, raw: unknown) {
  const settings = raw as TikTokSettings;
  // TikTok requires the creator's allowed privacy levels before each post.
  const creator = await tiktokCreatorInfo();
  const allowed: string[] = creator.privacyOptions;
  const post = settings.post ?? null;
  let privacy: string | undefined;
  if (post) {
    // The creator picked it in the Direct Post screen: never silently change it.
    if (!allowed.includes(post.privacy)) throw new PublishError(`TikTok no longer allows privacy "${post.privacy}" for this account`, false);
    privacy = post.privacy;
  } else {
    privacy = allowed.includes(settings.privacy) ? settings.privacy : allowed.includes("SELF_ONLY") ? "SELF_ONLY" : allowed[0];
  }
  if (!privacy) throw new PublishError("TikTok returned no allowed privacy level for this account", false);
  return {
    privacyLevel: privacy,
    allowComment: post ? post.allowComment && !creator.commentDisabled : !creator.commentDisabled,
    allowDuet: post ? post.allowDuet && !creator.duetDisabled : !creator.duetDisabled,
    allowStitch: post ? post.allowStitch && !creator.stitchDisabled : !creator.stitchDisabled,
    commercialContentType: post?.brandedContent ? "brand_content" : post?.brandOrganic ? "brand_organic" : "none",
    contentPreviewConfirmed: true,
    expressConsentGiven: true,
    mediaType: "video",
  };
}

const platformData: Record<Platform, (input: PublishInput, settings: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>> = {
  youtube: (input, s) => ({
    title: input.title,
    visibility: (s as PlatformSettings["youtube"]).privacy ?? "private",
    madeForKids: false,
    containsSyntheticMedia: input.aiGenerated,
  }),
  tiktok: tiktokData,
  facebook: (input) => ({ contentType: "reel", title: input.title, isAiGenerated: input.aiGenerated }),
  instagram: (input) => ({ isAiGenerated: input.aiGenerated }),
};

const NOTES: Partial<Record<Platform, string>> = {
  tiktok: "Hasta que TikTok audite la app de Zernio, Direct Post puede limitarse a publicaciones privadas.",
};

function zernioPublisher(platform: Platform): Publisher {
  return {
    platform,
    status() {
      const account = zernioConfigured() ? accountFor(platform) : null;
      return {
        platform,
        configured: zernioConfigured(),
        connected: Boolean(account),
        accountName: account ? (account.displayName ?? account.username ?? null) : null,
        note: NOTES[platform] ?? null,
      };
    },
    disconnect: () => disconnectAccount(platform),
    async publish(input, settings) {
      return publishVideo(platform, input, await platformData[platform](input, settings));
    },
  };
}

export const publishers = Object.fromEntries(PLATFORMS.map((p) => [p, zernioPublisher(p)])) as Record<Platform, Publisher>;

export function accountStatuses() {
  return PLATFORMS.map((p) => publishers[p].status());
}
