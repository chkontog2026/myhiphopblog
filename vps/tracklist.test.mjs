import test from "node:test";
import assert from "node:assert/strict";
import { combineTracklistDiscs, formatDiscogsTracklist, formatTracklistForEditor, trackCount, tracklistEditorFields, tracklistGroups } from "./tracklist.mjs";

test("keeps a two-disc Discogs tracklist separated and resets numbering", () => {
  const source = [
    { type_: "heading", title: "Skull Disc" },
    { type_: "track", position: "1-1", title: "Intro" },
    { type_: "track", position: "1-2", title: "Another Victory" },
    { type_: "heading", title: "Bones Disc" },
    { type_: "track", position: "2-1", title: "Valley Of Chrome" },
    { type_: "track", position: "2-2", title: "Get Out Of My Head" },
  ];
  const tracks = formatDiscogsTracklist(source);
  assert.deepEqual(tracks, ["Disc 1 — Skull", "Intro", "Another Victory", "Disc 2 — Bones", "Valley Of Chrome", "Get Out Of My Head"]);
  assert.equal(formatTracklistForEditor(tracks), ["Disc 1 — Skull", "1. Intro", "2. Another Victory", "Disc 2 — Bones", "1. Valley Of Chrome", "2. Get Out Of My Head"].join("\n"));
  assert.equal(trackCount(tracks), 4);
  assert.deepEqual(tracklistGroups(tracks), [
    { label: "Disc 1 — Skull", tracks: ["Intro", "Another Victory"] },
    { label: "Disc 2 — Bones", tracks: ["Valley Of Chrome", "Get Out Of My Head"] },
  ]);
});

test("leaves a single-disc tracklist unchanged", () => {
  assert.deepEqual(formatDiscogsTracklist([
    { type_: "heading", title: "Album" },
    { type_: "track", position: "1", title: "First" },
    { type_: "track", position: "2", title: "Second" },
  ]), ["First", "Second"]);
});

test("treats legacy Skull Disk and Bones Disk rows as disc headings", () => {
  const tracks = ["Skull Disk", "Intro", "Worldwide", "Bones Disk", "Valley Of Chrome", "Dust"];
  assert.equal(formatTracklistForEditor(tracks), [
    "Skull Disk", "1. Intro", "2. Worldwide", "Bones Disk", "1. Valley Of Chrome", "2. Dust",
  ].join("\n"));
  assert.equal(trackCount(tracks), 4);
  assert.deepEqual(tracklistGroups(tracks), [
    { label: "Skull Disk", tracks: ["Intro", "Worldwide"] },
    { label: "Bones Disk", tracks: ["Valley Of Chrome", "Dust"] },
  ]);
});

test("splits a double CD into two editor fields and combines it again", () => {
  const stored = ["CD 1 — L'album Original", "Samurai", "Où Je Vis", "CD 2 — L'album Instrumental", "Samurai (Instrumental)", "Où Je Vis (Instrumental)"];
  assert.deepEqual(tracklistEditorFields(stored), {
    disc1: "1. Samurai\n2. Où Je Vis",
    disc2: "1. Samurai (Instrumental)\n2. Où Je Vis (Instrumental)",
    disc1Label: "L'album Original",
    disc2Label: "L'album Instrumental",
  });
  assert.deepEqual(combineTracklistDiscs(
    "1. Samurai\n2. Où Je Vis",
    "1. Samurai (Instrumental)\n2. Où Je Vis (Instrumental)",
    "L'album Original",
    "L'album Instrumental",
  ), stored);
});

test("does not add a CD heading when the second tracklist is empty", () => {
  assert.deepEqual(combineTracklistDiscs("1. Intro\n2. Finale", ""), ["Intro", "Finale"]);
});

test("preserves an unnumbered continuation line inside the numbered track above it", () => {
  assert.deepEqual(combineTracklistDiscs([
    "1. Στη φέξη",
    "2. Μη Μου Θυμώνεις R.C Για Τη Φωτιά L.C",
    "Για Τη Φωτιά Μη Μου Θυμώνεις R+L",
    "3. Στη Χάση",
  ].join("\n"), ""), [
    "Στη φέξη",
    "Μη Μου Θυμώνεις R.C Για Τη Φωτιά L.C\nΓια Τη Φωτιά Μη Μου Θυμώνεις R+L",
    "Στη Χάση",
  ]);
  assert.deepEqual(combineTracklistDiscs("Intro\nFinale", ""), ["Intro", "Finale"]);
  assert.equal(formatTracklistForEditor([
    "Μη Μου Θυμώνεις R.C Για Τη Φωτιά L.C\nΓια Τη Φωτιά Μη Μου Θυμώνεις R+L",
    "Άστεγη Μπαλάντα",
  ]), "1. Μη Μου Θυμώνεις R.C Για Τη Φωτιά L.C\nΓια Τη Φωτιά Μη Μου Θυμώνεις R+L\n2. Άστεγη Μπαλάντα");
});
