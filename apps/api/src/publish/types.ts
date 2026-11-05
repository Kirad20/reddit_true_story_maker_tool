import type { Platform, TikTokPostOptions, TikTokPrivacy } from "../domain";

export type PublishInput = {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  /** The video uses AI voice / AI-written text; platforms ask creators to disclose it. */
  aiGenerated: boolean;
};

export type PublishResult = { remoteId: string; url: string | null };

export type AccountStatus = {
  platform: Platform;
  /** Zernio API key present (Ajustes → Credenciales). */
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  note: string | null;
};

export type TikTokSettings = {
  privacy: TikTokPrivacy;
  /** Choices made by the creator in the Direct Post screen (review flow). */
  post?: TikTokPostOptions | null;
};

/** What TikTok reports for the creator, as the Direct Post screen needs it. */
export type TikTokCreatorInfo = {
  nickname: string;
  username: string | null;
  avatarUrl: string | null;
  privacyOptions: TikTokPrivacy[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

export interface Publisher {
  platform: Platform;
  status(): AccountStatus;
  disconnect(): Promise<void>;
  publish(input: PublishInput, settings: unknown): Promise<PublishResult>;
}

export class PublishError extends Error {
  constructor(
    message: string,
    /** False for errors a retry cannot fix (bad credentials, rejected content). */
    readonly retryable = true,
  ) {
    super(message);
  }
}

export async function readJson(res: Response): Promise<Record<string, any>> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}
