import { AUTH_BASE_PATH, onAccountLinked } from "../auth";
import { OAUTH_BASE } from "../config";
import { PLATFORMS, type Platform } from "../domain";
import { PROVIDER_OF, loadAccounts } from "./accounts";
import { facebook } from "./facebook";
import { tiktok } from "./tiktok";
import type { Publisher } from "./types";
import { youtube } from "./youtube";

export const publishers: Record<Platform, Publisher> = { youtube, tiktok, facebook };
export { facebook, loadAccounts };

export type LinkEvent = { platform: Platform; ok: boolean; message: string };
const linkListeners = new Set<(event: LinkEvent) => void>();
/** Results of connecting an account (for the activity log). */
export const onPlatformLinked = (fn: (event: LinkEvent) => void) => linkListeners.add(fn);

// A Google/TikTok/Facebook account linked through Better Auth becomes the publishing account of its platform.
onAccountLinked(async ({ providerId, userId, accountId, userName }) => {
  const platform = PLATFORMS.find((p) => PROVIDER_OF[p] === providerId);
  if (!platform) return;
  let event: LinkEvent;
  try {
    await publishers[platform].onLinked({ userId, accountId, linkedBy: userName });
    const status = publishers[platform].status();
    event = { platform, ok: true, message: `Connected ${platform}${status.accountName ? ` (${status.accountName})` : ""}${userName ? ` by ${userName}` : ""}` };
  } catch (error) {
    event = { platform, ok: false, message: `Connected ${platform}, but reading the account failed: ${(error as Error).message}` };
  }
  for (const fn of linkListeners) fn(event);
});

/** Redirect URI to register in each platform's developer app. */
export const redirectUri = (platform: Platform) => `${OAUTH_BASE}${AUTH_BASE_PATH}/callback/${PROVIDER_OF[platform]}`;

export function accountStatuses() {
  return Object.values(publishers).map((p) => ({ ...p.status(), provider: PROVIDER_OF[p.platform], redirectUri: redirectUri(p.platform) }));
}
