import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import test from "node:test";

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test(
  "uploads, previews, streams and manages private and published video posts",
  { timeout: 15000 },
  async () => {
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "myhiphopblog-video-"),
    );
    const base = `http://127.0.0.1:${await availablePort()}`;
    const password = randomBytes(24).toString("hex");
    const clip = await readFile(
      new URL("./test-fixtures/clip.mp4", import.meta.url),
    );
    const webm = await readFile(
      new URL("./test-fixtures/clip.webm", import.meta.url),
    );
    const env = {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: new URL(base).port,
      HOST: "127.0.0.1",
      SITE_URL: base,
      ADMIN_PASSWORD: password,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    };
    for (const name of [
      "B2_KEY_ID",
      "B2_APPLICATION_KEY",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "DISCOGS_TOKEN",
      "WEBSHARE_PROXY_URLS",
    ])
      delete env[name];
    const child = spawn(process.execPath, ["server.mjs"], {
      cwd: import.meta.dirname,
      env,
      stdio: "ignore",
    });
    let db;
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        assert.equal(
          child.exitCode,
          null,
          "application exited before readiness",
        );
        try {
          ready = (await fetch(base + "/health")).ok;
        } catch {}
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(ready);
      const login = await fetch(base + "/admin/login", {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({ password }),
      });
      assert.equal(login.status, 302);
      const cookie = login.headers.get("set-cookie").split(";", 1)[0];
      const admin = await fetch(base + "/admin", { headers: { cookie } }).then(
        (r) => r.text(),
      );
      const csrf = admin.match(/name="csrf" value="([^"]+)"/)[1];
      assert.match(admin, /name="video_file"/);
      const submit = (
        fields = {},
        video = null,
        route = "/admin/releases/save",
      ) => {
        const body = new FormData();
        for (const [n, v] of Object.entries({
          csrf,
          artist: "Δικός μου καλλιτέχνης",
          title: "Δικό μου video",
          publish_date: "2026-10-06",
          publish_action: "save",
          ...fields,
        }))
          body.set(n, v);
        if (video)
          body.set(
            "video_file",
            new Blob([video.bytes], { type: video.type || "video/mp4" }),
            video.name || "δικό μου video.mp4",
          );
        return fetch(base + route, {
          method: "POST",
          redirect: "manual",
          headers: { cookie },
          body,
        });
      };
      db = new DatabaseSync(path.join(dataDir, "blog.sqlite"));
      const initialCount = db
        .prepare("SELECT COUNT(*) AS n FROM releases")
        .get().n;
      assert.equal(
        (await submit({}, { bytes: Buffer.from("<html>not a video</html>") }))
          .status,
        400,
      );
      assert.equal(
        (await readdir(path.join(dataDir, "videos"))).length,
        0,
        "rejected upload must be removed",
      );
      assert.equal(
        (await submit({ csrf: "invalid" }, { bytes: clip })).status,
        403,
      );
      assert.equal((await readdir(path.join(dataDir, "videos"))).length, 0);
      const preview = await submit(
        {},
        { bytes: clip },
        "/admin/releases/preview",
      );
      assert.equal(preview.status, 200);
      const previewUrl = (await preview.text()).match(
        /<video src="([^"]+)"/,
      )[1];
      assert.match(previewUrl, /^\/admin\/video-preview\//);
      assert.equal(
        (await fetch(base + previewUrl, { redirect: "manual" })).status,
        302,
      );
      assert.equal(
        (
          await fetch(base + previewUrl, {
            headers: { cookie, range: "bytes=0-31" },
          })
        ).status,
        206,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM releases").get().n,
        initialCount,
        "preview must not create a post",
      );
      const saved = await submit({}, { bytes: clip });
      assert.equal(saved.status, 302, await saved.text());
      const id = Number(
        new URL(saved.headers.get("location"), base).searchParams.get("edit"),
      );
      let row = db.prepare("SELECT * FROM releases WHERE id=?").get(id);
      assert.equal(row.published, 0);
      assert.equal(row.video_name, "δικό μου video.mp4");
      assert.equal(
        (await fetch(base + `/videos/${id}`)).status,
        404,
        "draft stays private",
      );
      assert.equal(
        (await fetch(base + `/uploads/${row.video_filename}`)).status,
        404,
        "no static file leak",
      );
      assert.equal(
        (await fetch(base + `/videos/${id}`, { headers: { cookie } })).status,
        200,
      );
      const original = row.video_filename;
      assert.equal(
        (
          await submit({
            id: String(id),
            publish_action: "publish",
            download_enabled: "1",
          })
        ).status,
        302,
      );
      row = db.prepare("SELECT * FROM releases WHERE id=?").get(id);
      assert.equal(row.video_filename, original);
      const stream = await fetch(base + `/videos/${id}`, {
        headers: { range: "bytes=0-31" },
      });
      assert.equal(stream.status, 206);
      assert.match(stream.headers.get("content-type"), /video\/mp4/);
      assert.deepEqual(
        Buffer.from(await stream.arrayBuffer()),
        clip.subarray(0, 32),
      );
      const home = await fetch(base + "/").then((r) => r.text());
      const article = home.split(`id="${row.slug}"`)[1].split("</article>")[0];
      assert.match(article, new RegExp(`<video src="/videos/${id}\\?v=`));
      assert.equal(
        (
          article.match(new RegExp(`action="/downloads/${id}/intent"`, "g")) ||
          []
        ).length,
        1,
      );
      const browser = {
        "user-agent": "Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36",
        origin: base,
        "sec-fetch-site": "same-origin",
      };
      const intent = await fetch(base + `/downloads/${id}/intent`, {
        method: "POST",
        headers: browser,
        redirect: "manual",
      });
      assert.equal(intent.status, 303);
      const download = await fetch(base + `/downloads/${id}`, {
        headers: {
          ...browser,
          cookie: intent.headers.get("set-cookie").split(";", 1)[0],
        },
      });
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition"), /^attachment;/);
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), clip);
      assert.equal(
        db.prepare("SELECT download_count FROM releases WHERE id=?").get(id)
          .download_count,
        1,
      );
      assert.equal((await submit({ id: String(id) })).status, 302);
      assert.equal(
        (await fetch(base + `/downloads/${id}`, { method: "HEAD" })).status,
        404,
      );
      assert.equal(
        (await fetch(base + `/videos/${id}`)).status,
        200,
        "playback remains when download disabled",
      );
      assert.equal(
        (
          await submit(
            { id: String(id) },
            { bytes: clip, name: "replacement.mp4" },
          )
        ).status,
        302,
      );
      const current = db.prepare("SELECT * FROM releases WHERE id=?").get(id);
      assert.notEqual(current.video_filename, original);
      assert.ok(
        !(await readdir(path.join(dataDir, "videos"))).includes(original),
      );
      assert.equal(
        (await submit({ id: String(id), remove_video: "1" })).status,
        302,
      );
      assert.equal((await fetch(base + `/videos/${id}`)).status, 404);
      assert.ok(
        !(await readdir(path.join(dataDir, "videos"))).includes(
          current.video_filename,
        ),
      );
      assert.equal(
        (
          await submit(
            { id: String(id) },
            { bytes: webm, name: "video.webm", type: "video/webm" },
          )
        ).status,
        302,
      );
      const webmResponse = await fetch(base + `/videos/${id}`);
      assert.equal(webmResponse.status, 200);
      assert.match(webmResponse.headers.get("content-type"), /video\/webm/);
      assert.deepEqual(Buffer.from(await webmResponse.arrayBuffer()), webm);
      const last = db
        .prepare("SELECT video_filename FROM releases WHERE id=?")
        .get(id).video_filename;
      const deleted = await fetch(base + "/admin/releases/delete", {
        method: "POST",
        headers: { cookie },
        body: new URLSearchParams({ csrf, id: String(id) }),
        redirect: "manual",
      });
      assert.equal(deleted.status, 302);
      assert.ok(!(await readdir(path.join(dataDir, "videos"))).includes(last));
    } finally {
      db?.close();
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
