import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const command = process.argv[2] || "audit";
const confirmed = process.argv.includes("--yes");
const dataDir = process.env.DATA_DIR || path.join(import.meta.dirname, "data");
const databasePath = path.join(dataDir, "blog.sqlite");
const source = r2Config(process.env);
const target = b2Config(process.env);
const db = new DatabaseSync(databasePath, { readOnly: !["cutover", "migrate"].includes(command) });

try {
  if (command === "audit") await audit();
  else if (command === "copy") await copyAll();
  else if (command === "verify") await verifyAll();
  else if (command === "cutover") await cutover();
  else if (command === "migrate") {
    await copyAll();
    await verifyAll();
    await cutover();
  } else {
    throw new Error("Usage: node b2-migrate.mjs audit|copy|verify|cutover|migrate [--yes]");
  }
} finally {
  db.close();
  source?.client.destroy();
  target?.client.destroy();
}

async function audit() {
  const releases = allReleases();
  const stored = releases.filter((release) => release.download_key);
  const local = releases.filter((release) => /^\/download\//.test(release.download_url));
  const external = releases.filter((release) => release.download_url && !release.download_key && !/^\/download\//.test(release.download_url));
  const missing = releases.filter((release) => !release.download_url);
  const summary = {
    releases: releases.length,
    storedObjects: stored.length,
    localDownloads: local.length,
    externalDownloads: external.length,
    withoutDownload: missing.length,
  };

  if (!source) {
    console.log(JSON.stringify({ ...summary, source: "R2 credentials are not configured" }, null, 2));
    return;
  }

  let bytes = 0;
  const unavailable = [];
  for (const release of stored) {
    try {
      const head = await headObject(source, release.download_key);
      bytes += head.size;
    } catch (error) {
      unavailable.push({ id: release.id, key: release.download_key, error: errorMessage(error) });
    }
  }
  console.log(JSON.stringify({ ...summary, sourceBytes: bytes, sourceGiB: gib(bytes), unavailable }, null, 2));
}

async function copyAll() {
  requireStorage(source, "Cloudflare R2 source");
  requireStorage(target, "Backblaze B2 target");
  const releases = storedReleases();
  let copied = 0;
  let skipped = 0;
  let bytes = 0;

  for (const [index, release] of releases.entries()) {
    const sourceHead = await headObject(source, release.download_key);
    const targetHead = await optionalHead(target, release.download_key);
    if (targetHead && sameObject(sourceHead, targetHead)) {
      skipped += 1;
      bytes += sourceHead.size;
      console.log(`[${index + 1}/${releases.length}] verified ${release.download_key}`);
      continue;
    }

    await copyObjectWithRetry(release.download_key, sourceHead);
    const copiedHead = await headObject(target, release.download_key);
    if (!sameObject(sourceHead, copiedHead)) throw new Error(`Verification failed for ${release.download_key}`);
    copied += 1;
    bytes += sourceHead.size;
    console.log(`[${index + 1}/${releases.length}] copied ${release.download_key} (${sourceHead.size} bytes)`);
  }

  console.log(JSON.stringify({ objects: releases.length, copied, skipped, verifiedBytes: bytes, verifiedGiB: gib(bytes) }, null, 2));
}

async function copyObjectWithRetry(key, sourceHead) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const object = await source.client.send(new GetObjectCommand({ Bucket: source.bucket, Key: key }));
      if (!object.Body) throw new Error(`R2 returned an empty body for ${key}`);
      await target.client.send(new PutObjectCommand({
        Bucket: target.bucket,
        Key: key,
        Body: object.Body,
        ContentLength: sourceHead.size,
        ContentType: object.ContentType || "application/octet-stream",
        CacheControl: object.CacheControl || "public, max-age=31536000, immutable",
      }));
      return;
    } catch (error) {
      const status = Number(error?.$metadata?.httpStatusCode || 0);
      const retryable = status >= 500 || error?.name === "TimeoutError" || error?.code === "ECONNRESET";
      if (!retryable || attempt === 4) throw error;
      const delay = attempt * 1500;
      console.warn(`temporary copy failure for ${key}; retry ${attempt}/3 in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function verifyAll() {
  requireStorage(source, "Cloudflare R2 source");
  requireStorage(target, "Backblaze B2 target");
  const releases = storedReleases();
  let bytes = 0;

  for (const [index, release] of releases.entries()) {
    const [sourceHead, targetHead] = await Promise.all([
      headObject(source, release.download_key),
      headObject(target, release.download_key),
    ]);
    if (!sameObject(sourceHead, targetHead)) throw new Error(`Source/target mismatch for ${release.download_key}`);
    bytes += sourceHead.size;
    console.log(`[${index + 1}/${releases.length}] verified ${release.download_key}`);
  }

  console.log(JSON.stringify({ objects: releases.length, verifiedBytes: bytes, verifiedGiB: gib(bytes) }, null, 2));
}

async function cutover() {
  if (!confirmed) throw new Error("Cutover changes live download URLs. Run again with --yes after copy and verification.");
  requireStorage(source, "Cloudflare R2 source");
  requireStorage(target, "Backblaze B2 target");
  await verifyAll();

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupPath = `${databasePath}.pre-b2-${timestamp}`;
  await backup(db, backupPath);

  const releases = storedReleases();
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare("UPDATE releases SET download_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND download_key = ?");
    for (const release of releases) {
      const result = update.run(`b2://${target.bucket}/${release.download_key}`, release.id, release.download_key);
      if (result.changes !== 1) throw new Error(`Release ${release.id} changed during cutover`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({ cutover: true, releases: releases.length, backupPath, sourceObjectsDeleted: 0 }, null, 2));
}

function allReleases() {
  return db.prepare("SELECT id, artist, title, download_url, download_key FROM releases ORDER BY id").all();
}

function storedReleases() {
  return db.prepare("SELECT id, artist, title, download_url, download_key FROM releases WHERE download_key <> '' ORDER BY id").all();
}

function r2Config(env) {
  const accountId = clean(env.R2_ACCOUNT_ID);
  const accessKeyId = clean(env.R2_ACCESS_KEY_ID);
  const secretAccessKey = clean(env.R2_SECRET_ACCESS_KEY);
  const bucket = clean(env.R2_BUCKET);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

function b2Config(env) {
  const region = clean(env.B2_REGION);
  const endpoint = clean(env.B2_ENDPOINT).replace(/\/$/, "") || (region ? `https://s3.${region}.backblazeb2.com` : "");
  const accessKeyId = clean(env.B2_KEY_ID);
  const secretAccessKey = clean(env.B2_APPLICATION_KEY);
  const bucket = clean(env.B2_BUCKET);
  if (!region || !endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    bucket,
    client: new S3Client({ region, endpoint, credentials: { accessKeyId, secretAccessKey } }),
  };
}

async function headObject(storage, key) {
  const result = await storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }));
  return { size: Number(result.ContentLength || 0), etag: cleanEtag(result.ETag) };
}

async function optionalHead(storage, key) {
  try {
    return await headObject(storage, key);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return null;
    throw error;
  }
}

function sameObject(left, right) {
  return left.size === right.size && (!left.etag || !right.etag || left.etag === right.etag);
}

function requireStorage(storage, label) {
  if (!storage) throw new Error(`${label} credentials are incomplete`);
}

function objectUrl(publicUrl, key) {
  return `${publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function clean(value) { return String(value || "").trim(); }
function cleanEtag(value) { return clean(value).replace(/^"|"$/g, "").toLowerCase(); }
function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function gib(bytes) { return Number((bytes / 1024 ** 3).toFixed(3)); }
