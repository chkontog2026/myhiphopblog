import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import express from "express";
import multer from "multer";
import { discogsGreekAccentVariants, greeklishDiscogsSearchTerms, normalizeDiscogsSearchText } from "./discogs-lookup.mjs";
import { downloadContentDisposition, normalizeDownloadFilename } from "./download-filename.mjs";
import { googleAnalyticsHead, normalizeGoogleAnalyticsId } from "./google-analytics.mjs";
import { dateInTimeZone } from "./site-date.mjs";
import { combineTracklistDiscs, formatDiscogsTracklist, trackCount, tracklistEditorFields, tracklistGroups } from "./tracklist.mjs";
import { normalizeYouTubeUrl, youtubeEmbedUrl, youtubeVideoId } from "./youtube-embed.mjs";
import { normalizeSpotifyUrl, spotifyEmbedUrl, spotifyResource } from "./spotify-embed.mjs";
import { extractYouTubePublishedYear, parseYouTubeMetadata } from "./youtube-metadata.mjs";
import { parseProxyProbeOutput, parseProxyUrls, proxyIdentity, rankProxyUrls, sanitizeYouTubeError, youtubeAccessArgs, youtubeMp4Format, runYouTubeProxyAttempts, youtubeFailureCode, youtubeFailureMessage } from "./youtube-download.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const uploadDir = path.join(dataDir, "uploads");
const port = Number(process.env.PORT || 3020);
const host = process.env.HOST || "127.0.0.1";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const sessionSecret = process.env.SESSION_SECRET || "";
const siteUrl = (process.env.SITE_URL || "https://myhiphopblog.ypotitloi.gr").replace(/\/$/, "");
const siteTimeZone = process.env.SITE_TIME_ZONE || "Europe/Athens";
const googleAnalyticsId = normalizeGoogleAnalyticsId(process.env.GOOGLE_ANALYTICS_ID);
const b2Region = text(process.env.B2_REGION);
const b2Endpoint = text(process.env.B2_ENDPOINT).replace(/\/$/, "") || (b2Region ? `https://s3.${b2Region}.backblazeb2.com` : "");
const b2KeyId = text(process.env.B2_KEY_ID);
const b2ApplicationKey = text(process.env.B2_APPLICATION_KEY);
const b2Bucket = text(process.env.B2_BUCKET);
const b2Enabled = Boolean(b2Region && b2Endpoint && b2KeyId && b2ApplicationKey && b2Bucket);
const r2AccountId = text(process.env.R2_ACCOUNT_ID);
const r2AccessKeyId = text(process.env.R2_ACCESS_KEY_ID);
const r2SecretAccessKey = text(process.env.R2_SECRET_ACCESS_KEY);
const r2Bucket = text(process.env.R2_BUCKET);
const r2PublicUrl = text(process.env.R2_PUBLIC_URL).replace(/\/$/, "");
const r2Enabled = Boolean(r2AccountId && r2AccessKeyId && r2SecretAccessKey && r2Bucket && r2PublicUrl);
const discogsTokenFile = path.join(dataDir, "discogs-token");
let discogsTokenStatus = "unknown";
const youtubeProxyUrls = parseProxyUrls(process.env.WEBSHARE_PROXY_URLS);
const youtubeDownloaderPath = text(process.env.YOUTUBE_DOWNLOADER_PATH) || "yt-dlp";
const youtubeNodePath = text(process.env.YOUTUBE_NODE_PATH);
const youtubePotProviderHome = text(process.env.YOUTUBE_POT_PROVIDER_HOME);
const youtubeImportJobs = new Map();
const youtubeImportQueue = [];
const youtubeProxyHealthFile = path.join(dataDir, "youtube-proxy-health.json");
let youtubeProxyHealth = readYouTubeProxyHealth();
let youtubeImportRunning = false;
let youtubeProxyRefreshPromise = null;
const objectStorage = b2Enabled ? {
  provider: "Backblaze B2",
  bucket: b2Bucket,
  signedDownloads: true,
  client: new S3Client({
    region: b2Region,
    endpoint: b2Endpoint,
    credentials: { accessKeyId: b2KeyId, secretAccessKey: b2ApplicationKey },
  }),
} : r2Enabled ? {
  provider: "Cloudflare R2",
  bucket: r2Bucket,
  publicUrl: r2PublicUrl,
  signedDownloads: false,
  client: new S3Client({
    region: "auto",
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey },
  }),
} : null;

if (adminPassword.length < 11 || sessionSecret.length < 32) {
  throw new Error("ADMIN_PASSWORD (11+ chars) and SESSION_SECRET (32+ chars) are required.");
}

fs.mkdirSync(uploadDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "blog.sqlite"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    blog_title TEXT NOT NULL,
    tagline TEXT NOT NULL,
    header_color TEXT NOT NULL,
    header_image_url TEXT NOT NULL,
    about_title TEXT NOT NULL,
    about_text TEXT NOT NULL,
    categories_title TEXT NOT NULL,
    archive_title TEXT NOT NULL,
    links_title TEXT NOT NULL,
    home_label TEXT NOT NULL,
    releases_label TEXT NOT NULL,
    about_label TEXT NOT NULL,
    contact_label TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    instagram_url TEXT NOT NULL,
    soundcloud_url TEXT NOT NULL,
    footer_text TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS releases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    publish_date TEXT NOT NULL,
    release_date TEXT NOT NULL DEFAULT '',
    genre TEXT NOT NULL,
    format TEXT NOT NULL,
    description TEXT NOT NULL,
    youtube_url TEXT NOT NULL DEFAULT '',
    spotify_url TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL,
    download_url TEXT NOT NULL,
    download_key TEXT NOT NULL DEFAULT '',
    download_name TEXT NOT NULL,
    download_enabled INTEGER NOT NULL DEFAULT 1,
    download_count INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    title TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS page_views (
    view_date TEXT PRIMARY KEY,
    views INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS page_view_visitors (
    ip_hash TEXT PRIMARY KEY,
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS release_download_visitors (
    release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    ip_hash TEXT NOT NULL,
    first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (release_id, ip_hash)
  );
  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS releases_date_idx ON releases (publish_date DESC, position ASC);
  CREATE INDEX IF NOT EXISTS tracks_release_idx ON tracks (release_id, position ASC);
`);
if (!db.prepare("PRAGMA table_info(releases)").all().some((column) => column.name === "download_key")) {
  db.exec("ALTER TABLE releases ADD COLUMN download_key TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare("PRAGMA table_info(releases)").all().some((column) => column.name === "release_date")) {
  db.exec("ALTER TABLE releases ADD COLUMN release_date TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare("PRAGMA table_info(releases)").all().some((column) => column.name === "download_count")) {
  db.exec("ALTER TABLE releases ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0");
}
if (!db.prepare("PRAGMA table_info(releases)").all().some((column) => column.name === "download_enabled")) {
  db.exec("ALTER TABLE releases ADD COLUMN download_enabled INTEGER NOT NULL DEFAULT 1");
}
if (!db.prepare("PRAGMA table_info(releases)").all().some((column) => column.name === "youtube_url")) {
  db.exec("ALTER TABLE releases ADD COLUMN youtube_url TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare("PRAGMA table_info(releases)").all().some((column) => column.name === "spotify_url")) {
  db.exec("ALTER TABLE releases ADD COLUMN spotify_url TEXT NOT NULL DEFAULT ''");
}

seedDatabase();

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://www.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; frame-src https://www.youtube-nocookie.com https://open.spotify.com; form-action 'self'; base-uri 'self'; frame-ancestors 'self'");
  next();
});
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.get("/og.png", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(root, "public", "og.png"));
});
app.use(express.static(path.join(root, "public"), { maxAge: "1h", etag: true }));
app.use("/uploads", express.static(uploadDir, { maxAge: "30d", immutable: true }));

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${safeExtension(normalizeDownloadFilename(file.originalname))}`),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024, files: 2 } });
const uploadFields = upload.fields([
  { name: "cover", maxCount: 1 },
  { name: "download_file", maxCount: 1 },
  { name: "header_image", maxCount: 1 },
]);

const loginAttempts = new Map();
const pageViewIntentCookie = "page_view_intent";
const pageViewIntentMaxAgeMs = 15 * 60_000;
const downloadIntentAttempts = new Map();
const downloadIntentCookie = "download_intent";
const downloadIntentMaxAgeMs = 15 * 60_000;
const downloadIntentRateWindowMs = 10 * 60_000;
const downloadIntentRateLimit = 20;

app.get("/", (req, res) => {
  issuePageViewIntent(req, res);
  res.send(renderBlog(text(req.query.newsletter)));
});
const legacyPostSlugRedirects = new Map([
  ["good-morning-america-full-broadcast-wednesday-july-22-2026-mu76hzlb", "clokworx-time-in-this-career-mu76hzlb"],
]);
app.get("/posts/:slug", (req, res) => {
  const requestedSlug = text(req.params.slug);
  const redirectSlug = legacyPostSlugRedirects.get(requestedSlug);
  if (redirectSlug) {
    const target = getReleases().find((item) => item.slug === redirectSlug);
    if (target) return res.redirect(301, `/posts/${encodeURIComponent(target.slug)}#${encodeURIComponent(target.slug)}`);
  }
  const release = getReleases().find((item) => item.slug === requestedSlug);
  if (!release) return res.status(404).send("Not found");
  issuePageViewIntent(req, res);
  return res.send(renderBlog("", null, release));
});
app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/analytics/page-view", (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (
    text(req.get("x-page-view-intent")) !== "1"
    || !shouldCountPageView(req)
    || !isSameSitePageViewIntent(req)
    || !validPageViewIntent(req)
  ) return res.sendStatus(204);
  recordUniquePageView(req);
  res.clearCookie(pageViewIntentCookie, { path: "/" });
  return res.sendStatus(204);
});
app.post("/newsletter", (req, res) => {
  const email = text(req.body.email).toLowerCase();
  if (text(req.body.website)) return res.redirect(303, "/?newsletter=success#newsletter");
  if (!isValidEmail(email)) return res.redirect(303, "/?newsletter=invalid#newsletter");
  const result = db.prepare("INSERT OR IGNORE INTO newsletter_subscribers (email) VALUES (?)").run(email);
  return res.redirect(303, `/?newsletter=${result.changes ? "success" : "existing"}#newsletter`);
});
app.post("/downloads/:id/intent", (req, res) => {
  const id = Number(req.params.id);
  const available = Number.isSafeInteger(id) && id > 0
    ? db.prepare("SELECT 1 FROM releases WHERE id = ? AND published = 1 AND download_enabled = 1 AND (download_url <> '' OR youtube_url <> '')").get(id)
    : null;
  if (!available) return res.status(404).send("Not found");
  if (!shouldCountPageView(req) || !isSameSiteDownloadIntent(req)) return res.status(403).send("Download unavailable");
  if (!allowDownloadIntent(req)) return res.status(429).send(renderDownloadConfirmation({ id }, "Πολλά αιτήματα λήψης. Δοκίμασε ξανά σε λίγα λεπτά."));
  res.cookie(downloadIntentCookie, signDownloadIntent(id, req), {
    httpOnly: true,
    secure: siteUrl.startsWith("https://"),
    sameSite: "lax",
    maxAge: downloadIntentMaxAgeMs,
    path: "/downloads",
  });
  return res.redirect(303, `/downloads/${id}`);
});
app.head("/downloads/:id", (req, res) => {
  const id = Number(req.params.id);
  const available = Number.isSafeInteger(id) && id > 0
    ? db.prepare("SELECT 1 FROM releases WHERE id = ? AND published = 1 AND download_enabled = 1 AND (download_url <> '' OR youtube_url <> '')").get(id)
    : null;
  return available ? res.sendStatus(204) : res.sendStatus(404);
});
app.get("/downloads/:id", async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send("Not found");
  const release = db.prepare("SELECT id, artist, title, youtube_url, download_url, download_key, download_name FROM releases WHERE id = ? AND published = 1 AND download_enabled = 1").get(id);
  if (!release) return res.status(404).send("Not found");
  if (!shouldCountPageView(req) || !validDownloadIntent(id, req)) {
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(renderDownloadConfirmation(release));
  }
  if (!release.download_url) {
    const youtubeUrl = normalizeYouTubeUrl(release.youtube_url);
    if (!youtubeUrl || !youtubeProxyUrls.length) return res.status(503).send("Το Download δεν είναι προσωρινά διαθέσιμο.");
    let currentJobEntry = [...youtubeImportJobs.entries()].find(([, job]) => job.releaseId === id);
    if (["failed", "cancelled"].includes(currentJobEntry?.[1].status) && req.query.retry === "1") {
      youtubeImportJobs.delete(currentJobEntry[0]);
      currentJobEntry = null;
    }
    if (currentJobEntry) {
      res.setHeader("Cache-Control", "no-store");
      if (currentJobEntry[1].status === "failed") return res.status(502).send(renderDownloadFailure(release, currentJobEntry[1].failureCode));
      if (currentJobEntry[1].status === "cancelled") return res.status(409).send(renderDownloadCancelled(release));
      const controls = youtubeCancelControls(req, currentJobEntry[0], currentJobEntry[1]);
      return res.status(202).send(renderDownloadPreparation(release, currentJobEntry[1].message, currentJobEntry[1], controls));
    }
    const { jobId, job } = enqueueYouTubeImport(release, youtubeUrl, { req, res, message: "Η προετοιμασία του MP4 ξεκινά…" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(202).send(renderDownloadPreparation(release, job.message, job, youtubeCancelControls(req, jobId, job, job.ownerToken)));
  }

  const localMatch = release.download_url.match(/^\/download\/([^/?#]+)$/);
  if (localMatch) {
    const name = path.basename(decodeURIComponent(localMatch[1]));
    const filePath = path.join(uploadDir, name);
    if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
    recordUniqueDownload(id, req);
    return res.download(filePath, normalizeDownloadFilename(release.download_name || name));
  }

  if (release.download_key && objectStorage?.signedDownloads) {
    recordUniqueDownload(id, req);
    const signedUrl = await getSignedUrl(objectStorage.client, new GetObjectCommand({
      Bucket: objectStorage.bucket,
      Key: release.download_key,
      ResponseContentDisposition: downloadContentDisposition(normalizeDownloadFilename(release.download_name)),
    }), { expiresIn: 15 * 60 });
    res.setHeader("Cache-Control", "private, no-store");
    return res.redirect(302, signedUrl);
  }

  if (!/^https?:\/\//i.test(release.download_url)) return res.status(404).send("Not found");
  recordUniqueDownload(id, req);

  const correctedName = normalizeDownloadFilename(release.download_name);
  const hasLegacyMojibake = correctedName !== release.download_name;
  const isStoredObjectDownload = release.download_key && objectStorage?.publicUrl && release.download_url.startsWith(`${objectStorage.publicUrl}/`);
  if (hasLegacyMojibake && isStoredObjectDownload) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let upstream;
      try {
        upstream = await fetch(release.download_url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!upstream.ok || !upstream.body) return res.status(502).send("Download temporarily unavailable");
      for (const header of ["content-type", "content-length", "etag", "last-modified"]) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader("Content-Disposition", downloadContentDisposition(correctedName));
      res.setHeader("Cache-Control", "private, no-store");
      return Readable.fromWeb(upstream.body).on("error", next).pipe(res);
    } catch (error) {
      return next(error);
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, release.download_url);
});

app.post("/downloads/jobs/:jobId/cancel", (req, res) => {
  const job = youtubeImportJobs.get(req.params.jobId);
  if (!job || !youtubeJobOwnedBy(req, job) || !safeEqual(text(req.body.cancel_token), job.cancelToken)) {
    return res.status(403).send("Η ακύρωση δεν επιτρέπεται.");
  }
  const release = db.prepare("SELECT id, artist, title FROM releases WHERE id = ?").get(job.releaseId);
  cancelYouTubeImport(job);
  res.setHeader("Cache-Control", "no-store");
  return res.send(renderDownloadCancelled(release));
});

// Keep previously shared local download URLs working without counting them twice.
app.get("/download/:name", (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(uploadDir, name);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  const release = db.prepare("SELECT download_name FROM releases WHERE download_url = ? AND published = 1 AND download_enabled = 1").get(`/download/${name}`);
  if (!release) return res.status(404).send("Not found");
  return res.download(filePath, normalizeDownloadFilename(release.download_name || name));
});

app.get("/admin/login", (req, res) => {
  if (isAdmin(req)) return res.redirect("/admin");
  res.send(renderLogin());
});
app.post("/admin/login", (req, res) => {
  const ip = req.ip || "unknown";
  const attempts = (loginAttempts.get(ip) || []).filter((time) => Date.now() - time < 15 * 60_000);
  if (attempts.length >= 5) return res.status(429).send(renderLogin("Πολλές προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά."));
  if (!safeEqual(String(req.body.password || ""), adminPassword)) {
    attempts.push(Date.now());
    loginAttempts.set(ip, attempts);
    return res.status(401).send(renderLogin("Λάθος κωδικός."));
  }
  loginAttempts.delete(ip);
  const expires = Date.now() + 12 * 60 * 60_000;
  const value = signSession(expires);
  res.cookie("nd_session", value, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 12 * 60 * 60_000, path: "/" });
  res.redirect("/admin");
});
app.get("/admin/logout", (_req, res) => {
  res.clearCookie("nd_session", { path: "/" });
  res.redirect("/admin/login");
});

app.use("/admin", (req, res, next) => {
  if (req.path === "/login") return next();
  if (!isAdmin(req)) return res.redirect("/admin/login");
  next();
});

app.get("/admin", (req, res) => res.send(renderAdmin(req)));
app.post("/admin/releases/preview", uploadFields, (req, res, next) => {
  const previewFiles = Object.values(req.files || {}).flat();
  try {
    if (!validCsrf(req)) return res.status(403).send("Invalid request");
    const id = Number(req.body.id || 0);
    const existing = id ? getReleases(true).find((release) => release.id === id) : null;
    if (id && !existing) return res.status(404).send("Post not found");
    const coverFile = req.files?.cover?.[0];
    if (coverFile && !isImage(coverFile)) return res.status(400).send("Το εξώφυλλο δεν είναι έγκυρη εικόνα.");
    const rawYouTubeUrl = text(req.body.youtube_url);
    const youtubeUrl = normalizeYouTubeUrl(rawYouTubeUrl);
    if (rawYouTubeUrl && !youtubeUrl) return res.status(400).send("Το YouTube URL δεν είναι έγκυρο link βίντεο.");
    const rawSpotifyUrl = text(req.body.spotify_url);
    const spotifyUrl = normalizeSpotifyUrl(rawSpotifyUrl);
    if (rawSpotifyUrl && !spotifyUrl) return res.status(400).send("Το Spotify URL δεν είναι έγκυρο link track, album, playlist, artist, show ή episode.");
    const artist = text(req.body.artist);
    const title = text(req.body.title);
    const publishDate = text(req.body.publish_date) || dateInTimeZone(new Date(), siteTimeZone);
    if (!artist || !title || !publishDate) return res.status(400).send("Artist, title and date are required");
    const coverUrl = req.body.remove_cover === "1" ? ""
      : coverFile ? `data:${coverFile.mimetype};base64,${fs.readFileSync(coverFile.path).toString("base64")}`
        : text(req.body.cover_url) || existing?.cover_url || "";
    const previewRelease = {
      ...existing,
      id: existing?.id || 0,
      slug: existing?.slug || "preview-release",
      artist,
      title,
      publish_date: publishDate,
      release_date: releaseYear(req.body.release_date),
      genre: text(req.body.genre) || "Hip Hop",
      format: text(req.body.format) || "MP3",
      description: text(req.body.description),
      youtube_url: youtubeUrl,
      spotify_url: spotifyUrl,
      cover_url: coverUrl,
      download_url: req.body.remove_download === "1" ? "" : text(req.body.download_url) || existing?.download_url || "",
      download_enabled: req.body.download_enabled === "1" ? 1 : 0,
      download_count: Number(existing?.download_count || 0),
      position: Number(req.body.position || 0),
      published: Number(existing?.published || 0),
      tracks: combineTracklistDiscs(req.body.tracks, req.body.has_second_disc === "1" ? req.body.tracks_disc_2 : "", req.body.disc_1_label, req.body.disc_2_label),
    };
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(renderBlog("", previewRelease));
  } catch (error) {
    next(error);
  } finally {
    previewFiles.forEach((file) => { try { fs.unlinkSync(file.path); } catch {} });
  }
});

app.get("/admin/newsletter.csv", (_req, res) => {
  const rows = db.prepare("SELECT email, subscribed_at FROM newsletter_subscribers ORDER BY subscribed_at DESC, id DESC").all();
  const csv = ["email,subscribed_at", ...rows.map((row) => `${csvCell(row.email)},${csvCell(row.subscribed_at)}`)].join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="newsletter-subscribers.csv"');
  res.send(`\uFEFF${csv}\r\n`);
});

app.get("/admin/youtube/metadata", async (req, res) => {
  const youtubeUrl = normalizeYouTubeUrl(text(req.query.url));
  if (!youtubeUrl) return res.status(400).json({ error: "Το YouTube URL δεν είναι έγκυρο link βίντεο." });

  try {
    const oembedUrl = new URL("https://www.youtube.com/oembed");
    oembedUrl.searchParams.set("url", youtubeUrl);
    oembedUrl.searchParams.set("format", "json");
    const [oembedResponse, pageResponse] = await Promise.all([
      fetch(oembedUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) }),
      fetch(youtubeUrl, { headers: { "Accept-Language": "en-US,en;q=0.8", "User-Agent": `MyHipHopBlog/1.0 +${siteUrl}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null),
    ]);
    if (!oembedResponse.ok) return res.status(404).json({ error: "Το YouTube video δεν βρέθηκε ή δεν είναι δημόσιο." });
    const metadata = await oembedResponse.json();
    const pageHtml = pageResponse?.ok ? await pageResponse.text() : "";
    return res.json(parseYouTubeMetadata(metadata.title, metadata.author_name, extractYouTubePublishedYear(pageHtml)));
  } catch (error) {
    console.warn("YouTube metadata lookup failed", error instanceof Error ? error.message : error);
    return res.status(502).json({ error: "Το YouTube δεν απάντησε. Δοκίμασε ξανά σε λίγο." });
  }
});

app.post("/admin/youtube/import", (req, res) => {
  if (!validCsrf(req)) return res.status(403).json({ error: "Μη έγκυρο αίτημα." });
  if (!youtubeProxyUrls.length) return res.status(503).json({ error: "Δεν έχουν ρυθμιστεί ακόμη τα Webshare proxies." });
  const id = Number(req.body.id || 0);
  const release = Number.isSafeInteger(id) && id > 0
    ? db.prepare("SELECT id, artist, title, youtube_url, download_url, download_key FROM releases WHERE id = ?").get(id)
    : null;
  if (!release) return res.status(404).json({ error: "Αποθήκευσε πρώτα την ανάρτηση." });
  const youtubeUrl = normalizeYouTubeUrl(release.youtube_url);
  if (!youtubeUrl) return res.status(400).json({ error: "Η ανάρτηση δεν έχει έγκυρο YouTube URL." });
  const { jobId } = enqueueYouTubeImport(release, youtubeUrl, { req, res, message: "Η λήψη ξεκινά…" });
  return res.status(202).json({ jobId });
});

app.get("/admin/youtube/import/:jobId", (req, res) => {
  const job = youtubeImportJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Η εργασία δεν βρέθηκε." });
  return res.json({ status: job.status, message: job.message, quality: job.quality, progressCurrent: job.progressCurrent, progressTotal: job.progressTotal });
});


app.post("/admin/settings", uploadFields, (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("Invalid request");
  const settings = getSettings();
  const headerFile = req.files?.header_image?.[0];
  if (headerFile && !isImage(headerFile)) return invalidUpload(res, headerFile, "Η εικόνα header δεν είναι έγκυρη.");
  const headerImageUrl = req.body.remove_header_image === "1" ? "" : (headerFile ? `/uploads/${headerFile.filename}` : settings.header_image_url);
  db.prepare(`UPDATE settings SET
    blog_title=?, tagline=?, header_color=?, header_image_url=?, about_title=?, about_text=?,
    categories_title=?, archive_title=?, links_title=?, home_label=?, releases_label=?, about_label=?,
    contact_label=?, contact_email=?, instagram_url=?, soundcloud_url=?, footer_text=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=1`).run(
      text(req.body.blog_title) || "MY HIP HOP BLOG", text(req.body.tagline), text(req.body.header_color) || "#4e5e4a", headerImageUrl,
      text(req.body.about_title), text(req.body.about_text), text(req.body.categories_title), text(req.body.archive_title),
      text(req.body.links_title), text(req.body.home_label), text(req.body.releases_label), text(req.body.about_label),
      text(req.body.contact_label), text(req.body.contact_email), text(req.body.instagram_url), text(req.body.soundcloud_url), text(req.body.footer_text),
    );
  res.redirect("/admin?ok=settings");
});

app.post("/admin/discogs/token", async (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("Invalid request");
  const token = text(req.body.discogs_token);
  if (token.length < 20 || token.length > 200) {
    return res.status(400).send(renderAdmin(req, "Το Discogs token δεν είναι έγκυρο."));
  }
  try {
    await discogsRequest("/oauth/identity", token);
    fs.writeFileSync(discogsTokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(discogsTokenFile, 0o600);
    discogsTokenStatus = "valid";
    return res.redirect("/admin?ok=discogs");
  } catch {
    return res.status(400).send(renderAdmin(req, "Το Discogs απέρριψε το token. Δημιούργησε ένα νέο και δοκίμασε ξανά."));
  }
});

app.post("/admin/discogs/tracklist", async (req, res) => {
  if (!validCsrf(req)) return res.status(403).json({ error: "Μη έγκυρο αίτημα." });
  const artist = text(req.body.artist);
  const title = text(req.body.title);
  const formYear = releaseYear(req.body.release_date);
  const token = getDiscogsToken();
  if (!token) return res.status(503).json({ error: "Πρώτα αποθήκευσε ένα Discogs token." });
  if (discogsTokenStatus === "invalid") return res.status(503).json({ error: "Το Discogs token δεν είναι έγκυρο. Αποθήκευσε νέο token." });
  if (!artist || !title) return res.status(400).json({ error: "Συμπλήρωσε πρώτα καλλιτέχνη και τίτλο." });

  try {
    const cleanTitle = normalizeDiscogsLookupTitle(title);
    const requestedYear = formYear || extractDiscogsLookupYear(title);
    const masterMatches = await searchDiscogsMatches("master", artist, cleanTitle, requestedYear, token);
    for (const candidate of masterMatches.slice(0, 3)) {
      try {
        const master = await discogsRequest(`/masters/${Number(candidate.id)}`, token);
        let tracks = formatDiscogsTracklist(master.tracklist);
        let coverUrl = primaryDiscogsImage(master.images);
        if ((!tracks.length || !coverUrl) && Number(master.main_release) > 0) {
          const mainRelease = await discogsRequest(`/releases/${Number(master.main_release)}`, token);
          if (!tracks.length) tracks = formatDiscogsTracklist(mainRelease.tracklist);
          if (!coverUrl) coverUrl = primaryDiscogsImage(mainRelease.images);
        }
        if (!tracks.length) continue;
        const masterArtist = Array.isArray(master.artists) ? master.artists.map((item) => text(item.name)).filter(Boolean).join(", ") : artist;
        return res.json({
          tracks,
          trackCount: trackCount(tracks),
          artist: masterArtist || artist,
          title: text(master.title) || cleanTitle,
          coverUrl,
          releaseDate: releaseYear(master.year || candidate.year || requestedYear),
          match: {
            title: `${masterArtist || artist} — ${master.title || title}`,
            year: releaseYear(master.year || candidate.year || requestedYear),
            url: `https://www.discogs.com/master/${Number(candidate.id)}`,
          },
        });
      } catch {}
    }

    const releaseMatches = await searchDiscogsMatches("release", artist, cleanTitle, requestedYear, token);
    const rankedMatches = [...releaseMatches].sort((a, b) => {
      const aYear = Number(releaseYear(a.year)) || 9999;
      const bYear = Number(releaseYear(b.year)) || 9999;
      return aYear - bYear;
    });
    for (const candidate of rankedMatches.slice(0, 5)) {
      try {
        const release = await discogsRequest(`/releases/${Number(candidate.id)}`, token);
        const tracks = formatDiscogsTracklist(release.tracklist);
        if (!tracks.length) continue;
        const year = releaseYear(release.released || release.year || candidate.year || requestedYear);
        return res.json({
          tracks,
          trackCount: trackCount(tracks),
          artist: text(release.artists_sort) || artist,
          title: text(release.title) || cleanTitle,
          coverUrl: primaryDiscogsImage(release.images),
          releaseDate: year,
          match: {
            title: `${release.artists_sort || artist} — ${release.title || title}`,
            year,
            url: `https://www.discogs.com/release/${Number(candidate.id)}`,
          },
        });
      } catch {}
    }
    if (!masterMatches.length && !releaseMatches.length) return res.status(404).json({ error: "Δεν βρέθηκε σχετική κυκλοφορία στο Discogs." });
    return res.status(404).json({ error: "Η κυκλοφορία βρέθηκε, αλλά δεν έχει tracklist." });
  } catch (error) {
    console.warn("Discogs lookup failed", error instanceof Error ? error.message : error);
    return res.status(502).json({ error: "Το Discogs δεν απάντησε. Δοκίμασε ξανά σε λίγο." });
  }
});

app.post("/admin/releases/save", uploadFields, async (req, res, next) => {
  try {
    if (!validCsrf(req)) return res.status(403).send("Invalid request");
    const id = Number(req.body.id || 0);
    const existing = id ? db.prepare("SELECT * FROM releases WHERE id=?").get(id) : null;
    if (id && !existing) return res.status(404).send("Post not found");
    const coverFile = req.files?.cover?.[0];
    const downloadFile = req.files?.download_file?.[0];
    if (coverFile && !isImage(coverFile)) return invalidUpload(res, coverFile, "Το εξώφυλλο δεν είναι έγκυρη εικόνα.");
    const externalCoverUrl = text(req.body.cover_url);
    const discogsCoverUrl = text(req.body.discogs_cover_url);
    let coverUrl = "";
    if (req.body.remove_cover !== "1") {
      if (coverFile) {
        coverUrl = `/uploads/${coverFile.filename}`;
      } else if (discogsCoverUrl && discogsCoverUrl === externalCoverUrl) {
        coverUrl = await storeDiscogsCover(discogsCoverUrl, getDiscogsToken());
      } else {
        coverUrl = externalCoverUrl || existing?.cover_url || "";
      }
    }
    let downloadUrl = existing?.download_url || "";
    let downloadKey = existing?.download_key || "";
    let downloadName = existing?.download_name || "";
    if (req.body.remove_download === "1") {
      downloadUrl = "";
      downloadKey = "";
      downloadName = "";
    } else if (downloadFile) {
      if (objectStorage) {
        const stored = await storeDownloadObject(downloadFile);
        downloadUrl = stored.url;
        downloadKey = stored.key;
      } else {
        downloadUrl = `/download/${downloadFile.filename}`;
        downloadKey = "";
      }
      downloadName = normalizeDownloadFilename(downloadFile.originalname);
    } else if (text(req.body.download_url)) {
      downloadUrl = text(req.body.download_url);
      if (downloadUrl !== existing?.download_url) {
        downloadKey = "";
        downloadName = "";
      }
    }
    const publishAction = text(req.body.publish_action);
    const published = publishAction === "publish" ? 1
      : publishAction === "save" ? Number(existing?.published || 0)
        : req.body.published === "1" ? 1 : 0;
    const rawYouTubeUrl = text(req.body.youtube_url);
    const youtubeUrl = normalizeYouTubeUrl(rawYouTubeUrl);
    if (rawYouTubeUrl && !youtubeUrl) return res.status(400).send("Το YouTube URL δεν είναι έγκυρο link βίντεο.");
    const rawSpotifyUrl = text(req.body.spotify_url);
    const spotifyUrl = normalizeSpotifyUrl(rawSpotifyUrl);
    if (rawSpotifyUrl && !spotifyUrl) return res.status(400).send("Το Spotify URL δεν είναι έγκυρο link track, album, playlist, artist, show ή episode.");
    const values = {
      artist: text(req.body.artist), title: text(req.body.title), publishDate: text(req.body.publish_date) || dateInTimeZone(new Date(), siteTimeZone),
      releaseDate: releaseYear(req.body.release_date),
      genre: text(req.body.genre) || "Hip Hop", format: text(req.body.format) || "MP3", description: text(req.body.description),
      youtubeUrl, spotifyUrl, coverUrl, downloadUrl, downloadKey, downloadName, downloadEnabled: req.body.download_enabled === "1" ? 1 : 0,
      position: Number(req.body.position || 0), published,
    };
    if (!values.artist || !values.title || !values.publishDate) return res.status(400).send("Artist, title and date are required");

    const save = () => transaction(() => {
      let releaseId = id;
      if (id) {
        db.prepare(`UPDATE releases SET artist=?,title=?,publish_date=?,release_date=?,genre=?,format=?,description=?,youtube_url=?,spotify_url=?,cover_url=?,download_url=?,download_key=?,download_name=?,download_enabled=?,position=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(values.artist, values.title, values.publishDate, values.releaseDate, values.genre, values.format, values.description, values.youtubeUrl, values.spotifyUrl, values.coverUrl, values.downloadUrl, values.downloadKey, values.downloadName, values.downloadEnabled, values.position, values.published, id);
      } else {
        const result = db.prepare(`INSERT INTO releases (slug,artist,title,publish_date,release_date,genre,format,description,youtube_url,spotify_url,cover_url,download_url,download_key,download_name,download_enabled,position,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(makeSlug(values.artist, values.title), values.artist, values.title, values.publishDate, values.releaseDate, values.genre, values.format, values.description, values.youtubeUrl, values.spotifyUrl, values.coverUrl, values.downloadUrl, values.downloadKey, values.downloadName, values.downloadEnabled, values.position, values.published);
        releaseId = Number(result.lastInsertRowid);
      }
      db.prepare("DELETE FROM tracks WHERE release_id=?").run(releaseId);
      const insertTrack = db.prepare("INSERT INTO tracks (release_id,position,title) VALUES (?,?,?)");
      combineTracklistDiscs(req.body.tracks, req.body.has_second_disc === "1" ? req.body.tracks_disc_2 : "", req.body.disc_1_label, req.body.disc_2_label)
        .forEach((track, index) => insertTrack.run(releaseId, index, track));
      return releaseId;
    });
    const releaseId = save();
    if (existing?.download_key && existing.download_key !== values.downloadKey) await removeDownloadObject(existing.download_key);
    if (publishAction === "publish" && values.published && values.downloadEnabled && values.youtubeUrl && !values.downloadUrl) {
      const release = db.prepare("SELECT id, artist, title, youtube_url, download_url, download_key FROM releases WHERE id = ?").get(releaseId);
      enqueueYouTubeImport(release, values.youtubeUrl, { message: "Αυτόματη προετοιμασία μετά τη δημοσίευση…" });
    }
    const releaseIndex = getReleases(true).findIndex((release) => release.id === releaseId);
    const adminPage = releaseIndex >= 0 ? Math.floor(releaseIndex / 5) + 1 : Math.max(1, Number.parseInt(text(req.body.admin_page), 10) || 1);
    res.redirect(`/admin?ok=post&page=${adminPage}&edit=${releaseId}#release-actions-${releaseId}`);
  } catch (error) {
    next(error);
  }
});

app.post("/admin/releases/delete", async (req, res, next) => {
  try {
    if (!validCsrf(req)) return res.status(403).send("Invalid request");
    const id = Number(req.body.id || 0);
    const release = db.prepare("SELECT download_key FROM releases WHERE id=?").get(id);
    db.prepare("DELETE FROM releases WHERE id=?").run(id);
    if (release?.download_key) await removeDownloadObject(release.download_key);
    res.redirect("/admin?ok=deleted");
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError) return res.status(400).send("Το αρχείο είναι πολύ μεγάλο ή μη έγκυρο.");
  res.status(500).send("Παρουσιάστηκε σφάλμα.");
});

app.listen(port, host, () => console.log(`myhiphopblog listening on http://${host}:${port}`));
void refreshDiscogsTokenStatus();
const initialProxyRefresh = setTimeout(() => { void refreshYouTubeProxyRanking(); }, 2_000);
initialProxyRefresh.unref();
const proxyRefreshInterval = setInterval(() => { void refreshYouTubeProxyRanking(); }, 6 * 60 * 60_000);
proxyRefreshInterval.unref();

function seedDatabase() {
  db.prepare(`INSERT OR IGNORE INTO settings (id,blog_title,tagline,header_color,header_image_url,about_title,about_text,categories_title,archive_title,links_title,home_label,releases_label,about_label,contact_label,contact_email,instagram_url,soundcloud_url,footer_text)
    VALUES (1,'MY HIP HOP BLOG','hip hop releases · mixtapes · downloads','#4e5e4a','/header-turntable.jpg','Σχετικά','Μικρό ανεξάρτητο blog για hip hop κυκλοφορίες, mixtapes και downloads.','Κατηγορίες','Αρχείο','Links','Αρχική','Κυκλοφορίες','Σχετικά','Επικοινωνία','hello@myhiphopblog.gr','','','Powered By Codex')`).run();
  db.prepare("UPDATE settings SET footer_text = ? WHERE id = 1 AND footer_text IN (?, ?)")
    .run("Powered By Codex", "MY HIP HOP BLOG · 2026", "NEEDLE / DROP · 2026");
  const total = db.prepare("SELECT COUNT(*) total FROM releases").get().total;
  if (total) return;
  const seeds = [
    ["after-midnight","Nefeli K.","After Midnight","2026-07-29","Electronic","EP · MP3 / FLAC · 128 MB","Τέσσερα κομμάτια με αναλογικά synths και νυχτερινά beats.","https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=85",["Night Drive","Neon Rain","No Signal","After Midnight"]],
    ["soft-static","Polaroid Days","Soft Static","2026-07-20","Indie","Album · MP3 · 92 MB","Lo-fi κιθάρες, ήσυχα φωνητικά και πέντε τραγούδια για το τέλος του καλοκαιριού.","https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=85",["Summer Ends","Half Awake","Soft Static","Stay a Little","Last Frame"]],
    ["blue-room","Low Tides","Blue Room Sessions","2026-07-10","Ambient","Live · FLAC · 174 MB","Ζωντανή ηχογράφηση, χωρίς edits. Ακουστικά ιδανικά μετά τα μεσάνυχτα.","https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=85",["Open Water","Blue Room","Slow Current","Dawn Tape"]],
  ];
  const addRelease = db.prepare("INSERT INTO releases (slug,artist,title,publish_date,genre,format,description,cover_url,download_url,download_name,position,published) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)");
  const addTrack = db.prepare("INSERT INTO tracks (release_id,position,title) VALUES (?,?,?)");
  const seed = () => transaction(() => seeds.forEach((item, index) => {
    const result = addRelease.run(...item.slice(0, 8), "", "", index);
    item[8].forEach((track, trackIndex) => addTrack.run(Number(result.lastInsertRowid), trackIndex, track));
  }));
  seed();
}

function getSettings() { return db.prepare("SELECT * FROM settings WHERE id=1").get(); }
function transaction(action) { db.exec("BEGIN IMMEDIATE"); try { const result = action(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function getReleases(includeDrafts = false) {
  const releases = db.prepare(`SELECT * FROM releases ${includeDrafts ? "" : "WHERE published=1"} ORDER BY publish_date DESC,position ASC,id DESC`).all();
  const getTracks = db.prepare("SELECT title FROM tracks WHERE release_id=? ORDER BY position,id");
  return releases.map((release) => ({ ...release, tracks: getTracks.all(release.id).map((row) => row.title) }));
}

function renderBlog(newsletterStatus = "", previewRelease = null, socialRelease = null) {
  const s = getSettings();
  const releases = previewRelease
    ? [...getReleases().filter((release) => release.id !== previewRelease.id), previewRelease]
      .sort((a, b) => b.publish_date.localeCompare(a.publish_date) || a.position - b.position || b.id - a.id)
    : getReleases();
  const months = [...new Set(releases.map((r) => r.publish_date.slice(0, 7)))].map((month) => ({ month, count: releases.filter((r) => r.publish_date.startsWith(month)).length }));
  const artistCounts = [...releases.reduce((counts, release) => {
    counts.set(release.artist, (counts.get(release.artist) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true }));
  const headerStyle = `background-color:${safeColor(s.header_color)};${s.header_image_url ? `background-image:linear-gradient(rgba(20,20,20,.25),rgba(20,20,20,.25)),url('${attr(s.header_image_url)}')` : ""}`;
  const posts = releases.map((r) => {
    const year = releaseYear(r.release_date);
    const videoUrl = youtubeEmbedUrl(r.youtube_url);
    const spotifyUrl = spotifyEmbedUrl(r.spotify_url);
    const spotifyType = spotifyResource(r.spotify_url)?.type || "Spotify";
    const hasReleaseDetails = Boolean(r.cover_url || r.tracks.length);
    const postPath = `/posts/${encodeURIComponent(r.slug)}`;
    const shareButton = `<button class="post-share" type="button" data-share-url="${attr(`${siteUrl}${postPath}#${encodeURIComponent(r.slug)}`)}" data-share-title="${attr(`${r.artist} — ${r.title}${year ? ` (${year})` : ""}`)}" aria-label="Κοινοποίηση ανάρτησης" title="Κοινοποίηση"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"></path></svg></button><span class="post-share-status" role="status" aria-live="polite"></span>`;
    const hasDownload = Boolean(videoUrl || r.download_url);
    const downloadControl = hasDownload
      ? `<form class="download-intent-form" method="post" action="/downloads/${r.id}/intent"><button class="download-link" type="submit">Download</button></form>`
      : `<a class="download-link" href="${attr(`mailto:${s.contact_email}?subject=Download — ${r.title}`)}">Download</a>`;
    const actionButtons = r.download_enabled ? `<div class="post-action-buttons">${downloadControl}${shareButton}</div>` : "";
    return `<article class="post${!hasReleaseDetails && (videoUrl || spotifyUrl) ? " video-only-post" : ""}" id="${attr(r.slug)}" data-artist="${attr(r.artist)}">
    <p class="post-date">${esc(formatDate(r.publish_date))}</p><h2>${esc(r.artist)} — ${esc(r.title)}${year ? ` (${esc(year)})` : ""}</h2>
    ${hasReleaseDetails ? `<div class="post-body">${r.cover_url ? `<a class="cover-zoom" href="${attr(r.cover_url)}" aria-label="Μεγέθυνση εξωφύλλου του ${attr(r.title)}"><img src="${attr(r.cover_url)}" alt="Εξώφυλλο του ${attr(r.title)}"></a>` : `<div class="cover-placeholder">Χωρίς εξώφυλλο</div>`}
      <div class="post-info"><p class="post-note">${esc(r.description)}</p><h3>Tracklist</h3>${renderTracklist(r.tracks)}</div></div>${videoUrl || spotifyUrl ? "" : actionButtons}` : r.description ? `<p class="post-note">${esc(r.description)}</p>` : ""}${videoUrl ? `<div class="post-video-block"><div class="post-video"><iframe src="${attr(videoUrl)}" title="${attr(`${r.artist} — ${r.title} στο YouTube`)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>${spotifyUrl ? "" : actionButtons}</div>` : ""}${spotifyUrl ? `<div class="post-spotify-block"><div class="post-spotify"><iframe src="${attr(spotifyUrl)}" title="${attr(`${r.artist} — ${r.title} στο Spotify (${spotifyType})`)}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe></div><a class="spotify-full-link" href="${attr(r.spotify_url)}" target="_blank" rel="noopener noreferrer">Άκουσε το ολόκληρο στο Spotify</a>${videoUrl ? "" : actionButtons}</div>` : ""}
    <footer class="post-footer"><span>Αναρτήθηκε από <b>${esc(s.blog_title)}</b></span></footer></article>`;
  }).join("");
  const previewBanner = previewRelease ? `<div class="preview-banner" role="status"><strong>Preview</strong><span>Η προεπισκόπηση δεν αλλάζει τη δημοσίευση.</span><a href="/admin?edit=${previewRelease.id || "new"}">Επιστροφή στην επεξεργασία</a></div>` : "";
  const previewHead = previewRelease ? `<style>.preview-banner{position:sticky;top:0;z-index:1000;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;border-bottom:1px solid #2f3c2d;background:#4e5e4a;color:#fff;font:14px/1.35 Arial,sans-serif}.preview-banner strong{font-size:15px}.preview-banner a{color:#fff;font-weight:700;text-decoration:underline}@media(max-width:600px){.preview-banner{flex-wrap:wrap;gap:5px 10px;padding:8px 10px;font-size:12px}}</style>` : "";
  const socialYear = socialRelease ? releaseYear(socialRelease.release_date) : "";
  const socialPostTitle = socialRelease ? `${socialRelease.artist} — ${socialRelease.title}${socialYear ? ` (${socialYear})` : ""}` : "";
  return page(socialRelease ? `${esc(socialPostTitle)} — ${esc(s.blog_title)}` : `${previewRelease ? "Preview — " : ""}${esc(s.blog_title)} — Music Blog`, `${previewBanner}<div class="blog-utility"><button class="theme-toggle" type="button" data-theme-toggle aria-label="Ενεργοποίηση φωτεινής εμφάνισης" aria-pressed="true"><span class="theme-toggle-icon" aria-hidden="true">☀</span><span data-theme-label>Light</span></button><a href="/admin">Διαχείριση</a></div><div class="page-shell" id="top"><header class="blog-header${s.header_image_url ? " has-image" : ""}" style="${headerStyle}"><h1><a href="/" aria-label="Αρχική"><img class="blog-title-logo" src="/my-hip-hop-blog-logo.png?v=1" alt="${attr(s.blog_title)}"></a></h1><p>${esc(s.tagline)}</p></header>
    <div class="content-layout"><main class="posts" id="releases">${posts || `<p class="empty-blog">Δεν υπάρχουν ακόμη αναρτήσεις.</p>`}</main><aside class="sidebar">
      <section class="post-search" role="search"><h2>Αναζήτηση</h2><label for="post-search-input">Αναζήτηση στις αναρτήσεις</label><div class="post-search-field"><input id="post-search-input" type="search" placeholder="Καλλιτέχνης, τίτλος, κομμάτι…" autocomplete="off" aria-controls="releases"><button type="button" data-search-clear aria-label="Καθαρισμός αναζήτησης" title="Καθαρισμός">×</button></div><p class="post-search-count" data-search-count aria-live="polite"></p></section>
      ${renderNewsletter(newsletterStatus)}
      <section class="contact-sidebar"><h2>Επικοινωνία</h2><p><span>E-Mail:</span><a href="mailto:myhiphopblog2026@gmail.com">myhiphopblog2026@gmail.com</a></p></section>
      <section><h2>${esc(s.archive_title)}</h2><ul>${months.map((m) => `<li><a href="#releases">${esc(formatMonth(m.month))} (${m.count})</a></li>`).join("")}</ul></section>
      <section class="artist-sidebar" aria-label="Καλλιτέχνες"><h2>Καλλιτέχνες</h2><ul><li><button type="button" class="active" data-artist-filter="" aria-pressed="true">Όλοι (${releases.length})</button></li>${artistCounts.map(([artist, count]) => `<li><button type="button" data-artist-filter="${attr(artist)}" aria-pressed="false">${esc(artist)} (${count})</button></li>`).join("")}</ul></section>
    </aside></div><footer class="site-footer">${renderFooterText(s.footer_text)}</footer></div>
    <dialog class="cover-lightbox" aria-label="Μεγεθυμένο εξώφυλλο"><div class="cover-lightbox-frame"><img src="" alt=""></div></dialog>`, s, `${previewHead}<link rel="stylesheet" href="/cover-lightbox.css?v=3"><link rel="stylesheet" href="/artist-sidebar.css?v=2"><link rel="stylesheet" href="/post-pagination.css?v=1"><link rel="stylesheet" href="/post-search.css?v=1"><link rel="stylesheet" href="/tracklist.css?v=9"><link rel="stylesheet" href="/post-share.css?v=4"><link rel="stylesheet" href="/newsletter.css?v=1"><link rel="stylesheet" href="/theme.css?v=6"><script src="/theme-toggle.js?v=2"></script><script src="/cover-lightbox.js?v=2" defer></script><script src="/post-pagination.js?v=6" defer></script><script src="/post-share.js?v=1" defer></script>${previewRelease ? "" : '<script src="/view-counter.js?v=1" defer></script>'}`, socialRelease ? {
      type: "article",
      url: `${siteUrl}/posts/${encodeURIComponent(socialRelease.slug)}`,
      title: socialPostTitle,
      description: socialRelease.description,
      image: socialRelease.cover_url,
      imageAlt: `Εξώφυλλο του ${socialRelease.title}`,
    } : null, !previewRelease);
}

function renderNewsletter(status) {
  const messages = {
    success: ["success", "Η εγγραφή ολοκληρώθηκε!"],
    existing: ["success", "Είσαι ήδη στη λίστα μας."],
    invalid: ["error", "Γράψε μια έγκυρη διεύθυνση email."],
  };
  const message = messages[status];
  return `<section class="newsletter" id="newsletter"><h2>Newsletter</h2><p>Εγγράψου στο Newsletter, για να λαμβάνεις ειδοποιήσεις.</p><form method="post" action="/newsletter"><label class="newsletter-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label class="newsletter-honeypot" for="newsletter-email">Email</label><div class="newsletter-fields"><input id="newsletter-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="e-mail" required><button type="submit">Εγγραφή</button></div>${message ? `<p class="newsletter-status ${message[0]}" role="status">${message[1]}</p>` : ""}</form></section>`;
}

function renderLogin(error = "") {
  return page("Σύνδεση — MY HIP HOP BLOG", `<main class="login-box"><p class="admin-kicker">MY HIP HOP BLOG</p><h1>Διαχείριση</h1>${error ? `<p class="form-error">${esc(error)}</p>` : ""}<form method="post" action="/admin/login"><label>Κωδικός<input type="password" name="password" autocomplete="current-password" required autofocus></label><button class="primary" type="submit">Σύνδεση</button></form><a href="/">← Επιστροφή στο blog</a></main>`);
}

function renderDownloadPreparation(release, message, progress = null, cancelControls = null) {
  const retryUrl = `/downloads/${release.id}`;
  const current = Math.max(0, Number(progress?.progressCurrent) || 0);
  const total = Math.max(0, Number(progress?.progressTotal) || 0);
  const hasProgress = total > 0;
  const percent = hasProgress ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const progressLabel = hasProgress ? `Έλεγχος σύνδεσης ${Math.min(current, total)} από ${total}` : "Η προετοιμασία βρίσκεται σε εξέλιξη";
  const progressBar = `<div class="download-progress${hasProgress ? "" : " is-indeterminate"}" role="progressbar" aria-label="Πρόοδος προετοιμασίας MP4" aria-valuemin="0" aria-valuemax="100"${hasProgress ? ` aria-valuenow="${percent}"` : ""}><span${hasProgress ? ` style="width:${percent}%"` : ""}></span></div><p class="download-progress-label">${esc(progressLabel)}</p>`;
  const cancelForm = cancelControls ? `<form class="download-cancel-form" method="post" action="/downloads/jobs/${attr(cancelControls.jobId)}/cancel"><input type="hidden" name="cancel_token" value="${attr(cancelControls.cancelToken)}"><button type="submit">Ακύρωση λήψης</button></form>` : "";
  return page("Προετοιμασία Download — MY HIP HOP BLOG", `<main class="login-box download-preparation"><p class="admin-kicker">MY HIP HOP BLOG</p><h1>Προετοιμασία MP4</h1><p><b>${esc(release.artist)} — ${esc(release.title)}</b></p><p>${esc(message)}</p>${progressBar}<p>Η λήψη θα ξεκινήσει αυτόματα μόλις ετοιμαστεί.</p><div class="download-preparation-actions"><a href="${retryUrl}">Έλεγχος τώρα</a>${cancelForm}</div></main>`, null, `<meta http-equiv="refresh" content="5;url=${retryUrl}"><style>.download-preparation{text-align:center}.download-preparation p{line-height:1.55}.download-progress{height:12px;margin:18px 0 6px;overflow:hidden;border:1px solid #c9c6bd;border-radius:999px;background:#eceae4}.download-progress span{display:block;height:100%;border-radius:inherit;background:#71806c;transition:width .35s ease}.download-progress-label{margin:0;color:#5f655d;font-size:.9rem}.download-progress.is-indeterminate span{width:38%;animation:download-progress 1.35s ease-in-out infinite}.download-preparation-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:12px;margin-top:8px}.download-cancel-form{margin:0}.download-cancel-form button{padding:8px 13px;border:1px solid #a65e59;border-radius:4px;background:#fff;color:#8e3f39;font:inherit;cursor:pointer}.download-cancel-form button:hover{background:#f8e9e7}@keyframes download-progress{0%{transform:translateX(-110%)}100%{transform:translateX(290%)}}@media (prefers-reduced-motion:reduce){.download-progress span{transition:none}.download-progress.is-indeterminate span{animation:none;width:100%;opacity:.55}}</style>`);
}

function renderDownloadConfirmation(release, message = "Πάτησε το κουμπί για να ξεκινήσει η λήψη.") {
  const releaseTitle = release.artist && release.title ? `<p><b>${esc(release.artist)} — ${esc(release.title)}</b></p>` : "";
  return page("Download — MY HIP HOP BLOG", `<main class="login-box download-confirmation"><p class="admin-kicker">MY HIP HOP BLOG</p><h1>Επιβεβαίωση Download</h1>${releaseTitle}<p>${esc(message)}</p><form method="post" action="/downloads/${Number(release.id)}/intent"><button class="primary" type="submit">Συνέχεια στο Download</button></form><a href="/">← Επιστροφή στο blog</a></main>`, null, `<style>.download-confirmation{text-align:center}.download-confirmation p{line-height:1.55}.download-confirmation form{margin:20px 0 14px}</style>`);
}

function renderDownloadFailure(release, failureCode) {
  const retryUrl = `/downloads/${release.id}?retry=1`;
  return page("Download μη διαθέσιμο — MY HIP HOP BLOG", `<main class="login-box download-preparation"><p class="admin-kicker">MY HIP HOP BLOG</p><h1>Το MP4 δεν ετοιμάστηκε</h1><p><b>${esc(release.artist)} — ${esc(release.title)}</b></p><p>${esc(youtubeFailureMessage(failureCode))}</p><a href="${retryUrl}">Νέα προσπάθεια</a></main>`, null, `<style>.download-preparation{text-align:center}.download-preparation p{line-height:1.55}</style>`);
}

function renderDownloadCancelled(release) {
  const retryUrl = `/downloads/${release.id}?retry=1`;
  return page("Η λήψη ακυρώθηκε — MY HIP HOP BLOG", `<main class="login-box download-preparation"><p class="admin-kicker">MY HIP HOP BLOG</p><h1>Η λήψη ακυρώθηκε</h1><p><b>${esc(release.artist)} — ${esc(release.title)}</b></p><p>Η δημιουργία του MP4 σταμάτησε.</p><a href="${retryUrl}">Νέα προσπάθεια</a> · <a href="/">Επιστροφή στο blog</a></main>`, null, `<style>.download-preparation{text-align:center}.download-preparation p{line-height:1.55}</style>`);
}

function renderAdmin(req, error = "") {
  const s = getSettings();
  const releases = getReleases(true);
  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(releases.length / pageSize));
  const requestedPage = Number.parseInt(text(req.query.page), 10) || 1;
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const pageReleases = releases.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalViews = getTotalPageViews();
  const newsletterSubscribers = Number(db.prepare("SELECT COUNT(*) AS total FROM newsletter_subscribers").get().total) || 0;
  const csrf = csrfToken(req);
  const status = req.query.ok && req.query.ok !== "post" ? `<p class="success">Οι αλλαγές αποθηκεύτηκαν.</p>` : "";
  const adminError = error ? `<p class="form-error">${esc(error)}</p>` : "";
  const discogsStatusLabel = discogsTokenStatus === "valid"
    ? "ενεργό"
    : discogsTokenStatus === "invalid"
      ? "μη έγκυρο token"
      : "επαλήθευση σε εξέλιξη";
  const discogsReady = discogsTokenStatus === "valid";
  const pagination = totalPages > 1 ? `<nav class="admin-pagination" aria-label="Σελίδες αναρτήσεων">
    ${currentPage > 1 ? `<a href="/admin?page=${currentPage - 1}">← Προηγούμενη</a>` : `<span class="disabled">← Προηγούμενη</span>`}
    <span>Σελίδα ${currentPage} από ${totalPages}</span>
    ${currentPage < totalPages ? `<a href="/admin?page=${currentPage + 1}">Επόμενη →</a>` : `<span class="disabled">Επόμενη →</span>`}
  </nav>` : "";
  return page("Διαχείριση — MY HIP HOP BLOG", `<main class="admin-shell"><header class="admin-header"><div><p>MY HIP HOP BLOG</p><h1>Διαχείριση blog</h1></div><nav><a href="/" target="_blank">Προβολή blog ↗</a><a href="/admin/logout">Αποσύνδεση</a></nav></header>${status}${adminError}
    <section class="admin-stats" aria-label="Στατιστικά"><div class="admin-stat"><span>Συνολικές προβολές</span><strong>${new Intl.NumberFormat("el-GR").format(totalViews)}</strong></div><div class="admin-stat"><span>Newsletter</span><strong>${new Intl.NumberFormat("el-GR").format(newsletterSubscribers)}</strong><a href="/admin/newsletter.csv">Λήψη CSV</a></div></section>
    <section class="admin-card playlist-metadata-tool" data-playlist-metadata data-csrf="${attr(csrf)}" data-discogs-enabled="${discogsReady ? "1" : "0"}"><h2>Ανάλυση Playlist MP3</h2><p>Επίλεξε τον φάκελο της playlist. Θα διαβαστούν αυτόματα όλα τα MP3 που περιέχει και τα ID3 metadata θα επιστραφούν στα ελληνικά — τα αρχεία δεν ανεβαίνουν στον server.</p><div class="playlist-metadata-controls"><label>Φάκελος playlist<input type="file" accept="audio/mpeg,.mp3" webkitdirectory directory multiple data-playlist-files></label><button class="primary" type="button" data-playlist-analyze>Ανάλυση playlist</button><button type="button" data-playlist-copy disabled>Αντιγραφή αποτελεσμάτων</button><button type="button" data-playlist-save disabled>Αποθήκευση διορθωμένων MP3</button></div><p class="playlist-metadata-status" data-playlist-status role="status" aria-live="polite"></p><div class="playlist-results-wrap" hidden><table class="playlist-results"><thead><tr><th>Όνομα</th><th>Τίτλος</th><th>Καλλιτέχνες που συμμετέχουν</th><th>Άλμπουμ</th></tr></thead><tbody data-playlist-results></tbody></table></div></section>
    <details class="admin-card"${req.query.edit === "new" ? " open" : ""}><summary>+ Νέα ανάρτηση</summary>${releaseForm(null, csrf, 1)}</details>
    <div class="admin-settings-grid"><details class="admin-card"><summary>Discogs — ${discogsStatusLabel}</summary><form class="discogs-token-form" method="post" action="/admin/discogs/token"><input type="hidden" name="csrf" value="${csrf}"><label>Νέο προσωπικό API token<input type="password" name="discogs_token" autocomplete="new-password" required placeholder="Επικόλληση νέου token"></label><small>Το token αποθηκεύεται ιδιωτικά στον VPS και δεν εμφανίζεται ξανά.</small><button class="primary" type="submit">Αποθήκευση Discogs token</button></form></details>
    <details class="admin-card"><summary>Κείμενα &amp; header</summary><form method="post" action="/admin/settings" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${csrf}">
      <div class="form-grid"><label>Τίτλος blog<input name="blog_title" value="${attr(s.blog_title)}" required></label><label>Υπότιτλος<input name="tagline" value="${attr(s.tagline)}"></label><label>Χρώμα header<input type="color" name="header_color" value="${attr(s.header_color)}"></label><label>Φωτογραφία header<input type="file" name="header_image" accept="image/*"></label></div>${s.header_image_url ? `<label class="check"><input type="checkbox" name="remove_header_image" value="1"> Αφαίρεση φωτογραφίας header</label>` : ""}
      <div class="form-grid"><label>Τίτλος «Σχετικά»<input name="about_title" value="${attr(s.about_title)}"></label><label>Τίτλος κατηγοριών<input name="categories_title" value="${attr(s.categories_title)}"></label><label>Τίτλος αρχείου<input name="archive_title" value="${attr(s.archive_title)}"></label><label>Τίτλος links<input name="links_title" value="${attr(s.links_title)}"></label></div><label>Κείμενο «Σχετικά»<textarea name="about_text" rows="4">${esc(s.about_text)}</textarea></label>
      <div class="form-grid four"><label>Αρχική<input name="home_label" value="${attr(s.home_label)}"></label><label>Κυκλοφορίες<input name="releases_label" value="${attr(s.releases_label)}"></label><label>Σχετικά<input name="about_label" value="${attr(s.about_label)}"></label><label>Επικοινωνία<input name="contact_label" value="${attr(s.contact_label)}"></label></div>
      <div class="form-grid"><label>Email<input type="email" name="contact_email" value="${attr(s.contact_email)}"></label><label>Instagram URL<input type="url" name="instagram_url" value="${attr(s.instagram_url)}"></label><label>SoundCloud URL<input type="url" name="soundcloud_url" value="${attr(s.soundcloud_url)}"></label><label>Footer<input name="footer_text" value="${attr(s.footer_text)}"></label></div><button class="primary" type="submit">Αποθήκευση ρυθμίσεων</button></form></details></div>
    <h2 class="list-title">Αναρτήσεις (${releases.length})</h2>${pageReleases.map((r) => { const listCover = r.cover_url || youtubeThumbnailUrl(r.youtube_url); return `<details id="release-${r.id}" class="admin-card release-row"${Number(req.query.edit) === r.id ? " open" : ""}><summary>${listCover ? `<img src="${attr(listCover)}" alt="">` : ""}<span><b>${esc(r.artist)} — ${esc(r.title)}</b><small>${esc(r.publish_date)} · ${esc(r.genre)} · ${r.published ? "Δημοσιευμένη" : "Πρόχειρο"} · ${formatDownloadCount(r.download_count)}</small></span><button class="release-delete-button" type="button" data-delete-form="delete-release-${r.id}" aria-label="Διαγραφή της ανάρτησης ${attr(`${r.artist} — ${r.title}`)}">Διαγραφή</button></summary>${releaseForm(r, csrf, currentPage)}<form id="delete-release-${r.id}" class="delete-form" method="post" action="/admin/releases/delete" hidden><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${r.id}"></form></details>`; }).join("")}${pagination}</main>`, null, `<link rel="stylesheet" href="/admin-progress.css?v=3"><link rel="stylesheet" href="/admin-discogs.css?v=18"><link rel="stylesheet" href="/admin-stats.css?v=1"><link rel="stylesheet" href="/admin-pagination.css?v=1"><link rel="stylesheet" href="/playlist-metadata.css?v=2"><script src="/admin-upload.js?v=8" defer></script><script src="/admin-discogs.js?v=8" defer></script><script type="module" src="/tracklist-paste.mjs?v=1"></script><script type="module" src="/playlist-metadata.mjs?v=2"></script><script src="/admin-youtube.js?v=3" defer></script>`);
}

function releaseForm(r, csrf, adminPage = 1) {
  const trackFields = tracklistEditorFields(r?.tracks || []);
  const hasSecondDisc = Boolean(trackFields.disc2);
  const coverExternal = r?.cover_url?.startsWith("http") ? r.cover_url : "";
  const downloadExternal = r?.download_url?.startsWith("http") ? r.download_url : "";
  const formScope = `release-form-${r?.id || "new"}`;
  return `<form class="release-form" method="post" action="/admin/releases/save" enctype="multipart/form-data" data-has-cover="${r?.cover_url ? "1" : "0"}"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="id" value="${r?.id || ""}"><input type="hidden" name="admin_page" value="${adminPage}"><input type="hidden" name="discogs_cover_url" value="">
    <nav class="release-form-nav" aria-label="Γρήγορη μετάβαση και ενέργειες φόρμας"><div class="release-form-nav-links"><span>Μετάβαση:</span><a href="#${formScope}-basics">Βασικά</a><a href="#${formScope}-media">Discogs &amp; εξώφυλλο</a><a href="#${formScope}-tracks">Tracklist</a><a href="#${formScope}-content">Περιγραφή</a><a href="#${formScope}-extras">Προαιρετικά</a></div><div class="release-form-nav-actions"><button class="release-preview" type="submit" formaction="/admin/releases/preview" formtarget="_blank">Preview</button><button class="release-save" type="submit" name="publish_action" value="save">Αποθήκευση Ανάρτησης</button><button class="primary release-publish" type="submit" name="publish_action" value="publish">Δημοσίευση</button></div></nav>
    <div id="${formScope}-basics" class="release-editor-top release-anchor"><section class="release-primary-upload"><div class="release-card-heading"><span class="release-step">1</span><div><strong>Αρχείο μουσικής</strong><small>Επίλεξέ το πρώτο για αυτόματη αναγνώριση.</small></div></div><label>Μουσική / ZIP (έως 500 MB)${objectStorage ? ` — ${objectStorage.provider}` : ""}<input type="file" name="download_file" accept="audio/*,.zip,.rar,.7z,.flac"></label><label class="youtube-download-enabled"><input type="checkbox" name="download_enabled" value="1" ${!r || r.download_enabled ? "checked" : ""}> Ενεργό Download στο post</label><details class="release-optional"${downloadExternal ? " open" : ""}><summary>Εναλλακτικό download URL</summary><label>Download URL<input type="url" name="download_url" value="${attr(downloadExternal)}"></label></details></section><section class="release-essential-card"><div class="release-card-heading"><span class="release-step">2</span><div><strong>Βασικά στοιχεία</strong><small>Καλλιτέχνης, τίτλος και χρονολογία.</small></div></div><div class="form-grid"><label>Καλλιτέχνης<input name="artist" value="${attr(r?.artist || "")}" required></label><label>Τίτλος<input name="title" value="${attr(r?.title || "")}" required></label><label>Χρονολογία κυκλοφορίας<input type="number" name="release_date" min="1900" max="2099" step="1" placeholder="π.χ. 1999" value="${attr(releaseYear(r?.release_date))}"></label><label>Ημερομηνία ανάρτησης<input type="date" name="publish_date" value="${attr(r?.publish_date || dateInTimeZone(new Date(), siteTimeZone))}" required></label></div></section></div>
    <div id="${formScope}-media" class="release-media-grid release-anchor"><div class="release-discogs-panel"><div class="release-card-heading"><span class="release-step">3</span><div><strong>Συμπλήρωση από Discogs</strong><small>Στοιχεία, εξώφυλλο και αριθμημένο tracklist.</small></div></div><button class="discogs-fetch" type="button" ${getDiscogsToken() ? "" : "disabled"}>Εύρεση στο Discogs</button><span class="discogs-message" role="status" aria-live="polite"></span></div><section class="release-content-card release-cover-card"><div class="release-card-heading"><span class="release-step">4</span><div><strong>Εξώφυλλο</strong><small>Ανέβασε εικόνα ή χρησιμοποίησε URL εξωφύλλου.</small></div></div><div class="form-grid uploads"><label>Αρχείο εικόνας<input type="file" name="cover" accept="image/*"></label><label>ή URL εξωφύλλου<input type="url" name="cover_url" value="${attr(coverExternal)}"></label></div></section></div>
    <section id="${formScope}-tracks" class="release-tracklist-editor release-anchor"><div class="release-card-heading"><span class="release-step">5</span><div><strong>Tracklist</strong><small>Επικόλλησε λίστα από Discogs και πάτησε «Κράτησε μόνο τίτλους».</small></div></div><div class="disc-editor disc-editor-primary"><div class="disc-editor-heading"><strong>CD 1</strong><label>Προαιρετικός τίτλος<input name="disc_1_label" value="${attr(trackFields.disc1Label)}" placeholder="π.χ. L'album Original"></label></div><div class="tracklist-paste-tools"><button type="button" data-clean-tracklist>Κράτησε μόνο τίτλους</button><span data-tracklist-clean-message role="status" aria-live="polite"></span></div><textarea name="tracks" rows="7" aria-label="Tracklist CD 1">${esc(trackFields.disc1)}</textarea></div><label class="second-disc-toggle"><input type="checkbox" name="has_second_disc" value="1" ${hasSecondDisc ? "checked" : ""}> Ο δίσκος έχει και 2ο CD</label><div class="disc-editor disc-editor-secondary" ${hasSecondDisc ? "" : "hidden"}><div class="disc-editor-heading"><strong>CD 2</strong><label>Προαιρετικός τίτλος<input name="disc_2_label" value="${attr(trackFields.disc2Label)}" placeholder="π.χ. L'album Instrumental"></label></div><div class="tracklist-paste-tools"><button type="button" data-clean-tracklist>Κράτησε μόνο τίτλους</button><span data-tracklist-clean-message role="status" aria-live="polite"></span></div><textarea name="tracks_disc_2" rows="7" aria-label="Tracklist CD 2">${esc(trackFields.disc2)}</textarea></div><small class="discogs-credit">Data provided by <a href="https://www.discogs.com" target="_blank" rel="noreferrer">Discogs</a>.</small></section>
    <div class="release-content-grid"><section id="${formScope}-content" class="release-content-card release-anchor"><div class="release-card-heading"><span class="release-step">6</span><div><strong>Περιγραφή &amp; links</strong><small>Προαιρετικό κείμενο, YouTube video και Spotify link της ανάρτησης.</small></div></div><label>Περιγραφή<textarea name="description" rows="4">${esc(r?.description || "")}</textarea></label><div class="youtube-url-row"><label>YouTube video URL<input type="url" name="youtube_url" value="${attr(r?.youtube_url || "")}" placeholder="https://www.youtube.com/watch?v=..."><small>Δέχεται κανονικό link, youtu.be, Short ή Live.</small></label></div><div class="youtube-url-row"><label>Spotify link<input type="url" name="spotify_url" value="${attr(r?.spotify_url || "")}" placeholder="https://open.spotify.com/track/..."><small>Track, album, playlist, artist, show ή episode.</small></label></div><small>Αν δεν υπάρχει ήδη αρχείο, το MP4 προετοιμάζεται αυτόματα στο background μόλις δημοσιευτεί η ανάρτηση.</small><div class="discogs-tools"><button class="youtube-fetch" type="button">Αυτόματη συμπλήρωση από YouTube</button><span class="youtube-message discogs-message" role="status" aria-live="polite"></span></div></section>
    <details id="${formScope}-extras" class="release-secondary-card release-anchor"><summary><strong>Προαιρετικές ρυθμίσεις</strong><small>Είδος, μορφή και σειρά εμφάνισης.</small></summary><div class="form-grid three"><label>Είδος<input name="genre" value="${attr(r?.genre || "Hip Hop")}"></label><label>Μορφή / μέγεθος<input name="format" value="${attr(r?.format || "MP3")}"></label><label>Σειρά<input type="number" name="position" value="${r?.position || 0}"></label></div></details></div>
    ${r ? `<div class="checks"><label><input type="checkbox" name="remove_cover" value="1"> Αφαίρεση εξωφύλλου</label><label><input type="checkbox" name="remove_download" value="1"> Αφαίρεση download</label></div>` : ""}<div class="release-actions"${r ? ` id="release-actions-${r.id}"` : ""}><button class="release-preview" type="submit" formaction="/admin/releases/preview" formtarget="_blank">Preview</button><button class="release-save" type="submit" name="publish_action" value="save">Αποθήκευση Ανάρτησης</button><button class="primary release-publish" type="submit" name="publish_action" value="publish">Δημοσίευση</button></div></form>`;
}

function page(title, body, settings = null, extraHead = "", social = null, analyticsEnabled = false) {
  const defaultDescription = "Hip hop releases, mixtapes, tracklists και downloads.";
  const defaultImage = `${siteUrl}/my-hip-hop-blog-preview-20260802.png`;
  const description = attr(text(social?.description) || defaultDescription);
  const socialImage = attr(absoluteSiteUrl(social?.image) || defaultImage);
  const socialTitle = attr(text(social?.title) || settings?.blog_title || "MY HIP HOP BLOG");
  const socialUrl = attr(text(social?.url) || `${siteUrl}/`);
  const socialType = social?.type === "article" ? "article" : "website";
  const socialImageAlt = attr(text(social?.imageAlt) || "MY HIP HOP BLOG");
  const defaultImageDetails = social?.image ? "" : '<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1730"><meta property="og:image:height" content="909">';
  if (analyticsEnabled) extraHead = `${googleAnalyticsHead(googleAnalyticsId)}${extraHead}`;
  return `<!doctype html><html lang="el" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${socialUrl}"><meta property="og:type" content="${socialType}"><meta property="og:site_name" content="${attr(settings?.blog_title || "MY HIP HOP BLOG")}"><meta property="og:url" content="${socialUrl}"><meta property="og:title" content="${socialTitle}"><meta property="og:description" content="${description}"><meta property="og:image" content="${socialImage}"><meta property="og:image:secure_url" content="${socialImage}">${defaultImageDetails}<meta property="og:image:alt" content="${socialImageAlt}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${socialTitle}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${socialImage}"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Sedgwick+Ave+Display&display=swap" rel="stylesheet"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/post-footer.css?v=7"><link rel="stylesheet" href="/blog-utility.css?v=2"><link rel="stylesheet" href="/graffiti-title.css?v=5"><link rel="stylesheet" href="/youtube-embed.css?v=1"><link rel="stylesheet" href="/spotify-embed.css?v=1">${extraHead}</head><body>${body}</body></html>`;
}

function absoluteSiteUrl(value) {
  const candidate = text(value);
  if (!candidate) return "";
  try { return new URL(candidate, `${siteUrl}/`).toString(); } catch { return ""; }
}

function isAdmin(req) {
  const cookie = parseCookies(req.headers.cookie || "").nd_session;
  if (!cookie) return false;
  const [expiresRaw, signature] = cookie.split(".");
  const expires = Number(expiresRaw);
  if (!expires || expires < Date.now() || !signature) return false;
  return safeEqual(signature, hmac(expiresRaw));
}
function signSession(expires) { return `${expires}.${hmac(String(expires))}`; }
function csrfToken(req) { const expires = parseCookies(req.headers.cookie || "").nd_session?.split(".")[0] || ""; return hmac(`csrf:${expires}`); }
function validCsrf(req) { return isAdmin(req) && safeEqual(String(req.body.csrf || ""), csrfToken(req)); }
function hmac(value) { return crypto.createHmac("sha256", sessionSecret).update(value).digest("hex"); }
function safeEqual(a, b) { const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function parseCookies(header) { return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || "")])); }
function requestIp(req) { return text(req.ip).replace(/^::ffff:/, ""); }
function issuePageViewIntent(req, res) {
  if (!shouldCountPageView(req) || !requestIp(req)) return;
  res.cookie(pageViewIntentCookie, signPageViewIntent(req), {
    httpOnly: true,
    secure: siteUrl.startsWith("https://"),
    sameSite: "lax",
    maxAge: pageViewIntentMaxAgeMs,
    path: "/",
  });
}
function isSameSitePageViewIntent(req) {
  if (text(req.get("sec-fetch-site")).toLowerCase() !== "same-origin") return false;
  const origin = text(req.get("origin"));
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(siteUrl).origin; } catch { return false; }
}
function signPageViewIntent(req) {
  const payload = Buffer.from(JSON.stringify({
    expires: Date.now() + pageViewIntentMaxAgeMs,
    ipHash: hmac(`page-view-intent-ip:${requestIp(req)}`),
    nonce: crypto.randomBytes(16).toString("base64url"),
  }), "utf8").toString("base64url");
  return `${payload}.${hmac(`page-view-intent:${payload}`)}`;
}
function validPageViewIntent(req) {
  const token = text(parseCookies(req.headers.cookie || "")[pageViewIntentCookie]);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, hmac(`page-view-intent:${payload}`))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(parsed.expires) >= Date.now()
      && Number(parsed.expires) <= Date.now() + pageViewIntentMaxAgeMs + 60_000
      && /^[A-Za-z0-9_-]{16,64}$/.test(text(parsed.nonce))
      && safeEqual(text(parsed.ipHash), hmac(`page-view-intent-ip:${requestIp(req)}`));
  } catch {
    return false;
  }
}
function isSameSiteDownloadIntent(req) {
  const fetchSite = text(req.get("sec-fetch-site")).toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = text(req.get("origin"));
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(siteUrl).origin; } catch { return false; }
}
function allowDownloadIntent(req) {
  const ip = requestIp(req);
  if (!ip) return false;
  const now = Date.now();
  const key = hmac(`download-intent-rate:${ip}`);
  const recent = (downloadIntentAttempts.get(key) || []).filter((time) => now - time < downloadIntentRateWindowMs);
  if (recent.length >= downloadIntentRateLimit) {
    downloadIntentAttempts.set(key, recent);
    return false;
  }
  recent.push(now);
  downloadIntentAttempts.set(key, recent);
  if (downloadIntentAttempts.size > 5_000) {
    for (const [candidate, times] of downloadIntentAttempts) {
      if (!times.some((time) => now - time < downloadIntentRateWindowMs)) downloadIntentAttempts.delete(candidate);
    }
  }
  return true;
}
function signDownloadIntent(releaseId, req) {
  const payload = Buffer.from(JSON.stringify({
    releaseId,
    expires: Date.now() + downloadIntentMaxAgeMs,
    ipHash: hmac(`download-intent-ip:${requestIp(req)}`),
    nonce: crypto.randomBytes(16).toString("base64url"),
  }), "utf8").toString("base64url");
  return `${payload}.${hmac(`download-intent:${payload}`)}`;
}
function validDownloadIntent(releaseId, req) {
  const token = text(parseCookies(req.headers.cookie || "")[downloadIntentCookie]);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, hmac(`download-intent:${payload}`))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(parsed.releaseId) === releaseId
      && Number(parsed.expires) >= Date.now()
      && Number(parsed.expires) <= Date.now() + downloadIntentMaxAgeMs + 60_000
      && /^[A-Za-z0-9_-]{16,64}$/.test(text(parsed.nonce))
      && safeEqual(text(parsed.ipHash), hmac(`download-intent-ip:${requestIp(req)}`));
  } catch {
    return false;
  }
}
function createYouTubeImportJob(releaseId, req, res, message) {
  let ownerToken = req ? text(parseCookies(req.headers.cookie || "").download_owner) : "";
  if (req && res && !/^[A-Za-z0-9_-]{32,128}$/.test(ownerToken)) {
    ownerToken = crypto.randomBytes(32).toString("base64url");
    res.cookie("download_owner", ownerToken, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 24 * 60 * 60_000, path: "/" });
  }
  return {
    releaseId,
    status: "pending",
    message,
    progressCurrent: 0,
    progressTotal: youtubeProxyUrls.length,
    ownerHash: ownerToken ? hmac(`youtube-owner:${ownerToken}`) : "",
    ownerToken,
    cancelToken: crypto.randomBytes(32).toString("base64url"),
    child: null,
    cancelled: false,
  };
}
function enqueueYouTubeImport(release, youtubeUrl, { req = null, res = null, message = "Η προετοιμασία του MP4 ξεκινά…" } = {}) {
  const existing = [...youtubeImportJobs.entries()].find(([, job]) => job.releaseId === release.id && ["pending", "running"].includes(job.status));
  if (existing) return { jobId: existing[0], job: existing[1], existing: true };
  const jobId = crypto.randomUUID();
  const queued = youtubeImportRunning || youtubeImportQueue.length > 0;
  const job = createYouTubeImportJob(release.id, req, res, queued ? "Η λήψη μπήκε σε σειρά προτεραιότητας…" : message);
  job.youtubeUrl = youtubeUrl;
  youtubeImportJobs.set(jobId, job);
  youtubeImportQueue.push(jobId);
  const rankingIsFresh = Object.values(youtubeProxyHealth).some((health) => Number(health?.lastProbeAt || 0) > Date.now() - 6 * 60 * 60_000);
  if (!rankingIsFresh) void refreshYouTubeProxyRanking();
  void pumpYouTubeImportQueue();
  return { jobId, job, existing: false };
}
async function pumpYouTubeImportQueue() {
  if (youtubeImportRunning) return;
  youtubeImportRunning = true;
  try {
    while (youtubeImportQueue.length) {
      const jobId = youtubeImportQueue.shift();
      const job = youtubeImportJobs.get(jobId);
      if (!job || job.status !== "pending") continue;
      const release = db.prepare("SELECT id, artist, title, youtube_url, download_url, download_key FROM releases WHERE id = ?").get(job.releaseId);
      const youtubeUrl = normalizeYouTubeUrl(release?.youtube_url || job.youtubeUrl);
      if (!release || release.download_url || !youtubeUrl) {
        job.status = release?.download_url ? "complete" : "failed";
        job.message = release?.download_url ? "Το Download είναι ήδη έτοιμο." : "Η ανάρτηση δεν είναι πλέον διαθέσιμη για λήψη.";
        continue;
      }
      job.message = "Επιλογή του ταχύτερου ευρωπαϊκού proxy…";
      if (youtubeProxyRefreshPromise) {
        await Promise.race([youtubeProxyRefreshPromise, new Promise((resolve) => setTimeout(resolve, 15_000))]);
      }
      await runYouTubeImport(jobId, release, youtubeUrl);
    }
  } finally {
    youtubeImportRunning = false;
    if (youtubeImportQueue.length) void pumpYouTubeImportQueue();
  }
}
function youtubeJobOwnedBy(req, job, ownerTokenOverride = "") {
  if (isAdmin(req)) return true;
  const ownerToken = ownerTokenOverride || text(parseCookies(req.headers.cookie || "").download_owner);
  return Boolean(ownerToken && job?.ownerHash && safeEqual(job.ownerHash, hmac(`youtube-owner:${ownerToken}`)));
}
function youtubeCancelControls(req, jobId, job, ownerTokenOverride = "") {
  if (!job?.cancelToken || !youtubeJobOwnedBy(req, job, ownerTokenOverride)) return null;
  return { jobId, cancelToken: job.cancelToken };
}
function renderTracklist(tracks) {
  const groups = tracklistGroups(tracks);
  const renderTitle = (track) => esc(track).replace(/\r?\n/g, "<br>");
  if (!groups.some((group) => group.label)) {
    return `<ol>${(groups[0]?.tracks || []).map((track) => `<li>${renderTitle(track)}</li>`).join("")}</ol>`;
  }
  return `<div class="disc-tracklist">${groups.map((group) => `<section>${group.label ? `<h4>${esc(group.label)}</h4>` : ""}<ol>${group.tracks.map((track) => `<li>${renderTitle(track)}</li>`).join("")}</ol></section>`).join("")}</div>`;
}
function releaseYear(value) {
  return text(value).match(/(?:19|20)\d{2}/)?.[0] || "";
}
function youtubeThumbnailUrl(value) {
  const id = youtubeVideoId(value);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}
function normalizeDiscogsLookupTitle(value) {
  return text(value)
    .replace(/\s*[([](?:19|20)\d{2}[)\]]\s*$/, "")
    .replace(/\s+(?:19|20)\d{2}\s*$/, "")
    .trim();
}
function extractDiscogsLookupYear(value) {
  const match = text(value).match(/(?:^|\D)((?:19|20)\d{2})(?:\D*$)/);
  return match?.[1] || "";
}
function getDiscogsToken() {
  const environmentToken = text(process.env.DISCOGS_TOKEN);
  if (environmentToken) return environmentToken;
  try { return text(fs.readFileSync(discogsTokenFile, "utf8")); } catch { return ""; }
}
async function discogsRequest(endpoint, token) {
  const response = await fetch(`https://api.discogs.com${endpoint}`, {
    headers: {
      Accept: "application/vnd.discogs.v2.discogs+json",
      Authorization: `Discogs token=${token}`,
      "User-Agent": `MyHipHopBlog/1.0 +${siteUrl}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401) discogsTokenStatus = "invalid";
  if (!response.ok) throw new Error(`Discogs HTTP ${response.status}`);
  if (endpoint === "/oauth/identity") discogsTokenStatus = "valid";
  return response.json();
}

async function refreshDiscogsTokenStatus() {
  const token = getDiscogsToken();
  if (!token) {
    discogsTokenStatus = "missing";
    return;
  }
  try {
    await discogsRequest("/oauth/identity", token);
  } catch {
    if (discogsTokenStatus !== "invalid") discogsTokenStatus = "unavailable";
  }
}
async function searchDiscogsMatches(type, artist, title, year, token) {
  const normalizedTitle = normalizeDiscogsSearchText(title);
  const titleTerms = [...new Set([normalizedTitle, ...greeklishDiscogsSearchTerms(title).map(normalizeDiscogsSearchText)])];
  const isTitleMatch = (item, candidateTerms = titleTerms) => {
    const candidate = normalizeDiscogsSearchText(item?.title);
    return Number(item?.id) > 0 && candidateTerms.some((term) => term && candidate.includes(term));
  };
  const exactQuery = new URLSearchParams({ type, artist, release_title: title, per_page: "10" });
  if (year) exactQuery.set("year", year);
  let search = await discogsRequest(`/database/search?${exactQuery}`, token);
  let matches = (Array.isArray(search.results) ? search.results : []).filter((item) => isTitleMatch(item));
  if (!matches.length) {
    const broadQuery = new URLSearchParams({ type, q: `${artist} ${title}`, per_page: "10" });
    if (year) broadQuery.set("year", year);
    search = await discogsRequest(`/database/search?${broadQuery}`, token);
    matches = (Array.isArray(search.results) ? search.results : []).filter((item) => isTitleMatch(item));
  }
  if (!matches.length) {
    const artistQuery = new URLSearchParams({ type, q: artist, per_page: "50" });
    search = await discogsRequest(`/database/search?${artistQuery}`, token);
    const titleMatches = (Array.isArray(search.results) ? search.results : [])
      .filter((item) => isTitleMatch(item));
    if (titleMatches.length) matches = titleMatches;
  }
  // Masters are optional. Avoid spending the Discogs rate limit on expensive
  // transliteration fallbacks; the release lookup below contains the tracklist.
  if (type === "master" && !matches.length) return [];
  if (!matches.length) {
    for (const term of greeklishDiscogsSearchTerms(title)) {
      const greekQuery = new URLSearchParams({ type, q: term, per_page: "20" });
      search = await discogsRequest(`/database/search?${greekQuery}`, token);
      matches = (Array.isArray(search.results) ? search.results : [])
        .filter((item) => isTitleMatch(item));
      if (matches.length) break;
    }
  }
  if (!matches.length) {
    const artistTerms = greeklishDiscogsSearchTerms(artist)
      .flatMap(discogsGreekAccentVariants)
      .filter((term) => term.length >= 4)
      .slice(0, 24);
    for (const term of artistTerms) {
      const artistQuery = new URLSearchParams({ type, q: term, per_page: "50" });
      search = await discogsRequest(`/database/search?${artistQuery}`, token);
      matches = (Array.isArray(search.results) ? search.results : []).filter((item) => isTitleMatch(item));
      if (matches.length) break;
    }
  }
  return matches;
}
function shouldCountPageView(req) {
  const userAgent = text(req.get("user-agent"));
  const purpose = `${text(req.get("purpose"))} ${text(req.get("sec-purpose"))}`;
  if (!userAgent || /bot|crawler|spider|slurp|facebookexternalhit|preview|monitor|uptime|curl|wget|powershell|codex/i.test(userAgent)) return false;
  return !/prefetch|prerender/i.test(purpose);
}
function recordUniquePageView(req) {
  const ip = text(req.ip).replace(/^::ffff:/, "");
  if (!ip) return;
  const ipHash = hmac(`page-view:${ip}`);
  db.prepare("INSERT OR IGNORE INTO page_view_visitors (ip_hash) VALUES (?)").run(ipHash);
}
function getTotalPageViews() {
  return Number(db.prepare("SELECT COUNT(*) AS total FROM page_view_visitors").get().total) || 0;
}
function recordUniqueDownload(releaseId, req) {
  const ip = text(req.ip).replace(/^::ffff:/, "");
  if (!ip) return;
  const ipHash = hmac(`release-download:${releaseId}:${ip}`);
  transaction(() => {
    const result = db.prepare("INSERT OR IGNORE INTO release_download_visitors (release_id, ip_hash) VALUES (?, ?)")
      .run(releaseId, ipHash);
    if (result.changes) {
      db.prepare("UPDATE releases SET download_count = download_count + 1 WHERE id = ?").run(releaseId);
    }
  });
}
function primaryDiscogsImage(images) {
  const available = Array.isArray(images) ? images : [];
  return text(available.find((image) => image?.type === "primary")?.uri || available[0]?.uri);
}
async function storeDiscogsCover(imageUrl, token) {
  const url = new URL(imageUrl);
  if (url.protocol !== "https:" || !["i.discogs.com", "api-img.discogs.com"].includes(url.hostname)) {
    throw new Error("Invalid Discogs image URL");
  }
  const headers = {
    Accept: "image/jpeg,image/png,image/webp,image/gif",
    "User-Agent": `MyHipHopBlog/1.0 +${siteUrl}`,
  };
  if (token) headers.Authorization = `Discogs token=${token}`;
  const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Discogs image HTTP ${response.status}`);
  const contentType = text(response.headers.get("content-type")).split(";")[0].toLowerCase();
  const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
  const extension = extensions[contentType];
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (!extension || declaredSize > 12 * 1024 * 1024) throw new Error("Invalid Discogs cover image");
  const image = Buffer.from(await response.arrayBuffer());
  if (!image.length || image.length > 12 * 1024 * 1024) throw new Error("Invalid Discogs cover image");
  const filename = `${crypto.randomUUID()}${extension}`;
  const temporaryPath = path.join(uploadDir, `${filename}.tmp`);
  fs.writeFileSync(temporaryPath, image, { mode: 0o644 });
  fs.renameSync(temporaryPath, path.join(uploadDir, filename));
  return `/uploads/${filename}`;
}
function makeSlug(artist, title) { const base = `${artist}-${title}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); return `${base || "release"}-${Date.now().toString(36)}`; }
function safeExtension(name) { return path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 9); }
function isValidEmail(value) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function isImage(file) { return file.size <= 12 * 1024 * 1024 && ["image/jpeg","image/png","image/webp","image/gif"].includes(file.mimetype); }
function invalidUpload(res, file, message) { try { fs.unlinkSync(file.path); } catch {} return res.status(400).send(message); }
async function storeDownloadObject(file) {
  const downloadName = normalizeDownloadFilename(file.originalname);
  const key = `downloads/${new Date().getUTCFullYear()}/${crypto.randomUUID()}${safeExtension(downloadName)}`;
  try {
    await objectStorage.client.send(new PutObjectCommand({
      Bucket: objectStorage.bucket,
      Key: key,
      Body: fs.createReadStream(file.path),
      ContentLength: file.size,
      ContentType: file.mimetype || "application/octet-stream",
      ContentDisposition: objectStorage.signedDownloads ? undefined : downloadContentDisposition(downloadName),
      CacheControl: "public, max-age=31536000, immutable",
    }));
  } finally {
    try { fs.unlinkSync(file.path); } catch {}
  }
  return { key, url: objectStorage.signedDownloads ? `b2://${objectStorage.bucket}/${key}` : objectUrl(objectStorage.publicUrl, key) };
}
function readYouTubeProxyHealth() {
  try {
    const parsed = JSON.parse(fs.readFileSync(youtubeProxyHealthFile, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function writeYouTubeProxyHealth() {
  try {
    const temporaryPath = `${youtubeProxyHealthFile}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(youtubeProxyHealth, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, youtubeProxyHealthFile);
  } catch (error) {
    console.warn("Unable to save YouTube proxy health", error instanceof Error ? error.message : error);
  }
}
function probeYouTubeProxy(proxyUrl) {
  return new Promise((resolve, reject) => {
    execFile("curl", [
      "--location", "--silent", "--show-error", "--fail",
      "--connect-timeout", "4", "--max-time", "8",
      "--proxy", proxyUrl,
      "--write-out", "\n__PROXY_TIME__:%{time_total}",
      "https://ipwho.is/",
    ], { timeout: 10_000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else {
        try { resolve(parseProxyProbeOutput(stdout)); } catch (parseError) { reject(parseError); }
      }
    });
  });
}
function refreshYouTubeProxyRanking() {
  if (!youtubeProxyUrls.length) return Promise.resolve();
  if (youtubeProxyRefreshPromise) return youtubeProxyRefreshPromise;
  youtubeProxyRefreshPromise = (async () => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(10, youtubeProxyUrls.length) }, async () => {
      while (cursor < youtubeProxyUrls.length) {
        const proxyUrl = youtubeProxyUrls[cursor++];
        const identity = proxyIdentity(proxyUrl);
        try {
          const probe = await probeYouTubeProxy(proxyUrl);
          youtubeProxyHealth[identity] = {
            ...youtubeProxyHealth[identity],
            ...probe,
            failures: Number(youtubeProxyHealth[identity]?.failures || 0),
            lastProbeAt: Date.now(),
          };
        } catch {
          youtubeProxyHealth[identity] = {
            ...youtubeProxyHealth[identity],
            probeFailures: Number(youtubeProxyHealth[identity]?.probeFailures || 0) + 1,
            lastProbeAt: Date.now(),
          };
        }
      }
    });
    await Promise.all(workers);
    writeYouTubeProxyHealth();
    const europeanCount = Object.values(youtubeProxyHealth).filter((health) => health?.isEuropean === true).length;
    console.log(`YouTube proxy ranking refreshed (${europeanCount} European exits available)`);
  })().finally(() => { youtubeProxyRefreshPromise = null; });
  return youtubeProxyRefreshPromise;
}
function recordYouTubeProxySuccess(proxyUrl, elapsedMs, size) {
  const identity = proxyIdentity(proxyUrl);
  const previous = youtubeProxyHealth[identity] || {};
  const previousAverage = Number(previous.averageDownloadMs || 0);
  const throughput = elapsedMs > 0 ? Math.round(size * 1000 / elapsedMs) : 0;
  const previousThroughput = Number(previous.throughputBytesPerSecond || 0);
  youtubeProxyHealth[identity] = {
    ...previous,
    averageDownloadMs: previousAverage ? Math.round(previousAverage * 0.65 + elapsedMs * 0.35) : elapsedMs,
    throughputBytesPerSecond: previousThroughput ? Math.round(previousThroughput * 0.65 + throughput * 0.35) : throughput,
    failures: 0,
    cooldownUntil: 0,
    lastSuccessAt: Date.now(),
  };
  writeYouTubeProxyHealth();
}
function recordYouTubeProxyFailure(proxyUrl, failureCode) {
  const identity = proxyIdentity(proxyUrl);
  const previous = youtubeProxyHealth[identity] || {};
  const failures = Number(previous.failures || 0) + 1;
  youtubeProxyHealth[identity] = {
    ...previous,
    failures,
    failureCode,
    cooldownUntil: Date.now() + (failureCode === "proxy-auth" ? 60 : Math.min(60, 5 * (2 ** Math.min(failures - 1, 4)))) * 60_000,
    lastFailureAt: Date.now(),
  };
  writeYouTubeProxyHealth();
}
async function runYouTubeImport(jobId, release, youtubeUrl) {
  const job = youtubeImportJobs.get(jobId);
  const temporaryDir = fs.mkdtempSync(path.join(uploadDir, ".youtube-import-"));
  let stored = null;
  try {
    job.status = "running";
    const downloaded = await runYouTubeProxyAttempts({
      proxyUrls: youtubeProxyUrls,
      health: youtubeProxyHealth,
      isCancelled: () => job.cancelled,
      onAttempt(current, total) {
        job.progressCurrent = current;
        job.progressTotal = total;
        job.message = "Έλεγχος σύνδεσης και προετοιμασία MP4…";
      },
      onFailure: recordYouTubeProxyFailure,
      async attempt(proxyUrl, timeout) {
        const startedAt = Date.now();
        try {
          // A country lookup alone does not validate HTTPS proxy authentication.
          const probe = await execFileForYouTubeJob(job, "curl", [
            "--silent", "--show-error", "--max-time", "8", "--proxy", proxyUrl,
            "--output", process.platform === "win32" ? "NUL" : "/dev/null",
            "--write-out", "%{http_connect} %{http_code}", "https://www.youtube.com/",
          ], { timeout: Math.min(10_000, timeout), maxBuffer: 16_384, windowsHide: true });
          if (!/^200 2\d\d$/.test(probe.stdout.trim())) throw new Error(`Proxy HTTPS check failed: ${probe.stdout.trim()}`);
          const remaining = timeout - (Date.now() - startedAt);
          if (remaining <= 0) throw new Error("DOWNLOAD_TIMEOUT");
          const { stdout } = await execFileForYouTubeJob(job, youtubeDownloaderPath, [
            ...youtubeAccessArgs({ proxyUrl, nodePath: youtubeNodePath, potProviderHome: youtubePotProviderHome }),
            "--no-playlist", "--no-progress", "--no-warnings",
            "--max-filesize", "500M", "--match-filter", "!is_live", "--socket-timeout", "10",
            "--retries", "1", "--extractor-retries", "0", "--fragment-retries", "1",
            "--concurrent-fragments", "4", "-f", youtubeMp4Format, "--merge-output-format", "mp4",
            "--print", "after_move:%(filepath)s\t%(height)s", "-o", path.join(temporaryDir, "video.%(ext)s"), youtubeUrl,
          ], { timeout: remaining, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
          const [downloadedPath, heightRaw] = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)?.split("\t") || [];
          const resolvedPath = path.resolve(downloadedPath || "");
          if (!resolvedPath.startsWith(path.resolve(temporaryDir) + path.sep) || !fs.existsSync(resolvedPath)) throw new Error("No output file");
          const size = fs.statSync(resolvedPath).size;
          if (!size || size > 500 * 1024 * 1024) throw new Error("File exceeds 500 MB");
          recordYouTubeProxySuccess(proxyUrl, Date.now() - startedAt, size);
          return { resolvedPath, size, height: Number(heightRaw) || 0 };
        } catch (error) {
          for (const file of fs.readdirSync(temporaryDir)) fs.rmSync(path.join(temporaryDir, file), { force: true });
          throw error;
        }
      },
    });
    if (job.cancelled) throw new Error("Download cancelled");
    job.message = "Το MP4 ετοιμάστηκε. Αποθήκευση αρχείου…";
    const name = normalizeDownloadFilename(`${release.artist} - ${release.title}.mp4`);
    stored = objectStorage
      ? { ...(await storeDownloadObject({ path: downloaded.resolvedPath, originalname: name, size: downloaded.size, mimetype: "video/mp4" })), name }
      : storeLocalYouTubeMp4(downloaded.resolvedPath, name);
    job.quality = downloaded.height ? `${downloaded.height}p` : "MP4";
    db.prepare("UPDATE releases SET download_url = ?, download_key = ?, download_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(stored.url, stored.key, stored.name, release.id);
    if (release.download_key && release.download_key !== stored.key) await removeDownloadObject(release.download_key);
    if (!release.download_key && release.download_url !== stored.url) removeLocalDownload(release.download_url);
    job.status = "complete";
    job.message = `Το Download είναι έτοιμο (${job.quality}).`;
  } catch (error) {
    if (job.cancelled) {
      job.status = "cancelled";
      job.message = "Η λήψη ακυρώθηκε.";
    } else {
      console.warn("YouTube import failed", sanitizeYouTubeError(error));
      job.status = "failed";
      job.failureCode = youtubeFailureCode(error);
      job.message = youtubeFailureMessage(job.failureCode);
    }
  } finally {
    job.child = null;
    fs.rmSync(temporaryDir, { recursive: true, force: true });
    setTimeout(() => youtubeImportJobs.delete(jobId), 60 * 60_000).unref();
  }
}
function execFileForYouTubeJob(job, executable, args, options) {
  return new Promise((resolve, reject) => {
    if (job.cancelled) return reject(new Error("Download cancelled"));
    let expired = false;
    const child = execFile(executable, args, { ...options, timeout: options.timeout + 2_000, detached: process.platform !== "win32" }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (job.child === child) job.child = null;
      if (expired) reject(new Error("DOWNLOAD_TIMEOUT"));
      else if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    const timer = setTimeout(() => {
      expired = true;
      terminateYouTubeProcess(child, "SIGKILL");
    }, options.timeout);
    timer.unref();
    job.child = child;
    if (job.cancelled) terminateYouTubeProcess(child, "SIGTERM");
  });
}
function cancelYouTubeImport(job) {
  if (!job || !["pending", "running"].includes(job.status)) return false;
  job.cancelled = true;
  job.status = "cancelled";
  job.message = "Η λήψη ακυρώθηκε.";
  const child = job.child;
  if (child) {
    terminateYouTubeProcess(child, "SIGTERM");
    const forceTimer = setTimeout(() => terminateYouTubeProcess(child, "SIGKILL"), 2_000);
    forceTimer.unref();
  }
  return true;
}
function terminateYouTubeProcess(child, signal) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch {}
  }
}
function storeLocalYouTubeMp4(sourcePath, name) {
  const filename = `${crypto.randomUUID()}.mp4`;
  fs.renameSync(sourcePath, path.join(uploadDir, filename));
  return { key: "", url: `/download/${filename}`, name };
}
function removeLocalDownload(downloadUrl) {
  if (!String(downloadUrl || "").startsWith("/download/")) return;
  const filename = path.basename(String(downloadUrl));
  const target = path.resolve(uploadDir, filename);
  if (path.dirname(target) !== path.resolve(uploadDir)) return;
  try { fs.rmSync(target, { force: true }); } catch (error) {
    console.warn("Unable to remove local download", filename, error);
  }
}
async function removeDownloadObject(key) {
  if (!objectStorage || !key) return;
  try {
    await objectStorage.client.send(new DeleteObjectCommand({ Bucket: objectStorage.bucket, Key: key }));
  } catch (error) {
    console.warn(`Unable to remove ${objectStorage.provider} object`, key, error);
  }
}
function objectUrl(publicUrl, key) { return `${publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`; }
function text(value) { return String(value || "").trim(); }
function renderFooterText(value) {
  return text(value) === "Powered By Codex"
    ? '<span class="powered-by-codex"><span class="powered-by-label">Powered By</span> <strong>Codex</strong></span>'
    : esc(value);
}
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char])); }
function attr(value) { return esc(value); }
function safeColor(value) { return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#4e5e4a"; }
function formatDate(value) {
  if (/^\d{4}$/.test(text(value))) return text(value);
  return new Intl.DateTimeFormat("el-GR", { weekday:"long", day:"numeric", month:"long", year:"numeric" }).format(new Date(`${value}T12:00:00`));
}
function formatMonth(value) { return new Intl.DateTimeFormat("el-GR", { month:"long", year:"numeric" }).format(new Date(`${value}-02T12:00:00`)); }
function formatDownloadCount(value) {
  const count = Number(value) || 0;
  return `${new Intl.NumberFormat("el-GR").format(count)} ${count === 1 ? "λήψη" : "λήψεις"}`;
}
