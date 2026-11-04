import Zernio from "@zernio/node";

let client: Zernio | null = null;

/** Zernio client; reads ZERNIO_API_KEY from the environment (never hardcode it). */
export function zernio(): Zernio {
  if (!process.env.ZERNIO_API_KEY) throw new Error("ZERNIO_API_KEY is not set");
  return (client ??= new Zernio());
}

/** Connected social accounts (each has an `_id` to use as accountId and a `platform`). */
export async function listZernioAccounts() {
  const { data } = await zernio().accounts.listAccounts();
  return data;
}

/** Schedules a post; omit scheduledFor for a draft, or set publishNow to post immediately. */
export async function createZernioPost(opts: {
  content: string;
  platforms: { platform: string; accountId: string }[];
  scheduledFor?: string;
  publishNow?: boolean;
}) {
  const { data } = await zernio().posts.createPost({ body: opts as never });
  return data;
}
