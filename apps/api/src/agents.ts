import { structured } from "./claude";
import type { Genre, Platform, Story } from "./domain";

const GENRE_BRIEF: Record<Genre, string> = {
  aita: "an 'Am I the jerk?' dilemma where the narrator asks readers to judge a conflict",
  tifu: "a 'Today I messed up' story about an embarrassing, escalating mistake",
  revenge: "a petty or pro revenge story where someone gets a satisfying comeuppance",
  relationship: "a relationship or family drama with a surprising turn",
  workplace: "a workplace story about a difficult boss, coworker or customer",
  creepy: "an unsettling but non-graphic first-person encounter story",
  wholesome: "a heartwarming story about an unexpected act of kindness",
};

const GENRE_SUBREDDIT: Record<Genre, string> = {
  aita: "AmItheAsshole",
  tifu: "tifu",
  revenge: "pettyrevenge",
  relationship: "relationship_advice",
  workplace: "antiwork",
  creepy: "LetsNotMeet",
  wholesome: "MadeMeSmile",
};

// ---------------------------------------------------------------- writer

const WRITER_SYSTEM = `You write ORIGINAL short first-person stories in the style of popular Reddit story posts, for narrated vertical videos.
Every story is fiction you invent: never retell a real post, never use real people's names, usernames, companies or places that could identify anyone.
Write for the ear: plain spoken sentences, no emojis, hashtags, links or markdown.
Open with a hook in the title, build tension, end with a twist or a question to the viewer that invites comments.
Keep it suitable for a general audience: no sexual content, graphic violence, self-harm, slurs or minors in danger.`;

const STORIES_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          genre: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          comments: {
            type: "array",
            items: {
              type: "object",
              properties: { author: { type: "string" }, body: { type: "string" } },
              required: ["author", "body"],
              additionalProperties: false,
            },
          },
        },
        required: ["genre", "title", "body", "comments"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

export type WrittenStory = Pick<Story, "title" | "body" | "comments" | "subreddit" | "author">;

export async function writeOriginalStories(opts: {
  genres: Genre[];
  count: number;
  language: "en" | "es";
  avoidTitles: string[];
}): Promise<WrittenStory[]> {
  const genres = opts.genres.length ? opts.genres : (["aita"] as Genre[]);
  const plan = Array.from({ length: opts.count }, (_, i) => genres[i % genres.length]);
  const prompt = [
    `Write ${opts.count} different stories. Genres, in order: ${plan.map((g) => `${g} (${GENRE_BRIEF[g]})`).join("; ")}.`,
    "Each body: 180-260 words, told by the narrator. Each story also gets 2 short reader comments (12-40 words) with invented usernames, reacting like real commenters (a judgment, a joke, a follow-up question).",
    `Language: ${opts.language === "es" ? "natural neutral Latin American Spanish" : "English"}.`,
    opts.avoidTitles.length ? `Do not repeat these premises:\n- ${opts.avoidTitles.slice(-40).join("\n- ")}` : "",
    'Set "genre" to the genre id you used.',
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await structured<{ stories: { genre: string; title: string; body: string; comments: { author: string; body: string }[] }[] }>({
    agent: "writer",
    system: WRITER_SYSTEM,
    prompt,
    schema: STORIES_SCHEMA,
  });
  return result.stories.map((s) => ({
    title: s.title.trim(),
    body: s.body.trim(),
    comments: s.comments.slice(0, 4),
    subreddit: GENRE_SUBREDDIT[s.genre as Genre] ?? "stories",
    author: "storyteller",
  }));
}

// ---------------------------------------------------------------- curator

const CURATOR_SYSTEM = `You are an editor choosing stories for narrated short-form videos (TikTok, Reels, Shorts).
Score each story 1-10 for how likely it is to hold a viewer for 60 seconds: hook strength, clear stakes, payoff, pacing when read aloud.
Flag problems that should block or require a human look:
- "pii": names, usernames, workplaces, locations or details that could identify a real private person
- "sensitive": sexual content, graphic violence, self-harm, abuse, minors in danger, medical or legal crises of real people
- "hateful": slurs or attacks on protected groups
- "too_long" / "too_short": unsuitable length for 30-90 seconds of narration
- "low_quality": incoherent, no story, or mostly links/meta discussion
Lower the score for every serious flag.`;

const CURATION_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          score: { type: "integer" },
          reason: { type: "string" },
          flags: { type: "array", items: { type: "string" } },
        },
        required: ["id", "score", "reason", "flags"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

export type Curation = { id: string; score: number; reason: string; flags: string[] };

export async function curateStories(list: Pick<Story, "id" | "title" | "body" | "comments">[]): Promise<Curation[]> {
  if (list.length === 0) return [];
  const payload = list.map((s) => ({
    id: s.id,
    title: s.title,
    body: s.body.slice(0, 4000),
    comments: s.comments.map((c) => c.body.slice(0, 400)),
  }));
  const result = await structured<{ results: Curation[] }>({
    agent: "curator",
    system: CURATOR_SYSTEM,
    prompt: `Evaluate each story. Return one result per id, reason in one short sentence.\n\n${JSON.stringify(payload)}`,
    schema: CURATION_SCHEMA,
  });
  return result.results.map((r) => ({ ...r, score: Math.max(1, Math.min(10, Math.round(r.score))) }));
}

// ---------------------------------------------------------------- metadata

const METADATA_SYSTEM = `You write upload metadata for narrated story videos.
Titles: curiosity-driven, honest (no clickbait that the video does not deliver), no ALL CAPS, at most one emoji.
Descriptions: 1-3 short sentences teasing the story, then hashtags. If the story is fictional say so plainly ("Fictional story").
Only when the prompt gives a Reddit source, credit it as "Story from r/<subreddit>".`;

const PLATFORM_RULES: Record<Platform, string> = {
  youtube: "YouTube Shorts: title max 90 characters and include #shorts at the end of the description; 5-8 tags without '#'.",
  tiktok: "TikTok: the caption is the title field, max 150 characters including 3-5 hashtags; description can be empty; tags without '#'.",
  facebook: "Facebook Reels: title max 80 characters; description 1-2 sentences plus 3-5 hashtags; tags without '#'.",
};

const METADATA_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "description", "tags"],
  additionalProperties: false,
};

export type Metadata = { title: string; description: string; tags: string[] };

export async function writeMetadata(story: Story, platform: Platform, language: "en" | "es"): Promise<Metadata> {
  const meta = await structured<Metadata>({
    agent: "metadata",
    system: METADATA_SYSTEM,
    prompt: [
      PLATFORM_RULES[platform],
      `Language: ${language === "es" ? "Spanish" : "English"}.`,
      story.fictional
        ? "This story is fictional (AI-written)."
        : story.source === "reddit"
          ? `Source: r/${story.subreddit}${story.url ? ` (${story.url})` : ""}.`
          : "The creator submitted this story; do not add a source credit.",
      `Title: ${story.title}\n\nStory:\n${story.body.slice(0, 3000)}`,
    ].join("\n\n"),
    schema: METADATA_SCHEMA,
  });
  return { title: meta.title.trim(), description: meta.description.trim(), tags: meta.tags.map((t) => t.replace(/^#/, "")).slice(0, 10) };
}

/** Used when Claude is unavailable: plain metadata from the story itself. */
export function fallbackMetadata(story: Story, platform: Platform): Metadata {
  const tags = ["reddit", "redditstories", "storytime", story.subreddit.toLowerCase()];
  const credit = creditLine(story);
  const hashtags = tags.map((t) => `#${t}`).join(" ");
  const title = story.title.length > 90 ? `${story.title.slice(0, 87)}...` : story.title;
  return {
    title: platform === "tiktok" ? `${title.slice(0, 120)} ${hashtags}`.slice(0, 150) : title,
    description: `${credit ? `${credit}\n\n` : ""}${hashtags}${platform === "youtube" ? " #shorts" : ""}`,
    tags,
  };
}

/** Fiction is disclosed; Reddit posts are credited; the user's own stories need neither. */
function creditLine(story: Story): string {
  if (story.fictional) return "Fictional story.";
  if (story.source === "reddit") return `Story from r/${story.subreddit}.`;
  return "";
}
