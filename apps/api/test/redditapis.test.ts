import { afterEach, describe, expect, it, vi } from "vitest";
import { setSecrets } from "../src/aiconfig";
import { fetchRedditPost, fetchSubredditTop } from "../src/reddit";
import { normalizeComments, postIdFrom } from "../src/redditapis";

// Shapes copied from https://docs.redditapis.com/docs (post-comments-by-id, sub-top).
const postResponse = {
  post: {
    id: "1sgjld3",
    name: "t3_1sgjld3",
    title: "TIFU by labeling every egg",
    author: "egglord",
    permalink: "/r/tifu/comments/1sgjld3/tifu_by_labeling_every_egg/",
    text: "So this happened yesterday. **Bold** move, I know.",
    subreddit: "tifu",
    upvotes: 4210,
    comments: 12,
    over_18: false,
    stickied: false,
    is_self: true,
  },
  comments: [
    { kind: "t1", data: { id: "a", body: "Rule reminder", author: "AutoModerator", replies: "" } },
    { kind: "t1", data: { id: "b", body: "This is the pettiest thing I've read today.", author: "reader1", replies: "" } },
    { kind: "t1", data: { id: "c", body: "[deleted]", author: "[deleted]", replies: "" } },
    { kind: "t1", data: { id: "d", body: "Labels fix everything.", author: "reader2", replies: "" } },
    { kind: "more", data: { count: 273, children: ["x", "y"] } },
  ],
  after: null,
};

let calls: { url: string; headers: Record<string, string> }[] = [];

function mockFetch(body: unknown, status = 200) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("redditapis provider", () => {
  it("extracts post ids from links and fullnames", () => {
    expect(postIdFrom("https://www.reddit.com/r/tifu/comments/1SGJLD3/title/")).toBe("1sgjld3");
    expect(postIdFrom("t3_1tkez6e")).toBe("1tkez6e");
    expect(postIdFrom("https://example.com")).toBeNull();
  });

  it("keeps real top-level comments and skips bots, deleted and 'more' stubs", () => {
    const comments = normalizeComments(postResponse.comments, 5);
    expect(comments.map((c) => c.author)).toEqual(["reader1", "reader2"]);
  });

  it("fetches a post link through the provider with the bearer key", async () => {
    await setSecrets({ redditapis_key: "test-key" });
    mockFetch(postResponse);
    const post = await fetchRedditPost("https://www.reddit.com/r/tifu/comments/1sgjld3/tifu_by_labeling_every_egg/", 1);
    expect(calls[0].url).toBe("https://api.redditapis.com/api/reddit/post/1sgjld3/comments?limit=50&depth=1&sort=top");
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
    expect(post).toMatchObject({
      title: "TIFU by labeling every egg",
      subreddit: "tifu",
      score: 4210,
      numComments: 12,
      permalink: "https://www.reddit.com/r/tifu/comments/1sgjld3/tifu_by_labeling_every_egg/",
    });
    expect(post.comments).toHaveLength(1);
  });

  it("lists a subreddit's top posts", async () => {
    await setSecrets({ redditapis_key: "test-key" });
    mockFetch({ posts: [postResponse.post], after: null });
    const posts = await fetchSubredditTop("r/tifu", "day", 25);
    expect(calls[0].url).toBe("https://api.redditapis.com/api/reddit/sub/tifu/top?t=day&limit=25");
    expect(posts[0]).toMatchObject({ score: 4210, isSelf: true, nsfw: false });
  });

  it("explains out-of-credit errors", async () => {
    await setSecrets({ redditapis_key: "test-key" });
    mockFetch({ error: "Insufficient credits" }, 402);
    await expect(fetchSubredditTop("tifu", "day", 5)).rejects.toThrow(/out of credits/);
  });
});
