import { secret } from "../aiconfig";
import fs from "node:fs/promises";
import { accounts, saveAccount, type FacebookAccount } from "./accounts";
import { PublishError, readJson, type PublishInput, type Publisher } from "./types";

// Facebook Page Reels through the Graph API, with the user's own Meta app.
const VERSION = "v23.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "publish_video"];

const appId = () => secret("facebook_app_id");
const appSecret = () => secret("facebook_app_secret");

async function graph(path: string, params: Record<string, string>, method: "GET" | "POST" = "GET"): Promise<Record<string, any>> {
  const query = new URLSearchParams(params);
  const res = await fetch(`${GRAPH}${path}?${query}`, { method });
  const data = await readJson(res);
  if (!res.ok || data.error) {
    throw new PublishError(`Facebook ${path}: ${data.error?.message ?? res.status}`, res.status >= 500 || data.error?.is_transient === true);
  }
  return data;
}

function currentPage(account: FacebookAccount | null) {
  if (!account) throw new PublishError("Facebook is not connected", false);
  const page = account.pages.find((p) => p.id === account.pageId) ?? account.pages[0];
  if (!page) throw new PublishError("No Facebook Page found for this account", false);
  return page;
}

export const facebook: Publisher & { selectPage(pageId: string): Promise<void> } = {
  platform: "facebook",

  status() {
    const account = accounts.get().facebook;
    const page = account ? account.pages.find((p) => p.id === account.pageId) ?? account.pages[0] : null;
    return {
      platform: "facebook",
      configured: Boolean(appId() && appSecret()),
      connected: Boolean(account),
      accountName: page?.name ?? null,
      note: "Publica Reels en una Página de Facebook que administres. Para usarla fuera de modo desarrollo, Meta debe aprobar tu app.",
    };
  },

  authUrl(state, redirectUri) {
    const params = new URLSearchParams({ client_id: appId(), redirect_uri: redirectUri, state, scope: SCOPES.join(","), response_type: "code" });
    return `https://www.facebook.com/${VERSION}/dialog/oauth?${params}`;
  },

  async handleCallback(code, redirectUri) {
    const short = await graph("/oauth/access_token", { client_id: appId(), client_secret: appSecret(), redirect_uri: redirectUri, code });
    const long = await graph("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: appId(),
      client_secret: appSecret(),
      fb_exchange_token: short.access_token,
    });
    // Page tokens obtained from a long-lived user token do not expire.
    const pages = await graph("/me/accounts", { access_token: long.access_token, fields: "id,name,access_token" });
    const list = (pages.data ?? []).map((p: any) => ({ id: p.id, name: p.name, token: p.access_token }));
    await saveAccount("facebook", { userToken: long.access_token, pages: list, pageId: list[0]?.id ?? null });
  },

  async selectPage(pageId) {
    const account = accounts.get().facebook;
    if (!account?.pages.some((p) => p.id === pageId)) throw new Error("Unknown page");
    await saveAccount("facebook", { ...account, pageId });
  },

  async disconnect() {
    await saveAccount("facebook", null);
  },

  async publish(input: PublishInput) {
    const page = currentPage(accounts.get().facebook);
    const file = await fs.readFile(input.filePath);

    const start = await graph(`/${page.id}/video_reels`, { upload_phase: "start", access_token: page.token }, "POST");
    const upload = await fetch(start.upload_url ?? `https://rupload.facebook.com/video-upload/${VERSION}/${start.video_id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${page.token}`, offset: "0", file_size: String(file.byteLength) },
      body: file,
    });
    const uploaded = await readJson(upload);
    if (!upload.ok || uploaded.success === false) {
      throw new PublishError(`Facebook upload failed: ${uploaded.debug_info?.message ?? upload.status}`, upload.status >= 500);
    }

    const hashtags = input.tags.map((t) => `#${t.replace(/\s+/g, "")}`).join(" ");
    await graph(
      `/${page.id}/video_reels`,
      {
        upload_phase: "finish",
        video_id: start.video_id,
        video_state: "PUBLISHED",
        title: input.title.slice(0, 255),
        description: `${input.description}${hashtags && !input.description.includes("#") ? `\n\n${hashtags}` : ""}`,
        access_token: page.token,
      },
      "POST",
    );
    return { remoteId: String(start.video_id), url: `https://www.facebook.com/reel/${start.video_id}` };
  },
};
