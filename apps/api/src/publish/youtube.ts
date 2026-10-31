import { secret } from "../aiconfig";
import fs from "node:fs/promises";
import { accounts, saveAccount, type OAuthToken } from "./accounts";
import { PublishError, readJson, type PublishInput, type Publisher } from "./types";

// YouTube Data API v3 with the user's own Google OAuth client.
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

const clientId = () => secret("youtube_client_id");
const clientSecret = () => secret("youtube_client_secret");

export type YouTubeSettings = { privacy: "private" | "unlisted" | "public" };

async function tokenRequest(params: Record<string, string>): Promise<Record<string, any>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
  });
  const data = await readJson(res);
  if (!res.ok) throw new PublishError(`Google token error: ${data.error_description ?? data.error ?? res.status}`, false);
  return data;
}

async function accessToken(): Promise<string> {
  const token = accounts.get().youtube;
  if (!token) throw new PublishError("YouTube is not connected", false);
  if (token.expiresAt && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  if (!token.refreshToken) throw new PublishError("YouTube session expired: reconnect the account", false);
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refreshToken });
  const next: OAuthToken = { ...token, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  await saveAccount("youtube", next);
  return next.accessToken;
}

export const youtube: Publisher = {
  platform: "youtube",

  status() {
    const token = accounts.get().youtube;
    return {
      platform: "youtube",
      configured: Boolean(clientId() && clientSecret()),
      connected: Boolean(token),
      accountName: token?.accountName ?? null,
      note: "Hasta que Google verifique tu app OAuth, los videos que suba quedan bloqueados como privados.",
    };
  },

  authUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH_URL}?${params}`;
  },

  async handleCallback(code, redirectUri) {
    const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    const token: OAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + data.expires_in * 1000,
      accountName: null,
      accountId: null,
    };
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    const channel = (await readJson(res)).items?.[0];
    token.accountName = channel?.snippet?.title ?? null;
    token.accountId = channel?.id ?? null;
    await saveAccount("youtube", token);
  },

  async disconnect() {
    await saveAccount("youtube", null);
  },

  async publish(input: PublishInput, raw) {
    const settings = raw as YouTubeSettings;
    const token = await accessToken();
    const file = await fs.readFile(input.filePath);

    // Resumable upload: create the session with metadata, then PUT the bytes.
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(file.byteLength),
      },
      body: JSON.stringify({
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: input.tags,
          categoryId: "24", // Entertainment
        },
        status: {
          privacyStatus: settings.privacy,
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: input.aiGenerated,
        },
      }),
    });
    if (!init.ok) {
      const data = await readJson(init);
      throw new PublishError(`YouTube rejected the upload: ${data.error?.message ?? init.status}`, init.status >= 500 || init.status === 429);
    }
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) throw new PublishError("YouTube did not return an upload URL");

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(file.byteLength) },
      body: file,
    });
    const data = await readJson(put);
    if (!put.ok || !data.id) throw new PublishError(`YouTube upload failed: ${data.error?.message ?? put.status}`, put.status >= 500);
    return { remoteId: data.id, url: `https://www.youtube.com/shorts/${data.id}` };
  },
};
