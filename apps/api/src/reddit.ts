import { secret } from "./aiconfig";
import { hasProvider, postIdFrom, providerPost, providerSubTop } from "./redditapis";

export type RedditComment = { author: string; body: string; score: number };

export type RedditPost = {
  subreddit: string;
  author: string;
  title: string;
  body: string;
  score: number;
  numComments: number;
  nsfw: boolean;
  permalink: string;
  comments: RedditComment[];
};

export class RedditError extends Error {}

const USER_AGENT = "truestorymaker/0.1 (personal video tool)";
const HIDDEN = new Set(["[deleted]", "[removed]", ""]);
const BOTS = /^(automoderator|.*bot)$/i;

/** Accepts reddit.com / old. / www. / redd.it / share (/s/) links. */
export function isRedditUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return /(^|\.)reddit\.com$|^redd\.it$/.test(url.hostname);
  } catch {
    return false;
  }
}

export function toJsonUrl(permalink: string, limit = 100): string {
  const pathname = new URL(permalink).pathname.replace(/\/+$/, "");
  return `https://www.reddit.com${pathname}.json?raw_json=1&sort=top&limit=${limit}`;
}

export function toOAuthUrl(permalink: string, limit = 100): string {
  const pathname = new URL(permalink).pathname.replace(/\/+$/, "");
  return `https://oauth.reddit.com${pathname}?raw_json=1&sort=top&limit=${limit}`;
}

export const hasOAuth = () => Boolean(secret("reddit_client_id") && secret("reddit_client_secret"));
let token: { value: string; expiresAt: number } | null = null;

/** App-only OAuth token (official API) from a "script" app at reddit.com/prefs/apps. */
async function oauthToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${secret("reddit_client_id")}:${secret("reddit_client_secret")}`).toString("base64");
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new RedditError(`Reddit login failed (${res.status}): check the Reddit client id / secret in Settings`);
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return token.value;
}

const BLOCKED_HELP =
  "Reddit blocked the anonymous request. Add a redditapis.com key or approved Reddit API " +
  "credentials in Settings → Credenciales, or use 'Paste text'.";

type Listing = { kind: string; data: { children: { kind: string; data: Record<string, unknown> }[] } };

export function parseRedditListing(json: unknown, maxComments: number, maxCommentChars = 700): RedditPost {
  if (!Array.isArray(json) || json.length < 1) throw new RedditError("Unexpected Reddit response");
  const [postListing, commentListing] = json as Listing[];
  const post = postListing?.data?.children?.[0]?.data;
  if (!post) throw new RedditError("Post not found");

  const comments = (commentListing?.data?.children ?? [])
    .filter((c) => c.kind === "t1")
    .map((c) => c.data)
    .filter((c) => !c.stickied && !HIDDEN.has(String(c.body ?? "").trim()) && !BOTS.test(String(c.author ?? "")))
    .map((c) => ({ author: String(c.author), body: String(c.body).trim(), score: Number(c.score ?? 0) }))
    .filter((c) => c.body.length <= maxCommentChars)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxComments);

  return {
    subreddit: String(post.subreddit ?? "AskReddit"),
    author: String(post.author ?? "anonymous"),
    title: String(post.title ?? "").trim(),
    body: HIDDEN.has(String(post.selftext ?? "").trim()) ? "" : String(post.selftext).trim(),
    score: Number(post.score ?? 0),
    numComments: Number(post.num_comments ?? 0),
    nsfw: Boolean(post.over_18),
    permalink: `https://www.reddit.com${post.permalink ?? ""}`,
    comments,
  };
}

export type ListingPost = { permalink: string; title: string; score: number; nsfw: boolean; isSelf: boolean; stickied: boolean };

/** Any configured way to read Reddit data: the redditapis.com provider or approved official API credentials. */
export const hasRedditAccess = () => hasProvider() || hasOAuth();

/** Top posts of a subreddit through the data provider or the official API. */
export async function fetchSubredditTop(subreddit: string, timeframe: "day" | "week", limit: number): Promise<ListingPost[]> {
  if (hasProvider()) return providerSubTop(subreddit, timeframe, limit);
  if (!hasOAuth()) throw new RedditError("The Reddit source needs a redditapis.com key or approved Reddit API credentials (Settings → Credenciales)");
  const name = subreddit.replace(/^r\//i, "").replace(/[^\w]/g, "");
  const res = await fetch(`https://oauth.reddit.com/r/${name}/top?t=${timeframe}&limit=${Math.min(limit, 100)}&raw_json=1`, {
    headers: { Authorization: `Bearer ${await oauthToken()}`, "User-Agent": USER_AGENT },
  });
  if (res.status === 429) throw new RedditError("Reddit rate limit reached");
  if (!res.ok) throw new RedditError(`Reddit returned ${res.status} for r/${name}`);
  const json = (await res.json()) as Listing;
  return json.data.children
    .filter((c) => c.kind === "t3")
    .map((c) => ({
      permalink: `https://www.reddit.com${c.data.permalink}`,
      title: String(c.data.title ?? ""),
      score: Number(c.data.score ?? 0),
      nsfw: Boolean(c.data.over_18),
      isSelf: Boolean(c.data.is_self),
      stickied: Boolean(c.data.stickied),
    }));
}

export async function fetchRedditPost(raw: string, maxComments: number): Promise<RedditPost> {
  if (!isRedditUrl(raw)) throw new RedditError("That is not a Reddit post URL");
  let permalink = raw;
  // Share links (/s/xyz) and redd.it short links redirect to the real permalink.
  if (/redd\.it|\/s\//.test(raw)) {
    const res = await fetch(raw, { redirect: "follow", headers: { "User-Agent": USER_AGENT } });
    permalink = res.url;
  }
  if (!/\/comments\//.test(permalink)) throw new RedditError("The link must point to a specific post (…/comments/…)");

  if (hasProvider()) {
    const id = postIdFrom(permalink);
    if (!id) throw new RedditError("Could not read the post id from that link");
    return providerPost(id, maxComments);
  }

  const res = hasOAuth()
    ? await fetch(toOAuthUrl(permalink), {
        headers: { Authorization: `Bearer ${await oauthToken()}`, "User-Agent": USER_AGENT },
      })
    : await fetch(toJsonUrl(permalink), {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        redirect: "manual", // a redirect here means Reddit wants a login
      });
  if (res.ok) return parseRedditListing(await res.json(), maxComments);
  if (res.status === 404) throw new RedditError("Post not found (deleted or private?)");
  if (res.status === 429) throw new RedditError("Reddit rate limit reached, try again in a minute");
  if (!hasOAuth() && (res.status === 403 || (res.status >= 300 && res.status < 400))) throw new RedditError(BLOCKED_HELP);
  throw new RedditError(`Reddit returned ${res.status}`);
}
