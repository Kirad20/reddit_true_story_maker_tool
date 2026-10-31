// Client for the third-party Reddit data provider at api.redditapis.com (the user's own paid account).
// Docs: https://docs.redditapis.com/docs
import type { Timeframe } from "./domain";
import type { ListingPost, RedditComment, RedditPost } from "./reddit";

import { secret } from "./aiconfig";

const BASE = "https://api.redditapis.com";

export const hasProvider = () => Boolean(secret("redditapis_key"));

export class ProviderError extends Error {}

type ProviderPost = {
  id: string;
  name?: string;
  title?: string;
  author?: string;
  permalink?: string;
  text?: string | null;
  subreddit?: string;
  upvotes?: number;
  comments?: number;
  over_18?: boolean;
  stickied?: boolean;
  is_self?: boolean;
};

type CommentNode = { kind: string; data: { id?: string; body?: string; author?: string; score?: number; stickied?: boolean } };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${secret("redditapis_key")}`, Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return body as T;
  if (res.status === 401 || res.status === 403) throw new ProviderError("redditapis.com rejected the API key (Settings → Credenciales)");
  if (res.status === 402) throw new ProviderError("redditapis.com: out of credits, top up your account");
  if (res.status === 404) throw new ProviderError("Post or subreddit not found");
  if (res.status === 429) throw new ProviderError("redditapis.com rate limit reached, try again shortly");
  throw new ProviderError(`redditapis.com returned ${res.status}${body.error ? `: ${String(body.error)}` : ""}`);
}

const HIDDEN = new Set(["[deleted]", "[removed]", ""]);
const BOTS = /^(automoderator|.*bot)$/i;

/** Top-level, real comments from native Reddit t1 nodes (provider order = top sort). */
export function normalizeComments(nodes: CommentNode[], max: number, maxChars = 700): RedditComment[] {
  return nodes
    .filter((n) => n.kind === "t1" && n.data)
    .map((n) => n.data)
    .filter((c) => !c.stickied && !HIDDEN.has(String(c.body ?? "").trim()) && !BOTS.test(String(c.author ?? "")))
    .map((c) => ({ author: String(c.author ?? "anonymous"), body: String(c.body).trim(), score: Number(c.score ?? 0) }))
    .filter((c) => c.body.length <= maxChars)
    .slice(0, max);
}

export function normalizePost(post: ProviderPost, comments: RedditComment[]): RedditPost {
  const permalink = post.permalink ?? "";
  return {
    subreddit: String(post.subreddit ?? "AskReddit"),
    author: String(post.author ?? "anonymous"),
    title: String(post.title ?? "").trim(),
    body: HIDDEN.has(String(post.text ?? "").trim()) ? "" : String(post.text).trim(),
    score: Number(post.upvotes ?? 0),
    numComments: Number(post.comments ?? 0),
    nsfw: Boolean(post.over_18),
    permalink: permalink.startsWith("http") ? permalink : `https://www.reddit.com${permalink}`,
    comments,
  };
}

/** Reddit post id ("1tkez6e") from a permalink or a t3_ fullname. */
export function postIdFrom(input: string): string | null {
  const fromUrl = /\/comments\/([a-z0-9]+)/i.exec(input);
  if (fromUrl) return fromUrl[1].toLowerCase();
  const fromName = /^(?:t3_)?([a-z0-9]{5,10})$/i.exec(input.trim());
  return fromName ? fromName[1].toLowerCase() : null;
}

export async function providerPost(id: string, maxComments: number): Promise<RedditPost> {
  const data = await get<{ post: ProviderPost | null; comments?: CommentNode[] }>(
    `/api/reddit/post/${encodeURIComponent(id)}/comments?limit=50&depth=1&sort=top`,
  );
  if (!data.post) throw new ProviderError("Post not found (deleted or private?)");
  return normalizePost(data.post, normalizeComments(data.comments ?? [], maxComments));
}

export async function providerSubTop(subreddit: string, timeframe: Timeframe, limit: number): Promise<ListingPost[]> {
  const name = subreddit.replace(/^r\//i, "").replace(/[^\w]/g, "");
  const data = await get<{ posts?: ProviderPost[] }>(
    `/api/reddit/sub/${name}/top?t=${timeframe}&limit=${Math.min(Math.max(limit, 1), 100)}`,
  );
  return (data.posts ?? []).map((p) => ({
    permalink: normalizePost(p, []).permalink,
    title: String(p.title ?? ""),
    score: Number(p.upvotes ?? 0),
    nsfw: Boolean(p.over_18),
    isSelf: p.is_self ?? Boolean(p.text),
    stickied: Boolean(p.stickied),
  }));
}
