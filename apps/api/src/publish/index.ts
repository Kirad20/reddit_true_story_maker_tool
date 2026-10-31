import { randomUUID } from "node:crypto";
import { OAUTH_BASE } from "../config";
import type { Platform } from "../domain";
import { accounts } from "./accounts";
import { facebook } from "./facebook";
import { tiktok } from "./tiktok";
import type { Publisher } from "./types";
import { youtube } from "./youtube";

export const publishers: Record<Platform, Publisher> = { youtube, tiktok, facebook };
export { facebook };

export const loadAccounts = () => accounts.load();

export const redirectUri = (platform: Platform) => `${OAUTH_BASE}/api/auth/${platform}/callback`;

// CSRF protection for OAuth: state values we issued and have not seen back yet.
const pendingStates = new Map<string, { platform: Platform; createdAt: number }>();

export function startAuth(platform: Platform): string {
  const publisher = publishers[platform];
  if (!publisher.status().configured) throw new Error(`Add the ${platform} app credentials in Settings → Credenciales first`);
  const state = randomUUID();
  pendingStates.set(state, { platform, createdAt: Date.now() });
  return publisher.authUrl(state, redirectUri(platform));
}

export async function finishAuth(platform: Platform, code: string, state: string): Promise<void> {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || pending.platform !== platform || Date.now() - pending.createdAt > 15 * 60_000) {
    throw new Error("Invalid or expired login attempt, try connecting again");
  }
  await publishers[platform].handleCallback(code, redirectUri(platform));
}

export function accountStatuses() {
  return Object.values(publishers).map((p) => p.status());
}
