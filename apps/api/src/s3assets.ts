import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Request, RequestHandler, Response } from "express";
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import type { AssetStore } from "./assets";
import { keyFromUrlPath } from "./assets";
import type { S3AssetsConfig } from "./config";

/** Minimal S3 surface the store uses, so tests can pass a fake. */
export type S3Like = Pick<S3Client, "send">;

export type S3AssetStore = AssetStore & { readonly kind: "s3" };

export function createS3Client(cfg: S3AssetsConfig): S3Client {
  const anonymous = !cfg.accessKeyId && !cfg.secretAccessKey;
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: anonymous
      ? { accessKeyId: "anonymous", secretAccessKey: "anonymous" }
      : { accessKeyId: cfg.accessKeyId ?? "", secretAccessKey: cfg.secretAccessKey ?? "" },
    // SeaweedFS without an identity config accepts unsigned requests only.
    ...(anonymous ? { signer: { sign: async (request) => request } } : {}),
    // Newer SDKs add CRC checksums by default; several S3-compatible servers reject or omit them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const statusOf = (error: unknown): number | undefined =>
  (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;

function setObjectHeaders(res: Response, obj: GetObjectCommandOutput | HeadObjectCommandOutput, key: string): void {
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", obj.ContentType && obj.ContentType !== "application/octet-stream" ? obj.ContentType : mimeFor(key));
  if (obj.ContentLength !== undefined) res.setHeader("Content-Length", String(obj.ContentLength));
  if ("ContentRange" in obj && obj.ContentRange) res.setHeader("Content-Range", obj.ContentRange);
  if (obj.ETag) res.setHeader("ETag", obj.ETag);
  if (obj.LastModified) res.setHeader("Last-Modified", obj.LastModified.toUTCString());
  // Behind the login: browsers may cache, shared caches may not.
  res.setHeader("Cache-Control", "private, max-age=3600");
}

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};
export const mimeFor = (key: string) => MIME[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export function createS3AssetStore(cfg: S3AssetsConfig, client: S3Like = createS3Client(cfg)): S3AssetStore {
  const objectKey = (key: string) => cfg.prefix + key;

  async function listKeys(): Promise<string[]> {
    const keys: string[] = [];
    for (const folder of ["backgrounds/", "music/"]) {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: cfg.prefix + folder, ContinuationToken: token }),
        );
        for (const obj of page.Contents ?? []) {
          if (obj.Key && (obj.Size ?? 1) > 0) keys.push(obj.Key.slice(cfg.prefix.length));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
    return keys;
  }

  async function clipDuration(key: string): Promise<number> {
    // Read only the container headers through range requests on a short-lived signed URL.
    const url = await getSignedUrl(client as S3Client, new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey(key) }), {
      expiresIn: 300,
    });
    const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
    try {
      return await input.computeDuration();
    } finally {
      input.dispose();
    }
  }

  async function serve(req: Request, res: Response): Promise<void> {
    const key = keyFromUrlPath(req.path);
    if (!key) {
      res.status(404).end();
      return;
    }
    const conditional = {
      IfNoneMatch: req.headers["if-none-match"],
      IfModifiedSince: req.headers["if-modified-since"] ? new Date(req.headers["if-modified-since"]) : undefined,
    };
    try {
      if (req.method === "HEAD") {
        const head = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: objectKey(key), ...conditional }));
        setObjectHeaders(res, head, key);
        res.status(200).end();
        return;
      }
      const obj = await client.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey(key), Range: req.headers.range, ...conditional }),
      );
      setObjectHeaders(res, obj, key);
      res.status(obj.ContentRange ? 206 : 200);
      const body = obj.Body as Readable | undefined;
      if (!body) {
        res.end();
        return;
      }
      // Stop reading from the bucket when the player seeks away or the renderer closes the connection.
      res.on("close", () => body.destroy());
      body.on("error", () => res.destroy());
      body.pipe(res);
    } catch (error) {
      const status = statusOf(error);
      if (status === 304) res.status(304).end();
      else if (status === 404 || (error as Error).name === "NoSuchKey" || (error as Error).name === "NotFound") res.status(404).end();
      else if (status === 416) res.status(416).end();
      else {
        console.error(`[assets] S3 error for ${key}: ${(error as Error).message}`);
        res.status(502).json({ error: "Asset storage unavailable" });
      }
    }
  }

  return {
    kind: "s3",
    listKeys,
    clipDuration,
    handler: () => (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      serve(req, res).catch(next);
    },
    async check() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
        return null;
      } catch (error) {
        const status = statusOf(error);
        const reason = status === 404 ? "bucket not found" : status === 403 ? "access denied (check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY)" : (error as Error).message;
        return `S3 bucket "${cfg.bucket}" at ${cfg.endpoint ?? "AWS"}: ${reason}`;
      }
    },
  };
}
