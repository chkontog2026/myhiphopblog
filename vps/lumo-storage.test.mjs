import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
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
  "preserves LUMO music storage and local video posts when LUMO is enabled",
  { timeout: 15000 },
  async () => {
    const calls = [];
    const token = randomBytes(24).toString("hex");
    const key = "blog-downloads/2026/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp3";
    let uploaded;
    let storageUrl;
    const storage = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        if (req.url === "/object") {
          uploaded = bytes;
          res.writeHead(200).end();
          return;
        }
        const body = bytes.length ? JSON.parse(bytes) : null;
        calls.push({
          method: req.method,
          path: req.url,
          body,
          authorized: req.headers.authorization === `Bearer ${token}`,
        });
        if (req.headers.authorization !== `Bearer ${token}`) {
          res.writeHead(403).end();
          return;
        }
        if (req.url === "/api/v1/blog-storage/objects") {
          res.writeHead(204).end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/v1/blog-storage/uploads")
          res.end(
            JSON.stringify({
              key,
              url: storageUrl + "/object",
              contentType: body.contentType,
            }),
          );
        else if (req.url === "/api/v1/blog-storage/downloads")
          res.end(JSON.stringify({ url: storageUrl + "/signed-download" }));
        else res.writeHead(404).end();
      } catch {
        res.writeHead(500).end();
      }
    });
    storage.listen(0, "127.0.0.1");
    await once(storage, "listening");
    storageUrl = `http://127.0.0.1:${storage.address().port}`;
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "myhiphopblog-lumo-"));
    const base = `http://127.0.0.1:${await availablePort()}`;
    const password = randomBytes(24).toString("hex");
    const env = {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: new URL(base).port,
      HOST: "127.0.0.1",
      SITE_URL: base,
      ADMIN_PASSWORD: password,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      LUMO_BLOG_STORAGE_URL: storageUrl,
      LUMO_BLOG_STORAGE_TOKEN: token,
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
        assert.equal(child.exitCode, null);
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
      const cookie = login.headers.get("set-cookie").split(";", 1)[0];
      const admin = await fetch(base + "/admin", { headers: { cookie } }).then(
        (r) => r.text(),
      );
      assert.match(admin, /LUMO Cloud/);
      const csrf = admin.match(/name="csrf" value="([^"]+)"/)[1];
      const save = async (field, bytes, name, type) => {
        const body = new FormData();
        for (const [n, v] of Object.entries({
          csrf,
          artist: "Local fixture",
          title: name,
          publish_date: "2026-10-06",
          publish_action: "publish",
          download_enabled: "1",
        }))
          body.set(n, v);
        body.set(field, new Blob([bytes], { type }), name);
        const response = await fetch(base + "/admin/releases/save", {
          method: "POST",
          redirect: "manual",
          headers: { cookie },
          body,
        });
        assert.equal(response.status, 302);
        return Number(
          new URL(response.headers.get("location"), base).searchParams.get(
            "edit",
          ),
        );
      };
      db = new DatabaseSync(path.join(dataDir, "blog.sqlite"));
      const music = Buffer.from("ID3 music-storage-fixture");
      const musicId = await save(
        "download_file",
        music,
        "my-song.mp3",
        "audio/mpeg",
      );
      assert.deepEqual(uploaded, music);
      const musicRow = db
        .prepare("SELECT * FROM releases WHERE id=?")
        .get(musicId);
      assert.equal(musicRow.download_key, key);
      assert.equal(musicRow.download_url, `lumo:///${key}`);
      const browser = {
        "user-agent": "Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36",
        origin: base,
        "sec-fetch-site": "same-origin",
      };
      const download = async (id) => {
        const intent = await fetch(base + `/downloads/${id}/intent`, {
          method: "POST",
          headers: browser,
          redirect: "manual",
        });
        assert.equal(intent.status, 303);
        return fetch(base + `/downloads/${id}`, {
          redirect: "manual",
          headers: {
            ...browser,
            cookie: intent.headers.get("set-cookie").split(";", 1)[0],
          },
        });
      };
      const signed = await download(musicId);
      assert.equal(signed.status, 302);
      assert.equal(
        signed.headers.get("location"),
        storageUrl + "/signed-download",
      );
      const clip = await readFile(
        new URL("./test-fixtures/clip.mp4", import.meta.url),
      );
      const videoId = await save(
        "video_file",
        clip,
        "my-video.mp4",
        "video/mp4",
      );
      const videoRow = db
        .prepare("SELECT * FROM releases WHERE id=?")
        .get(videoId);
      assert.equal(videoRow.download_key, "");
      assert.ok(videoRow.video_filename);
      const videoResponse = await download(videoId);
      assert.equal(videoResponse.status, 200);
      assert.deepEqual(Buffer.from(await videoResponse.arrayBuffer()), clip);
      const stream = await fetch(base + `/videos/${videoId}`, {
        headers: { range: "bytes=0-31" },
      });
      assert.equal(stream.status, 206);
      const removed = await fetch(base + "/admin/releases/delete", {
        method: "POST",
        redirect: "manual",
        headers: { cookie },
        body: new URLSearchParams({ csrf, id: String(musicId) }),
      });
      assert.equal(removed.status, 302);
      assert.deepEqual(
        calls.map((c) => [c.method, c.path]),
        [
          ["POST", "/api/v1/blog-storage/uploads"],
          ["POST", "/api/v1/blog-storage/downloads"],
          ["DELETE", "/api/v1/blog-storage/objects"],
        ],
      );
      assert.ok(calls.every((c) => c.authorized));
      assert.deepEqual(calls[0].body, {
        fileName: "my-song.mp3",
        contentType: "audio/mpeg",
        byteSize: music.length,
      });
      assert.deepEqual(calls[1].body, { key, fileName: "my-song.mp3" });
      assert.deepEqual(calls[2].body, { key });
    } finally {
      db?.close();
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      storage.closeAllConnections();
      await new Promise((resolve) => storage.close(resolve));
      await rm(dataDir, { recursive: true, force: true });
    }
  },
);
