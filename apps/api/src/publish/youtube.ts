import { secret } from "../aiconfig";
import fs from "node:fs/promises";
import { accounts, saveAccount } from "./accounts";
import { tokenSource } from "./tokens";
import { PublishError, readJson, type PublishInput, type Publisher } from "./types";

// YouTube Data API v3 with the user's own Google OAuth client.
// Connecting and token refresh go through Better Auth's "google" provider (see auth.ts).

const clientId = () => secret("youtube_client_id");
const clientSecret = () => secret("youtube_client_secret");

export type YouTubeSettings = { privacy: "private" | "unlisted" | "public" };

export const youtube: Publisher = {
  platform: "youtube",

  status() {
    const linked = accounts.get().youtube;
    return {
      platform: "youtube",
      configured: Boolean(clientId() && clientSecret()),
      connected: tokenSource.exists("youtube"),
      accountName: linked?.accountName ?? null,
      linkedBy: linked?.linkedBy ?? null,
      note: "Hasta que Google verifique tu app OAuth, los videos que suba quedan bloqueados como privados.",
    };
  },

  async onLinked(link) {
    await saveAccount("youtube", { ...link, accountName: null });
    const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${await tokenSource.accessToken("youtube")}` },
    });
    const channel = (await readJson(res)).items?.[0];
    if (!channel) throw new Error("This Google account has no YouTube channel");
    await saveAccount("youtube", { ...link, accountName: channel.snippet?.title ?? null });
  },

  async disconnect() {
    await tokenSource.disconnect("youtube");
  },

  async publish(input: PublishInput, raw) {
    const settings = raw as YouTubeSettings;
    const token = await tokenSource.accessToken("youtube");
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
