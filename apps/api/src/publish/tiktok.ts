import { secret } from "../aiconfig";
import fs from "node:fs/promises";
import { accounts, saveAccount, type OAuthToken } from "./accounts";
import { PublishError, readJson, type PublishInput, type Publisher } from "./types";

// TikTok Content Posting API (Direct Post) with the user's own TikTok developer app.
const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.publish"];

const clientKey = () => secret("tiktok_client_key");
const clientSecret = () => secret("tiktok_client_secret");

export type TikTokSettings = {
  privacy: "SELF_ONLY" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "PUBLIC_TO_EVERYONE";
};

async function tokenRequest(params: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: clientKey(), client_secret: clientSecret(), ...params }),
  });
  const data = await readJson(res);
  if (!res.ok || data.error) throw new PublishError(`TikTok token error: ${data.error_description ?? data.error ?? res.status}`, false);
  return data;
}

async function accessToken(): Promise<string> {
  const token = accounts.get().tiktok;
  if (!token) throw new PublishError("TikTok is not connected", false);
  if (token.expiresAt && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken) throw new PublishError("TikTok session expired: reconnect the account", false);
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  const next: OAuthToken = {
    ...token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  await saveAccount("tiktok", next);
  return next.accessToken;
}

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
    const token = accounts.get().tiktok;
    return {
      platform: "tiktok",
      configured: Boolean(clientKey() && clientSecret()),
      connected: Boolean(token),
      accountName: token?.accountName ?? null,
      note: "Hasta que TikTok audite tu app, Direct Post solo permite publicaciones privadas (Solo yo).",
    };
  },

  authUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_key: clientKey(),
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  },

  async handleCallback(code, redirectUri) {
    const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const token: OAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + data.expires_in * 1000,
      accountName: null,
      accountId: data.open_id ?? null,
    };
    const res = await fetch(`${API}/user/info/?fields=display_name`, { headers: { Authorization: `Bearer ${token.accessToken}` } });
    token.accountName = (await readJson(res)).data?.user?.display_name ?? null;
    await saveAccount("tiktok", token);
  },

  async disconnect() {
    await saveAccount("tiktok", null);
  },

  async publish(input: PublishInput, raw) {
    const settings = raw as TikTokSettings;
    const token = await accessToken();

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
