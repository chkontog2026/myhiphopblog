import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYouTubeUrl, youtubeEmbedUrl, youtubeVideoId } from "./youtube-embed.mjs";

const videoId = "dQw4w9WgXcQ";

test("accepts common YouTube video URL formats", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${videoId}&list=abc`,
    `https://youtu.be/${videoId}?si=abc`,
    `https://www.youtube.com/shorts/${videoId}`,
    `https://www.youtube.com/live/${videoId}?feature=share`,
    `https://www.youtube-nocookie.com/embed/${videoId}`,
  ]) {
    assert.equal(youtubeVideoId(url), videoId);
  }
});

test("rejects non-YouTube and malformed video URLs", () => {
  for (const url of [
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=too-short",
    "not a url",
  ]) {
    assert.equal(youtubeVideoId(url), null);
  }
});

test("normalizes storage and uses the privacy-enhanced embed domain", () => {
  assert.equal(normalizeYouTubeUrl(`https://youtu.be/${videoId}`), `https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(youtubeEmbedUrl(`https://youtu.be/${videoId}`), `https://www.youtube-nocookie.com/embed/${videoId}`);
});
