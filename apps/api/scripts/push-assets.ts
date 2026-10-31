// Upload the local assets/ folder (backgrounds and music) to the S3-compatible bucket in S3_* variables.
// Files already in the bucket with the same size are skipped. Run: npm run assets:push [-- --dry-run]
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { assetStore, groupKeys } from "../src/assets";
import { ASSETS_DIR, S3_ASSETS } from "../src/config";
import { createS3Client, mimeFor } from "../src/s3assets";
import { checkEnvironment, reportOrExit } from "../src/validate";

const dryRun = process.argv.includes("--dry-run");
reportOrExit(checkEnvironment(process.env));
if (!S3_ASSETS) {
  console.error("S3_BUCKET is not set. Configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
  process.exit(1);
}

// The local folder, with the same rules the app uses to list it.
async function localKeys(): Promise<string[]> {
  const keys: string[] = [];
  const walk = async (dir: string, rel: string[]) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), [...rel, entry.name]);
      else if (entry.isFile()) keys.push([...rel, entry.name].join("/"));
    }
  };
  await walk(ASSETS_DIR, []);
  const { backgrounds, music } = groupKeys(keys);
  return [...backgrounds.flatMap((c) => c.clips.map((f) => `backgrounds/${c.name}/${f}`)), ...music.map((m) => `music/${m}`)];
}

const client = createS3Client(S3_ASSETS);
const problem = await assetStore().check();
if (problem) {
  console.error(problem);
  process.exit(1);
}

const keys = await localKeys();
console.log(`${keys.length} asset(s) in ${ASSETS_DIR} → s3://${S3_ASSETS.bucket}/${S3_ASSETS.prefix}`);
let uploaded = 0;
for (const key of keys) {
  const file = path.join(ASSETS_DIR, ...key.split("/"));
  const { size } = await fs.stat(file);
  const Key = S3_ASSETS.prefix + key;
  const remoteSize = await client
    .send(new HeadObjectCommand({ Bucket: S3_ASSETS.bucket, Key }))
    .then((h) => h.ContentLength, () => undefined);
  if (remoteSize === size) {
    console.log(`  = ${key}`);
    continue;
  }
  console.log(`  ↑ ${key} (${(size / 1e6).toFixed(1)} MB)`);
  if (dryRun) continue;
  await client.send(
    new PutObjectCommand({
      Bucket: S3_ASSETS.bucket,
      Key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: mimeFor(key),
    }),
  );
  uploaded++;
}
console.log(dryRun ? "Dry run: nothing uploaded." : `Done: ${uploaded} uploaded, ${keys.length - uploaded} already there.`);
