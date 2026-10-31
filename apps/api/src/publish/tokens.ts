import { auth, deleteAccountRow, linkedAccountExists } from "../auth";
import type { Platform } from "../domain";
import { accounts, saveAccount } from "./accounts";
import { PublishError } from "./types";

/**
 * Access tokens for the connected platform accounts, through Better Auth: it
 * decrypts them and refreshes expired ones with the provider's refresh token.
 * An object so tests can replace it.
 */
export const tokenSource = {
  async accessToken(platform: Platform): Promise<string> {
    const linked = accounts.get()[platform];
    if (!linked) throw new PublishError(`${platform} is not connected`, false);
    try {
      const { accessToken } = await auth.api.getAccessToken({ body: { accountId: linked.accountId, userId: linked.userId } });
      if (!accessToken) throw new Error("no access token");
      return accessToken;
    } catch (error) {
      throw new PublishError(`${platform} session expired or was revoked, connect it again (${(error as Error).message})`, false);
    }
  },

  /** The account row still exists (it disappears if its user is deleted). */
  exists(platform: Platform): boolean {
    const linked = accounts.get()[platform];
    return Boolean(linked && linkedAccountExists(linked.accountId));
  },

  async disconnect(platform: Platform): Promise<void> {
    const linked = accounts.get()[platform];
    if (linked) deleteAccountRow(linked.accountId);
    await saveAccount(platform, null);
  },
};
