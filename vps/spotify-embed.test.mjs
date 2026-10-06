import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSpotifyUrl, spotifyEmbedUrl, spotifyResource } from "./spotify-embed.mjs";

const trackId = "4uLU6hMCjMI75M1A2tKUQC";

test("accepts Spotify resource links and ignores tracking parameters", () => {
  const input = `https://open.spotify.com/track/${trackId}?si=abc123`;
  assert.deepEqual(spotifyResource(input), { type: "track", id: trackId });
  assert.equal(normalizeSpotifyUrl(input), `https://open.spotify.com/track/${trackId}`);
  assert.equal(spotifyEmbedUrl(input), `https://open.spotify.com/embed/track/${trackId}?utm_source=generator`);
});

test("accepts supported Spotify resource types", () => {
  for (const type of ["album", "playlist", "artist", "show", "episode"]) {
    assert.equal(spotifyResource(`https://www.open.spotify.com/${type}/${trackId}`)?.type, type);
  }
});

test("rejects non-Spotify and malformed links", () => {
  for (const input of [
    "https://example.com/track/4uLU6hMCjMI75M1A2tKUQC",
    `https://open.spotify.com/track/${trackId.slice(0, 10)}`,
    `https://open.spotify.com/track/${trackId}/extra`,
    "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  ]) {
    assert.equal(spotifyResource(input), null);
    assert.equal(normalizeSpotifyUrl(input), "");
  }
});
