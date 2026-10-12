import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import { sendSignedDownload } from "./signed-download.mjs";

test("preserves album parentheses and Greek names while forwarding bytes and ranges", async () => {
  const bytes = Buffer.from("PK archive fixture");
  const upstream = createServer((req, res) => {
    const partial = req.headers.range === "bytes=0-3";
    const body = partial ? bytes.subarray(0, 4) : bytes;
    res.writeHead(partial ? 206 : 200, {
      "Content-Type": "application/zip", "Content-Length": body.length,
      "Accept-Ranges": "bytes", ...(partial ? { "Content-Range": `bytes 0-3/${bytes.length}` } : {}),
      "Content-Disposition": 'attachment; filename="wrong.zip"',
    });
    res.end(body);
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${upstream.address().port}/?response-content-disposition=attachment`;
  const app = express();
  let name = "Company Flow - Funcrusher Plus (1997).zip";
  app.get("/", (req, res, next) => sendSignedDownload(req, res, next, url, name));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const target = `http://127.0.0.1:${server.address().port}/`;
    const full = await fetch(target);
    assert.equal(full.status, 200);
    assert.ok(full.headers.get("content-disposition").includes(`filename="${name}"`));
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    name = "Ελληνικό Album (1997).zip";
    const range = await fetch(target, { headers: { Range: "bytes=0-3" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-3/${bytes.length}`);
    assert.ok(range.headers.get("content-disposition").includes("%281997%29.zip"));
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 4));
  } finally {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});

test("keeps direct downloads when storage preserves the original name", async () => {
  const name = "Album (1997).zip";
  const url = new URL("https://example.com/file");
  url.searchParams.set("response-content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  let redirected;
  await sendSignedDownload({}, { redirect: (...args) => { redirected = args; } }, assert.fail, url.href, name);
  assert.deepEqual(redirected, [302, url.href]);
});
