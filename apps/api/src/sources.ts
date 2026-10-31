import { writeOriginalStories } from "./agents";
import type { Settings, Story } from "./domain";
import { fetchRedditPost, fetchSubredditTop, hasRedditAccess } from "./reddit";
import { newId } from "./store";

export type NewStory = Omit<Story, "id" | "status" | "createdAt" | "curation" | "jobId" | "error">;

function story(partial: NewStory): Story {
  return {
    ...partial,
    id: newId("st"),
    status: "candidate",
    createdAt: new Date().toISOString(),
    curation: null,
    jobId: null,
    error: null,
  };
}

/** Claude writes brand-new fictional stories (no third-party content involved). */
export async function discoverOriginal(settings: Settings, existing: Story[]): Promise<Story[]> {
  const cfg = settings.sources.original;
  const written = await writeOriginalStories({
    genres: cfg.genres,
    count: cfg.perRun,
    language: settings.video.language,
    avoidTitles: existing.filter((s) => s.source === "original").map((s) => s.title),
  });
  return written.map((w) =>
    story({ ...w, source: "original", url: null, score: 0, fictional: true }),
  );
}

/**
 * Top self-posts from configured subreddits via the redditapis.com provider
 * or Reddit's official API (approved credentials). No scraping.
 */
export async function discoverReddit(settings: Settings, existing: Story[]): Promise<{ stories: Story[]; errors: string[] }> {
  const cfg = settings.sources.reddit;
  if (!hasRedditAccess()) return { stories: [], errors: ["Reddit source skipped: add a redditapis.com key or approved Reddit API credentials in Settings → Credenciales"] };
  const seen = new Set(existing.map((s) => s.url).filter(Boolean));
  const found: Story[] = [];
  const errors: string[] = [];

  for (const subreddit of cfg.subreddits) {
    if (found.length >= cfg.perRun) break;
    try {
      const posts = await fetchSubredditTop(subreddit, cfg.timeframe, 25);
      for (const p of posts) {
        if (found.length >= cfg.perRun) break;
        if (!p.isSelf || p.stickied || p.nsfw || p.score < cfg.minScore || seen.has(p.permalink)) continue;
        const post = await fetchRedditPost(p.permalink, settings.video.commentCount);
        if (post.body.length < 200) continue;
        seen.add(p.permalink);
        found.push(
          story({
            source: "reddit",
            title: post.title,
            body: post.body,
            comments: post.comments.map((c) => ({ author: c.author, body: c.body })),
            subreddit: post.subreddit,
            author: post.author,
            url: post.permalink,
            score: post.score,
            fictional: false,
          }),
        );
      }
    } catch (error) {
      errors.push(`r/${subreddit}: ${(error as Error).message}`);
    }
  }
  return { stories: found, errors };
}

export function manualStory(input: { title: string; body: string; subreddit?: string; comments?: { author: string; body: string }[] }): Story {
  return story({
    source: "manual",
    title: input.title.trim(),
    body: input.body.trim(),
    comments: input.comments ?? [],
    subreddit: input.subreddit?.trim() || "AskReddit",
    author: "anonymous",
    url: null,
    score: 0,
    fictional: false,
  });
}
