import { Doc } from "../store";

export type OAuthToken = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. */
  expiresAt: number | null;
  accountName: string | null;
  accountId: string | null;
};

export type FacebookAccount = {
  userToken: string;
  pages: { id: string; name: string; token: string }[];
  pageId: string | null;
};

export type Accounts = {
  youtube: OAuthToken | null;
  tiktok: OAuthToken | null;
  facebook: FacebookAccount | null;
};

/** OAuth tokens for the user's own channels. Stored in data/accounts.json (git-ignored). */
export const accounts = new Doc<Accounts>("accounts", { youtube: null, tiktok: null, facebook: null });

export async function saveAccount<K extends keyof Accounts>(key: K, value: Accounts[K]): Promise<void> {
  await accounts.set({ ...accounts.get(), [key]: value });
}
