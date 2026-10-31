import type { Platform } from "../domain";
import { Doc } from "../store";

/**
 * The account each platform publishes with. The OAuth tokens themselves live in
 * Better Auth's account table (data/auth.db, encrypted); this only points at the row.
 */
export type LinkedAccount = {
  /** Better Auth user who connected it. */
  userId: string;
  /** Better Auth account row id. */
  accountId: string;
  accountName: string | null;
  linkedBy: string | null;
};

export type FacebookAccount = LinkedAccount & {
  /** Page tokens derived from a long-lived user token; they do not expire. */
  pages: { id: string; name: string; token: string }[];
  pageId: string | null;
};

export type Accounts = {
  youtube: LinkedAccount | null;
  tiktok: LinkedAccount | null;
  facebook: FacebookAccount | null;
};

/** Better Auth social provider behind each platform. */
export const PROVIDER_OF: Record<Platform, "google" | "tiktok" | "facebook"> = { youtube: "google", tiktok: "tiktok", facebook: "facebook" };

/** Stored in data/accounts.json (git-ignored). */
export const accounts = new Doc<Accounts>("accounts", { youtube: null, tiktok: null, facebook: null });

/** Load, dropping entries from the old built-in OAuth (raw tokens): those accounts must be connected again. */
export async function loadAccounts(): Promise<void> {
  const value = await accounts.load();
  let changed = false;
  for (const key of Object.keys(value) as Platform[]) {
    const entry = value[key] as Record<string, unknown> | null;
    if (entry && (!("userId" in entry) || "accessToken" in entry || "userToken" in entry)) {
      value[key] = null;
      changed = true;
    }
  }
  if (changed) {
    await accounts.set(value);
    console.warn("[publish] Platform accounts now connect through the login (Better Auth): connect them again in Ajustes → Cuentas.");
  }
}

export async function saveAccount<K extends keyof Accounts>(key: K, value: Accounts[K]): Promise<void> {
  await accounts.set({ ...accounts.get(), [key]: value });
}
