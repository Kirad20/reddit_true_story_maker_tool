import fs from "node:fs/promises";
import Zernio from "@zernio/node";
import { secret } from "./aiconfig";
import { WEB_ORIGIN } from "./config";
import type { Platform, TikTokPrivacy } from "./domain";
import { PublishError, type PublishInput, type PublishResult, type TikTokCreatorInfo } from "./publish/types";

// Zernio (https://zernio.com) handles the OAuth login and the publishing for every social platform.

export type ZernioAccount = {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
};

let client: Zernio | null = null;
let clientKey = "";

const apiKey = () => secret("zernio_api_key") || process.env.ZERNIO_API_KEY || "";

export const zernioConfigured = () => Boolean(apiKey());

/** Zernio client, rebuilt when the API key changes in Settings. */
export function zernio(): Zernio {
  const key = apiKey();
  if (!key) throw new PublishError("Zernio API key is not set (Ajustes → Credenciales)", false);
  if (!client || key !== clientKey) {
    client = new Zernio({ apiKey: key });
    clientKey = key;
  }
  return client;
}

/** Unwraps the SDK's { data, error } result. */
function unwrap<T>(result: { data?: T; error?: unknown; response?: Response }, what: string, retryable = true): T {
  if (result.error || result.data === undefined) {
    const err = result.error as { error?: string; message?: string } | string | undefined;
    const message = typeof err === "string" ? err : (err?.error ?? err?.message ?? (result.response ? `HTTP ${result.response.status}` : "no response"));
    const status = result.response?.status ?? 0;
    throw new PublishError(`Zernio ${what}: ${message}`, retryable && (status === 0 || status >= 500 || status === 429));
  }
  return result.data;
}

// ---------------------------------------------------------------- accounts

const TTL_MS = 60_000;
let cache: ZernioAccount[] = [];
let refreshedAt = 0;
let inflight: Promise<void> | null = null;

/** Reloads the connected accounts from Zernio (deduplicated). */
export function refreshAccounts(force = false): Promise<void> {
  if (!zernioConfigured()) {
    cache = [];
    return Promise.resolve();
  }
  if (!force && Date.now() - refreshedAt < TTL_MS) return Promise.resolve();
  inflight ??= (async () => {
    try {
      const data = unwrap<{ accounts?: ZernioAccount[] }>(await zernio().accounts.listAccounts(), "listAccounts");
      cache = data.accounts ?? [];
      refreshedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The connected account of a platform from the cache; kicks off a background refresh when stale. */
export function accountFor(platform: Platform): ZernioAccount | null {
  if (Date.now() - refreshedAt >= TTL_MS) void refreshAccounts().catch(() => undefined);
  return cache.find((a) => a.platform === platform) ?? null;
}

async function requireAccount(platform: Platform): Promise<ZernioAccount> {
  await refreshAccounts();
  const account = accountFor(platform);
  if (!account) throw new PublishError(`${platform} is not connected in Zernio`, false);
  return account;
}

async function profileId(): Promise<string> {
  const api = zernio();
  const list = unwrap<{ profiles?: { _id?: string }[] }>(await api.profiles.listProfiles(), "listProfiles");
  const existing = list.profiles?.find((p) => p._id)?._id;
  if (existing) return existing;
  const created = unwrap<{ profile?: { _id?: string } }>(await api.profiles.createProfile({ body: { name: "TrueStoryMaker" } }), "createProfile");
  if (!created.profile?._id) throw new PublishError("Zernio did not return the new profile", false);
  return created.profile._id;
}

/** URL where the user logs in to the platform through Zernio; it returns to the app's Settings afterwards. */
export async function connectUrl(platform: Platform): Promise<string> {
  const redirect_url = `${WEB_ORIGIN}/?tab=settings&connected=${platform}`;
  const data = unwrap<{ authUrl?: string }>(
    await zernio().connect.getConnectUrl({ path: { platform }, query: { profileId: await profileId(), redirect_url } } as never),
    "getConnectUrl",
    false,
  );
  if (!data.authUrl) throw new PublishError("Zernio did not return a connect URL", false);
  return data.authUrl;
}

export async function disconnectAccount(platform: Platform): Promise<void> {
  const account = await requireAccount(platform);
  unwrap(await zernio().accounts.deleteAccount({ path: { accountId: account._id } }), "deleteAccount");
  await refreshAccounts(true);
}

export const connectedAccounts = () => cache;

// ---------------------------------------------------------------- TikTok

export async function tiktokCreatorInfo(): Promise<TikTokCreatorInfo> {
  const account = await requireAccount("tiktok");
  const data = unwrap<any>(
    await zernio().accounts.getTikTokCreatorInfo({ path: { accountId: account._id }, query: { mediaType: "video" } } as never),
    "getTikTokCreatorInfo",
  );
  const settings = data.postingLimits?.interactionSettings ?? {};
  return {
    nickname: data.creator?.nickname ?? account.displayName ?? "",
    username: account.username ?? null,
    avatarUrl: data.creator?.avatarUrl ?? null,
    privacyOptions: (data.privacyLevels ?? []).map((l: { value: string }) => l.value) as TikTokPrivacy[],
    commentDisabled: settings.allow_comment ? settings.allow_comment.enabled === false : false,
    duetDisabled: settings.allow_duet ? settings.allow_duet.enabled === false : false,
    stitchDisabled: settings.allow_stitch ? settings.allow_stitch.enabled === false : false,
    maxVideoPostDurationSec: typeof data.postingLimits?.maxVideoDurationSec === "number" ? data.postingLimits.maxVideoDurationSec : null,
  };
}

// ---------------------------------------------------------------- publishing

/** Uploads the video to Zernio's storage and returns the public URL the platforms fetch it from. */
async function uploadVideo(filePath: string): Promise<string> {
  const file = await fs.readFile(filePath);
  const presigned = unwrap<{ uploadUrl: string; publicUrl: string }>(
    await zernio().media.getMediaPresignedUrl({ body: { filename: filePath.split(/[\\/]/).pop() || "video.mp4", contentType: "video/mp4", size: file.byteLength } } as never),
    "getMediaPresignedUrl",
  );
  const put = await fetch(presigned.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: file });
  if (!put.ok) throw new PublishError(`Zernio media upload failed: ${put.status}`, put.status >= 500);
  return presigned.publicUrl;
}

/** Posts the video right away on one platform through Zernio. */
export async function publishVideo(
  platform: Platform,
  input: PublishInput,
  platformSpecificData: Record<string, unknown>,
): Promise<PublishResult> {
  const account = await requireAccount(platform);
  const url = await uploadVideo(input.filePath);
  const content = [input.title, input.description].filter(Boolean).join("\n\n");
  const result = await zernio().posts.createPost({
    body: {
      content: platform === "tiktok" ? [input.title, input.description].filter(Boolean).join("\n").slice(0, 2200) : content,
      title: input.title,
      tags: input.tags,
      mediaItems: [{ type: "video", url }],
      platforms: [{ platform, accountId: account._id, platformSpecificData }],
      publishNow: true,
    },
  } as never);

  // A 207 answers with the post too: look at the per-platform outcome rather than the HTTP status.
  const body = (result.data ?? result.error) as { post?: any; message?: string; error?: string } | undefined;
  const target = body?.post?.platforms?.find((p: { platform: string }) => p.platform === platform);
  if (!target) unwrap(result as never, "createPost");
  if (target?.status === "failed" || target?.error) {
    const category = target.errorCategory as string | undefined;
    const retryable = category === "platform_error" || category === "platform_rate_limit" || category === "quota_exhausted" || category === "system_error";
    throw new PublishError(`Zernio ${platform}: ${target.errorMessage ?? target.error ?? "publish failed"}`, retryable);
  }
  return { remoteId: String(target?.platformPostId ?? body?.post?._id ?? ""), url: target?.platformPostUrl ?? null };
}

async function uploadImage(filePath: string): Promise<string> {
  const file = await fs.readFile(filePath);
  const presigned = unwrap<{ uploadUrl: string; publicUrl: string }>(
    await zernio().media.getMediaPresignedUrl({ body: { filename: filePath.split(/[\\/]/).pop() || "image.png", contentType: "image/png", size: file.byteLength } } as never),
    "getMediaPresignedUrl",
  );
  const put = await fetch(presigned.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: file });
  if (!put.ok) throw new PublishError(`Zernio media upload failed: ${put.status}`, put.status >= 500);
  return presigned.publicUrl;
}

/** Posts right away: text-only (e.g. Facebook) or with an image given by its local file path. */
export async function publishPost(platform: Platform, content: string, imagePath: string | null): Promise<{ url: string | null }> {
  const account = await requireAccount(platform);
  const mediaItems = imagePath ? [{ type: "image", url: await uploadImage(imagePath) }] : undefined;
  const result = await zernio().posts.createPost({
    body: { content, mediaItems, platforms: [{ platform, accountId: account._id }], publishNow: true },
  } as never);
  const body = (result.data ?? result.error) as { post?: any } | undefined;
  const target = body?.post?.platforms?.find((p: { platform: string }) => p.platform === platform);
  if (!target) unwrap(result as never, "createPost");
  if (target?.status === "failed" || target?.error) {
    throw new PublishError(`Zernio ${platform}: ${target.errorMessage ?? target.error ?? "publish failed"}`, false);
  }
  return { url: target?.platformPostUrl ?? null };
}
