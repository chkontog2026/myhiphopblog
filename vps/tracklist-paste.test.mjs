import test from "node:test";
import assert from "node:assert/strict";
import { extractTrackTitles } from "./public/tracklist-paste.mjs";

test("extracts only track titles from a copied Discogs markdown table", () => {
  const pasted = `| 1  |    | The Crazy Area      | 5:14 |
| -- | -: | ------------------- | ---: |
| 2  |    | Order Through Chaos | 4:56 |
|    |    | **II. The War Years: Part 1** |      |
| 8  |    | The Wind Of Revolution | 3:25 |
| 12 |    | Show Of Force | |`;

  assert.deepEqual(extractTrackTitles(pasted), [
    "The Crazy Area",
    "Order Through Chaos",
    "The Wind Of Revolution",
    "Show Of Force",
  ]);
});

test("extracts titles from numbered and tab-separated Discogs rows", () => {
  const pasted = `1. First Song 3:45
A2\tSecond Song\t4:02
3 Third Song`;

  assert.deepEqual(extractTrackTitles(pasted), ["First Song", "Second Song", "Third Song"]);
});

test("ignores unnumbered headings and unrelated text", () => {
  assert.deepEqual(extractTrackTitles("Tracklist\nPart II\nNo track numbers here"), []);
});
