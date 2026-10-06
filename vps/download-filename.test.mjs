import assert from "node:assert/strict";
import test from "node:test";
import { downloadContentDisposition, normalizeDownloadFilename } from "./download-filename.mjs";

test("recovers Greek filenames decoded as Latin-1 by multipart parsing", () => {
  const original = "Λόγος Τιμής - Σε άλλη φάση.zip";
  const mojibake = Buffer.from(original, "utf8").toString("latin1");
  assert.equal(normalizeDownloadFilename(mojibake), original);
});

test("keeps ASCII and genuine Latin-1 filenames intact", () => {
  assert.equal(normalizeDownloadFilename("album.zip"), "album.zip");
  assert.equal(normalizeDownloadFilename("café.zip"), "café.zip");
});

test("emits an ASCII fallback and an RFC 5987 UTF-8 filename", () => {
  const header = downloadContentDisposition("Λόγος Τιμής (live).zip");
  assert.match(header, /^attachment; filename="[\x20-\x7E]+"; filename\*=UTF-8''/);
  assert.ok(header.endsWith("%CE%9B%CF%8C%CE%B3%CE%BF%CF%82%20%CE%A4%CE%B9%CE%BC%CE%AE%CF%82%20%28live%29.zip"));
});
