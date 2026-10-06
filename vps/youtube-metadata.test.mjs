import assert from "node:assert/strict";
import test from "node:test";
import { extractYouTubePublishedYear, parseYouTubeMetadata } from "./youtube-metadata.mjs";

test("splits artist and track title from a typical YouTube title", () => {
  assert.deepEqual(parseYouTubeMetadata("AMNEA - Καλοκαίρια", "Amnea", "2024"), {
    artist: "AMNEA",
    title: "Καλοκαίρια",
    releaseDate: "2024",
  });
});

test("prefers an explicit title year and removes common video suffixes", () => {
  assert.deepEqual(parseYouTubeMetadata("Artist — Track (1999) [Official Video]", "ArtistVEVO", "2020"), {
    artist: "Artist",
    title: "Track",
    releaseDate: "1999",
  });
});

test("falls back to the channel name when the title has no separator", () => {
  assert.deepEqual(parseYouTubeMetadata("Μοναχικό τραγούδι", "Example - Topic", "2021"), {
    artist: "Example",
    title: "Μοναχικό τραγούδι",
    releaseDate: "2021",
  });
});

test("extracts the published year from normal and escaped YouTube page data", () => {
  assert.equal(extractYouTubePublishedYear('{"publishDate":"2018-05-04"}'), "2018");
  assert.equal(extractYouTubePublishedYear('{\\"uploadDate\\":\\"2017-03-02\\"}'), "2017");
});
