import test from "node:test";
import assert from "node:assert/strict";
import { buildPlaylistRows, greeklishToGreek, parseId3Bytes, rewriteMp3Bytes, trackNumberFrom } from "./public/playlist-metadata.mjs";

test("converts the supplied Greeklish playlist example to Greek", () => {
  assert.equal(greeklishToGreek("Oi Zoes Oson Me Niothoun"), "Οι Ζωές Όσων Μας Νιώθουν");
  assert.equal(greeklishToGreek("Agnwstos Xeimwnas"), "Άγνωστος Χειμώνας");
  assert.equal(greeklishToGreek("Sta Vimata Tou Iskiou"), "Στα Βήματα Του Ίσκιου");
});

test("uses track numbers to align canonical Discogs titles", () => {
  const rows = buildPlaylistRows([
    { fileName: "02.Ekso Ap'ta Dontia.mp3", title: "02.Ekso Ap'ta Dontia", artist: "Agnwstos Xeimwnas", album: "Sta Vimata Tou Iskiou", trackNumber: 2 },
    { fileName: "01.Oi Zoes Oson Me Niothoun.mp3", title: "01.Oi Zoes Oson Me Niothoun", artist: "Agnwstos Xeimwnas", album: "Sta Vimata Tou Iskiou", trackNumber: 1 },
  ], { artist: "Άγνωστος Χειμώνας", title: "Στα Βήματα Του Ίσκιου", tracks: ["Οι Ζωές Όσων Μας Νιώθουν", "Έξω Απ' Τα Δόντια"] });
  assert.deepEqual(rows[0], {
    fileName: "01.Οι Ζωές Όσων Μας Νιώθουν.mp3",
    title: "01.Οι Ζωές Όσων Μας Νιώθουν",
    artist: "Άγνωστος Χειμώνας",
    album: "Στα Βήματα Του Ίσκιου",
    trackNumber: 1,
  });
  assert.equal(rows[1].title, "02.Έξω Απ' Τα Δόντια");
});

test("reads common ID3v2.3 text frames", () => {
  const frames = [
    textFrame("TIT2", "Oi Zoes Oson Me Niothoun"),
    textFrame("TPE1", "Agnwstos Xeimwnas"),
    textFrame("TALB", "Sta Vimata Tou Iskiou"),
    textFrame("TRCK", "1/13"),
  ];
  const payload = Buffer.concat(frames);
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, ...syncSafe(payload.length)]);
  assert.deepEqual(parseId3Bytes(Buffer.concat([header, payload])), {
    title: "Oi Zoes Oson Me Niothoun",
    artist: "Agnwstos Xeimwnas",
    album: "Sta Vimata Tou Iskiou",
    track: "1/13",
  });
  assert.equal(trackNumberFrom("1/13", ""), 1);
});

test("rewrites filename metadata fields while preserving the MP3 audio bytes", () => {
  const oldFrame = textFrame("TIT2", "Oi Zoes Oson Me Niothoun");
  const oldHeader = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, ...syncSafe(oldFrame.length)]);
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
  const rewritten = rewriteMp3Bytes(Buffer.concat([oldHeader, oldFrame, audio]), {
    title: "01.Οι Ζωές Όσων Μας Νιώθουν",
    artist: "Άγνωστος Χειμώνας",
    album: "Στα Βήματα Του Ίσκιου",
    trackNumber: 1,
  });
  assert.deepEqual(parseId3Bytes(rewritten), {
    title: "01.Οι Ζωές Όσων Μας Νιώθουν",
    artist: "Άγνωστος Χειμώνας",
    albumArtist: "Άγνωστος Χειμώνας",
    album: "Στα Βήματα Του Ίσκιου",
    track: "1",
  });
  assert.deepEqual(Buffer.from(rewritten.slice(-audio.length)), audio);
});

function textFrame(id, value) {
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(value, "utf8")]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([Buffer.from(id), size, Buffer.from([0, 0]), body]);
}

function syncSafe(size) { return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]; }
