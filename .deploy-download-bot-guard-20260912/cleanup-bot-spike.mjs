import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.CLEANUP_DATABASE_PATH || "/opt/myhiphopblog/data/blog.sqlite";
const accessLogPath = process.env.CLEANUP_ACCESS_LOG_PATH || "/var/log/nginx/access.log";
const sessionSecret = process.env.SESSION_SECRET;
const startUtc = "2026-09-12 16:00:00";
const endUtc = "2026-09-12 17:00:00";

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required");
}

const botIps = new Set();
for (const line of fs.readFileSync(accessLogPath, "utf8").split("\n")) {
  if (!line.includes("[12/Sep/2026:16:") || !line.includes('"GET /downloads/')) continue;
  const [ip] = line.split(" ", 1);
  if (ip) botIps.add(ip);
}

if (botIps.size !== 4) {
  throw new Error(`Expected 4 documented bot sources, found ${botIps.size}`);
}

const botViewHashes = [...botIps].map((ip) =>
  crypto.createHmac("sha256", sessionSecret).update(`page-view:${ip}`).digest("hex")
);

const db = new DatabaseSync(databasePath);
const countDownloads = db.prepare(
  "SELECT COUNT(*) AS count FROM release_download_visitors WHERE first_seen >= ? AND first_seen < ?"
);
const countViews = db.prepare(
  "SELECT COUNT(*) AS count FROM page_view_visitors WHERE first_seen >= ? AND first_seen < ?"
);
const deleteDownloads = db.prepare(
  "DELETE FROM release_download_visitors WHERE first_seen >= ? AND first_seen < ?"
);
const deleteBotView = db.prepare(
  "DELETE FROM page_view_visitors WHERE first_seen >= ? AND first_seen < ? AND ip_hash = ?"
);

const before = {
  downloadsInWindow: Number(countDownloads.get(startUtc, endUtc).count),
  viewsInWindow: Number(countViews.get(startUtc, endUtc).count),
};

if (before.downloadsInWindow !== 250) {
  db.close();
  throw new Error(`Expected 250 documented bot downloads, found ${before.downloadsInWindow}`);
}

let deletedBotViews = 0;
db.exec("BEGIN IMMEDIATE");
try {
  const deletedDownloads = Number(deleteDownloads.run(startUtc, endUtc).changes);
  for (const hash of botViewHashes) {
    deletedBotViews += Number(deleteBotView.run(startUtc, endUtc, hash).changes);
  }
  db.exec(`
    UPDATE releases
    SET download_count = (
      SELECT COUNT(*)
      FROM release_download_visitors AS visitors
      WHERE visitors.release_id = releases.id
    )
  `);
  db.exec("COMMIT");

  const after = {
    downloadsInWindow: Number(countDownloads.get(startUtc, endUtc).count),
    viewsInWindow: Number(countViews.get(startUtc, endUtc).count),
    totalDownloads: Number(db.prepare("SELECT COUNT(*) AS count FROM release_download_visitors").get().count),
    totalViews: Number(db.prepare("SELECT COUNT(*) AS count FROM page_view_visitors").get().count),
  };

  process.stdout.write(`${JSON.stringify({
    botSources: botIps.size,
    deletedDownloads,
    deletedBotViews,
    before,
    after,
  })}\n`);
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
