import { secret } from "../aiconfig";
import fs from "node:fs/promises";
import { accounts, saveAccount } from "./accounts";
import { TIKTOK_API } from "./scopes";
import { tokenSource } from "./tokens";
import { PublishError, readJson, type PublishInput, type Publisher } from "./types";

// TikTok Content Posting API (Direct Post) with the user's own TikTok developer app.
// Connecting and token refresh go through Better Auth's "tiktok" provider (see auth.ts).
const API = TIKTOK_API;

const clientKey = () => secret("tiktok_client_key");
const clientSecret = () => secret("tiktok_client_secret");

export type TikTokSettings = {
  privacy: "SELF_ONLY" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "PUBLIC_TO_EVERYONE";
};

async function api(path: string, token: string, body: unknown): Promise<Record<string, any>> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await readJson(res);
  const code = data.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    throw new PublishError(`TikTok ${path}: ${data.error?.message || code || res.status}`, res.status >= 500 || res.status === 429);
  }
  return data.data ?? {};
}

export const tiktok: Publisher = {
  platform: "tiktok",

  status() {
    const linked = accounts.get().tiktok;
    return {
      platform: "tiktok",
      configured: Boolean(clientKey() && clientSecret()),
      connected: tokenSource.exists("tiktok"),
      accountName: linked?.accountName ?? null,
      linkedBy: linked?.linkedBy ?? null,
      note: "Hasta que TikTok audite tu app, Direct Post solo permite publicaciones privadas (Solo yo).",
    };
  },

  async onLinked(link) {
    await saveAccount("tiktok", { ...link, accountName: null });
    const res = await fetch(`${API}/user/info/?fields=display_name`, { headers: { Authorization: `Bearer ${await tokenSource.accessToken("tiktok")}` } });
    await saveAccount("tiktok", { ...link, accountName: (await readJson(res)).data?.user?.display_name ?? null });
  },

  async disconnect() {
    await tokenSource.disconnect("tiktok");
  },

  async publish(input: PublishInput, raw) {
    const settings = raw as TikTokSettings;
    const token = await tokenSource.accessToken("tiktok");

    // TikTok requires querying the creator's allowed privacy levels before each post.
    const creator = await api("/post/publish/creator_info/query/", token, {});
    const allowed: string[] = creator.privacy_level_options ?? [];
    const privacy = allowed.includes(settings.privacy) ? settings.privacy : allowed.includes("SELF_ONLY") ? "SELF_ONLY" : allowed[0];
    if (!privacy) throw new PublishError("TikTok returned no allowed privacy level for this account", false);

    const file = await fs.readFile(input.filePath);
    const size = file.byteLength;
    if (size > 64 * 1024 * 1024) throw new PublishError("Video larger than 64 MB: chunked TikTok upload not implemented", false);

    const caption = [input.title, input.description].filter(Boolean).join("\n").slice(0, 2200);
    const init = await api("/post/publish/video/init/", token, {
      post_info: {
        title: caption,
        privacy_level: privacy,
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
        is_aigc: input.aiGenerated,
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
    });

    const put = await fetch(init.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
      body: file,
    });
    if (!put.ok) throw new PublishError(`TikTok upload failed: ${put.status}`, put.status >= 500);

    // Publishing is asynchronous; poll briefly so failures surface here.
    const pollMs = Number(process.env.TIKTOK_POLL_MS ?? 3000);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      const status = await api("/post/publish/status/fetch/", token, { publish_id: init.publish_id });
      if (status.status === "PUBLISH_COMPLETE") {
        const postId = status.publicaly_available_post_id?.[0] ?? status.publicly_available_post_id?.[0];
        return { remoteId: String(postId ?? init.publish_id), url: postId ? `https://www.tiktok.com/video/${postId}` : null };
      }
      if (status.status === "FAILED") throw new PublishError(`TikTok publish failed: ${status.fail_reason ?? "unknown"}`, false);
    }
    // Still processing: TikTok will finish on its side.
    return { remoteId: String(init.publish_id), url: null };
  },
};
