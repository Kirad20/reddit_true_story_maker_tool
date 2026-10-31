import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { assetKey, assetUrl, groupKeys, keyFromUrlPath, listBackgrounds, listMusic, setAssetStore } from "../src/assets";
import { createS3AssetStore, type S3Like } from "../src/s3assets";
import { checkEnvironment } from "../src/validate";

const cfg = { bucket: "tsm", endpoint: "http://seaweed:8333", region: "us-east-1", accessKeyId: "k", secretAccessKey: "s", prefix: "assets/", forcePathStyle: true };

/** In-memory bucket answering the commands the store sends. */
function fakeS3(objects: Record<string, Buffer>): S3Like & { sent: { name: string; input: Record<string, unknown> }[] } {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const fail = (status: number, name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  return {
    sent,
    send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      const input = command.input;
      sent.push({ name, input });
      if (name === "ListObjectsV2Command") {
        const keys = Object.keys(objects).filter((k) => k.startsWith(String(input.Prefix)));
        // Two pages to exercise pagination.
        const page = input.ContinuationToken ? keys.slice(1) : keys.slice(0, 1);
        return { Contents: page.map((Key) => ({ Key, Size: objects[Key].length })), IsTruncated: !input.ContinuationToken && keys.length > 1, NextContinuationToken: "next" };
      }
      if (name === "HeadBucketCommand") return {};
      const body = objects[String(input.Key)];
      if (!body) throw fail(404, "NoSuchKey");
      if (name === "HeadObjectCommand") return { ContentLength: body.length, ContentType: "application/octet-stream" };
      const range = /bytes=(\d+)-(\d*)/.exec(String(input.Range ?? ""));
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Number(range[2]) : body.length - 1;
      const slice = body.subarray(start, end + 1);
      return {
        Body: Readable.from([slice]),
        ContentLength: slice.length,
        ContentRange: range ? `bytes ${start}-${end}/${body.length}` : undefined,
        ContentType: "application/octet-stream",
        ETag: '"abc"',
      };
    }) as S3Like["send"],
  };
}

async function serve(handler: express.RequestHandler) {
  const app = express();
  app.use("/media/assets", handler);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media/assets`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

afterEach(() => setAssetStore(null));

describe("asset keys", () => {
  it("builds encoded media URLs and rejects traversal", () => {
    expect(assetUrl(assetKey("backgrounds", "mine craft", "a#1.mp4"))).toBe("/media/assets/backgrounds/mine%20craft/a%231.mp4");
    expect(() => assetKey("music", "../secrets.json")).toThrow(/Invalid music path/);
    expect(() => assetKey("backgrounds", "..", "x.mp4")).toThrow(/Invalid background path/);
    expect(() => assetKey("backgrounds", "a/b", "x.mp4")).toThrow();
  });

  it("parses request paths into keys only for media inside the two folders", () => {
    expect(keyFromUrlPath("/backgrounds/mine%20craft/a.mp4")).toBe("backgrounds/mine craft/a.mp4");
    expect(keyFromUrlPath("/music/song.mp3")).toBe("music/song.mp3");
    expect(keyFromUrlPath("/backgrounds/%2e%2e/x.mp4")).toBeNull();
    expect(keyFromUrlPath("/backgrounds/a%2Fb/x.mp4")).toBeNull();
    expect(keyFromUrlPath("/music/notes.txt")).toBeNull();
    expect(keyFromUrlPath("/other/x.mp4")).toBeNull();
    expect(keyFromUrlPath("/backgrounds/%E0%A4%A/x.mp4")).toBeNull();
  });

  it("groups keys into categories and music, ignoring other files", () => {
    expect(
      groupKeys(["backgrounds/b/2.mp4", "backgrounds/b/1.webm", "backgrounds/a/x.mov", "backgrounds/a/readme.txt", "backgrounds/loose.mp4", "music/z.mp3", "music/.hidden.mp3", "music/sub/x.mp3"]),
    ).toEqual({ backgrounds: [{ name: "a", clips: ["x.mov"] }, { name: "b", clips: ["1.webm", "2.mp4"] }], music: ["z.mp3"] });
  });
});

describe("S3 asset store", () => {
  const objects = {
    "assets/backgrounds/minecraft/p1.mp4": Buffer.from("0123456789"),
    "assets/backgrounds/minecraft/p2.mp4": Buffer.from("abc"),
    "assets/music/lofi.mp3": Buffer.from("music"),
  };

  it("lists every page under the prefix", async () => {
    setAssetStore(createS3AssetStore(cfg, fakeS3(objects)));
    expect(await listBackgrounds()).toEqual([{ name: "minecraft", clips: ["p1.mp4", "p2.mp4"] }]);
    expect(await listMusic()).toEqual(["lofi.mp3"]);
  });

  it("proxies objects with range requests and content types", async () => {
    const s3 = fakeS3(objects);
    const { base, close } = await serve(createS3AssetStore(cfg, s3).handler());
    try {
      const full = await fetch(`${base}/backgrounds/minecraft/p1.mp4`);
      expect(full.status).toBe(200);
      expect(full.headers.get("content-type")).toBe("video/mp4");
      expect(full.headers.get("accept-ranges")).toBe("bytes");
      expect(await full.text()).toBe("0123456789");

      const part = await fetch(`${base}/backgrounds/minecraft/p1.mp4`, { headers: { Range: "bytes=2-4" } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
      expect(await part.text()).toBe("234");
      expect(s3.sent.at(-1)?.input).toMatchObject({ Bucket: "tsm", Key: "assets/backgrounds/minecraft/p1.mp4", Range: "bytes=2-4" });

      const head = await fetch(`${base}/music/lofi.mp3`, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toBe("audio/mpeg");

      expect((await fetch(`${base}/music/missing.mp3`)).status).toBe(404);
      expect((await fetch(`${base}/backgrounds/%2e%2e/x.mp4`)).status).toBe(404);
    } finally {
      await close();
    }
  });

  it("reports an unreachable bucket", async () => {
    const down: S3Like = { send: (async () => Promise.reject(Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } }))) as S3Like["send"] };
    expect(await createS3AssetStore(cfg, down).check()).toMatch(/access denied/);
  });
});

describe("S3 configuration checks", () => {
  const errors = (env: NodeJS.ProcessEnv) => checkEnvironment(env).filter((p) => p.level === "error").map((p) => p.message);

  it("accepts a SeaweedFS endpoint with or without credentials", () => {
    expect(errors({ S3_BUCKET: "tsm", S3_ENDPOINT: "http://seaweedfs:8333", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b" })).toEqual([]);
    expect(errors({ S3_BUCKET: "tsm", S3_ENDPOINT: "http://seaweedfs:8333" })).toEqual([]);
  });

  it("rejects bad endpoints, half credentials and bad flags", () => {
    expect(errors({ S3_BUCKET: "tsm", S3_ENDPOINT: "seaweedfs:8333" })[0]).toMatch(/S3_ENDPOINT/);
    expect(errors({ S3_BUCKET: "tsm", S3_ACCESS_KEY_ID: "a" })[0]).toMatch(/S3_SECRET_ACCESS_KEY/);
    expect(errors({ S3_BUCKET: "tsm", S3_FORCE_PATH_STYLE: "yes" })[0]).toMatch(/S3_FORCE_PATH_STYLE/);
  });

  it("warns when S3 variables are set without a bucket", () => {
    expect(checkEnvironment({ S3_ENDPOINT: "http://seaweedfs:8333" })).toEqual([expect.objectContaining({ level: "warn", message: expect.stringMatching(/S3_BUCKET/) })]);
  });
});
