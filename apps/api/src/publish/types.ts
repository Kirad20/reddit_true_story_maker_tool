import type { Platform } from "../domain";

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
  /** App credentials present in Settings → Credenciales. */
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  note: string | null;
};

export interface Publisher {
  platform: Platform;
  status(): AccountStatus;
  authUrl(state: string, redirectUri: string): string;
  handleCallback(code: string, redirectUri: string): Promise<void>;
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
