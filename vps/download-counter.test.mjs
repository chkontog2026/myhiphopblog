import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dateInTimeZone } from "./site-date.mjs";

test("counts one download per IP and album and shows the total in admin", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "myhiphopblog-download-test-"));
  const port = await availablePort();
  const sessionSecret = "test-session-secret-12345678901234567890";
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: "127.0.0.1",
      SITE_URL: `http://127.0.0.1:${port}`,
      ADMIN_PASSWORD: "test-password-12345",
      SESSION_SECRET: sessionSecret,
      GOOGLE_ANALYTICS_ID: "G-601F0MJFR1",
    },
    stdio: "ignore",
  });
  let database;

  try {
    await waitUntilHealthy(port, server);
    database = new DatabaseSync(path.join(dataDir, "blog.sqlite"));
    database.prepare("UPDATE releases SET download_url = ? WHERE id IN (1, 2)")
      .run("https://example.com/album.zip");

    const browserHeaders = {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36",
      origin: `http://127.0.0.1:${port}`,
      "sec-fetch-site": "same-origin",
    };
    const homeResponse = await fetch(`http://127.0.0.1:${port}/`, { headers: browserHeaders });
    const pageViewCookie = homeResponse.headers.get("set-cookie")?.split(";", 1)[0] || "";
    const home = await homeResponse.text();
    assert.match(pageViewCookie, /^page_view_intent=/);
    assert.match(home, /action="\/downloads\/1\/intent"/);
    assert.doesNotMatch(home, /href="\/downloads\/1"/);
    assert.match(home, /post-share\.css\?v=4/);
    assert.doesNotMatch(home, /Συνολικές προβολές/);
    assert.doesNotMatch(home, /view-counter\.css/);
    assert.match(home, /action="\/newsletter"/);
    assert.match(home, /newsletter\.css\?v=1/);
    assert.match(home, /google-analytics\.js\?v=2/);
    assert.match(home, /view-counter\.js\?v=1/);
    assert.equal((home.match(/data-measurement-id="G-601F0MJFR1"/g) || []).length, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM page_view_visitors").get().total, 0);

    const botHome = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { "user-agent": "GPTBot/1.4" },
    });
    assert.equal(botHome.headers.get("set-cookie"), null);

    const crossSiteView = await fetch(`http://127.0.0.1:${port}/analytics/page-view`, {
      method: "POST",
      headers: {
        ...browserHeaders,
        origin: "https://example.net",
        "sec-fetch-site": "cross-site",
        "x-page-view-intent": "1",
        cookie: pageViewCookie,
      },
    });
    assert.equal(crossSiteView.status, 204);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM page_view_visitors").get().total, 0);

    const mismatchedIpView = await fetch(`http://127.0.0.1:${port}/analytics/page-view`, {
      method: "POST",
      headers: {
        ...browserHeaders,
        "x-page-view-intent": "1",
        "x-forwarded-for": "203.0.113.30",
        cookie: pageViewCookie,
      },
    });
    assert.equal(mismatchedIpView.status, 204);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM page_view_visitors").get().total, 0);

    const validPageView = await fetch(`http://127.0.0.1:${port}/analytics/page-view`, {
      method: "POST",
      headers: {
        ...browserHeaders,
        "x-page-view-intent": "1",
        cookie: pageViewCookie,
      },
    });
    assert.equal(validPageView.status, 204);
    assert.match(validPageView.headers.get("set-cookie") || "", /^page_view_intent=;/);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM page_view_visitors").get().total, 1);

    const adminLogin = await fetch(`http://127.0.0.1:${port}/admin`).then((response) => response.text());
    assert.doesNotMatch(adminLogin, /google-analytics\.js/);
    const cspHomeResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.match(cspHomeResponse.headers.get("content-security-policy") || "", /script-src 'self' https:\/\/www\.googletagmanager\.com/);
    assert.match(cspHomeResponse.headers.get("content-security-policy") || "", /connect-src 'self' https:\/\/\*\.google-analytics\.com/);

    const subscribe = await fetch(`http://127.0.0.1:${port}/newsletter`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "Listener@Example.com" }),
    });
    assert.equal(subscribe.status, 303);
    assert.equal(subscribe.headers.get("location"), "/?newsletter=success#newsletter");
    assert.deepEqual(database.prepare("SELECT email FROM newsletter_subscribers").all().map((row) => row.email), ["listener@example.com"]);

    const duplicate = await fetch(`http://127.0.0.1:${port}/newsletter`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "listener@example.com" }),
    });
    assert.equal(duplicate.headers.get("location"), "/?newsletter=existing#newsletter");
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM newsletter_subscribers").get().total, 1);

    const invalid = await fetch(`http://127.0.0.1:${port}/newsletter`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "όχι-email" }),
    });
    assert.equal(invalid.headers.get("location"), "/?newsletter=invalid#newsletter");

    const head = await fetch(`http://127.0.0.1:${port}/downloads/1`, { method: "HEAD" });
    assert.equal(head.status, 204);
    assert.equal(database.prepare("SELECT download_count FROM releases WHERE id = 1").get().download_count, 0);

    const requestIntent = async (releaseId, extraHeaders = {}) => {
      const headers = { ...browserHeaders, ...extraHeaders };
      const intent = await fetch(`http://127.0.0.1:${port}/downloads/${releaseId}/intent`, {
        method: "POST",
        redirect: "manual",
        headers,
      });
      assert.equal(intent.status, 303);
      assert.equal(intent.headers.get("location"), `/downloads/${releaseId}`);
      const cookie = intent.headers.get("set-cookie")?.split(";", 1)[0] || "";
      assert.match(cookie, /^download_intent=/);
      return { cookie, headers };
    };
    const fetchDownload = (releaseId, intent, extraHeaders = {}) => fetch(`http://127.0.0.1:${port}/downloads/${releaseId}`, {
      redirect: "manual",
      headers: { ...intent.headers, ...extraHeaders, cookie: intent.cookie },
    });

    const directDownload = await fetch(`http://127.0.0.1:${port}/downloads/1`, {
      headers: browserHeaders,
    });
    assert.equal(directDownload.status, 200);
    assert.match(await directDownload.text(), /Συνέχεια στο Download/);
    assert.equal(database.prepare("SELECT download_count FROM releases WHERE id = 1").get().download_count, 0);

    const botIntent = await fetch(`http://127.0.0.1:${port}/downloads/1/intent`, {
      method: "POST",
      redirect: "manual",
      headers: { ...browserHeaders, "user-agent": "GPTBot/1.4" },
    });
    assert.equal(botIntent.status, 403);

    const crossSiteIntent = await fetch(`http://127.0.0.1:${port}/downloads/1/intent`, {
      method: "POST",
      redirect: "manual",
      headers: { ...browserHeaders, origin: "https://example.net", "sec-fetch-site": "cross-site" },
    });
    assert.equal(crossSiteIntent.status, 403);

    const firstIntent = await requestIntent(1);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const download = await fetchDownload(1, firstIntent);
      assert.equal(download.status, 302);
      assert.equal(download.headers.get("location"), "https://example.com/album.zip");
    }
    assert.equal(database.prepare("SELECT download_count FROM releases WHERE id = 1").get().download_count, 1);

    const secondIntent = await requestIntent(2);
    await fetchDownload(2, secondIntent);
    assert.equal(database.prepare("SELECT download_count FROM releases WHERE id = 2").get().download_count, 1);

    const otherIpIntent = await requestIntent(1, { "x-forwarded-for": "203.0.113.10" });
    await fetchDownload(1, otherIpIntent, { "x-forwarded-for": "203.0.113.10" });
    assert.equal(database.prepare("SELECT download_count FROM releases WHERE id = 1").get().download_count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS total FROM release_download_visitors").get().total, 3);

    const rateLimitedHeaders = { ...browserHeaders, "x-forwarded-for": "203.0.113.20" };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const allowedIntent = await fetch(`http://127.0.0.1:${port}/downloads/1/intent`, {
        method: "POST",
        redirect: "manual",
        headers: rateLimitedHeaders,
      });
      assert.equal(allowedIntent.status, 303);
    }
    const blockedIntent = await fetch(`http://127.0.0.1:${port}/downloads/1/intent`, {
      method: "POST",
      redirect: "manual",
      headers: rateLimitedHeaders,
    });
    assert.equal(blockedIntent.status, 429);

    const cloneRelease = database.prepare(`INSERT INTO releases (
      slug, artist, title, publish_date, release_date, genre, format, description,
      cover_url, download_url, download_key, download_name, position, published
    ) SELECT ?, artist, title, publish_date, release_date, genre, format, description,
      cover_url, download_url, download_key, download_name, position, published
      FROM releases WHERE id = 1`);
    for (let index = 0; index < 4; index += 1) cloneRelease.run(`pagination-copy-${index}`);

    const expires = Date.now() + 60_000;
    const signature = crypto.createHmac("sha256", sessionSecret).update(String(expires)).digest("hex");
    const admin = await fetch(`http://127.0.0.1:${port}/admin`, {
      headers: { cookie: `nd_session=${expires}.${signature}` },
    }).then((response) => response.text());
    assert.match(admin, /Δημοσιευμένη · 2 λήψεις/);
    assert.match(admin, /Συνολικές προβολές<\/span><strong>1<\/strong>/);
    assert.match(admin, /Newsletter<\/span><strong>1<\/strong><a href="\/admin\/newsletter\.csv">Λήψη CSV<\/a>/);
    assert.match(admin, /admin-stats\.css\?v=1/);
    assert.match(admin, /admin-pagination\.css\?v=1/);
    assert.match(admin, /name="has_second_disc"/);
    assert.match(admin, /name="tracks_disc_2"/);
    assert.match(admin, /class="release-delete-button"[^>]+data-delete-form="delete-release-1"/);
    assert.match(admin, /class="release-preview"[^>]+formaction="\/admin\/releases\/preview" formtarget="_blank">Preview<\/button>/);
    assert.match(admin, /admin-discogs\.css\?v=18/);
    assert.match(admin, /admin-upload\.js\?v=9/);

    const csv = await fetch(`http://127.0.0.1:${port}/admin/newsletter.csv`, {
      headers: { cookie: `nd_session=${expires}.${signature}` },
    });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-disposition") || "", /newsletter-subscribers\.csv/);
    assert.match(await csv.text(), /"listener@example\.com"/);
    assert.match(admin, /id="delete-release-1" class="delete-form"[^>]+hidden/);
    assert.ok(admin.includes(`name="publish_date" value="${dateInTimeZone(new Date(), "Europe/Athens")}"`));
    assert.equal((admin.match(/class="admin-card release-row"/g) || []).length, 5);
    assert.match(admin, /Σελίδα 1 από 2/);
    assert.match(admin, /href="\/admin\?page=2">Επόμενη/);

    const secondPage = await fetch(`http://127.0.0.1:${port}/admin?page=2`, {
      headers: { cookie: `nd_session=${expires}.${signature}` },
    }).then((response) => response.text());
    assert.equal((secondPage.match(/class="admin-card release-row"/g) || []).length, 2);
    assert.match(secondPage, /Σελίδα 2 από 2/);
    assert.match(secondPage, /href="\/admin\?page=1">← Προηγούμενη/);

    const csrf = crypto.createHmac("sha256", sessionSecret).update(`csrf:${expires}`).digest("hex");
    const saveDoubleCd = await fetch(`http://127.0.0.1:${port}/admin/releases/save`, {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: `nd_session=${expires}.${signature}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf,
        id: "1",
        admin_page: "2",
        artist: "Nefeli K.",
        title: "After Midnight",
        publish_date: "2025-07-29",
        genre: "Hip Hop",
        format: "MP3",
        position: "0",
        publish_action: "save",
        has_second_disc: "1",
        disc_1_label: "Original",
        tracks: "1. Intro\n2. Finale",
        disc_2_label: "Instrumental",
        tracks_disc_2: "1. Intro (Instrumental)\n2. Finale (Instrumental)",
      }),
    });
    assert.equal(saveDoubleCd.status, 302);
    assert.equal(saveDoubleCd.headers.get("location"), "/admin?ok=post&page=2&edit=1#release-actions-1");
    assert.deepEqual(database.prepare("SELECT title FROM tracks WHERE release_id = 1 ORDER BY position").all().map((row) => row.title), [
      "CD 1 — Original", "Intro", "Finale", "CD 2 — Instrumental", "Intro (Instrumental)", "Finale (Instrumental)",
    ]);

    const reopened = await fetch(`http://127.0.0.1:${port}/admin?ok=post&page=2&edit=1`, {
      headers: { cookie: `nd_session=${expires}.${signature}` },
    }).then((response) => response.text());
    assert.doesNotMatch(reopened, /Οι αλλαγές αποθηκεύτηκαν/);
    assert.match(reopened, /class="admin-card release-row" open/);
    assert.match(reopened, /name="has_second_disc" value="1" checked/);
    assert.match(reopened, /aria-label="Tracklist CD 2">1\. Intro \(Instrumental\)/);

    const releaseBeforePreview = database.prepare("SELECT artist, title, published FROM releases WHERE id = 1").get();
    const tracksBeforePreview = database.prepare("SELECT title FROM tracks WHERE release_id = 1 ORDER BY position").all();
    const previewResponse = await fetch(`http://127.0.0.1:${port}/admin/releases/preview`, {
      method: "POST",
      headers: {
        cookie: `nd_session=${expires}.${signature}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        csrf,
        id: "1",
        artist: "Preview Artist",
        title: "Preview Draft",
        publish_date: "2026-08-24",
        genre: "Hip Hop",
        format: "MP3",
        position: "0",
        tracks: "1. Preview Track",
      }),
    });
    const previewHtml = await previewResponse.text();
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get("cache-control"), "private, no-store");
    assert.match(previewHtml, /<title>Preview — MY HIP HOP BLOG — Music Blog<\/title>/);
    assert.match(previewHtml, /<strong>Preview<\/strong><span>Η προεπισκόπηση δεν αλλάζει τη δημοσίευση\.<\/span>/);
    assert.match(previewHtml, /Preview Artist — Preview Draft/);
    assert.match(previewHtml, /Preview Track/);
    assert.deepEqual(database.prepare("SELECT artist, title, published FROM releases WHERE id = 1").get(), releaseBeforePreview);
    assert.deepEqual(database.prepare("SELECT title FROM tracks WHERE release_id = 1 ORDER BY position").all(), tracksBeforePreview);

    const publicAfterPreview = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.doesNotMatch(publicAfterPreview, /Preview Artist — Preview Draft/);

    const anonymousPreview = await fetch(`http://127.0.0.1:${port}/admin/releases/preview`, { method: "POST", redirect: "manual" });
    assert.equal(anonymousPreview.status, 302);
    assert.equal(anonymousPreview.headers.get("location"), "/admin/login");
  } finally {
    database?.close();
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitUntilHealthy(port, server) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Test server exited before becoming healthy");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not become healthy");
}
