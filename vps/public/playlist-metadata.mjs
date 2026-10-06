const greekWordDictionary = new Map(Object.entries({
  oi: "Οι", zoes: "Ζωές", oson: "Όσων", mas: "Μας", me: "Με", niothoun: "Νιώθουν",
  agnwstos: "Άγνωστος", xeimwnas: "Χειμώνας", sta: "Στα", vimata: "Βήματα", tou: "Του", iskiou: "Ίσκιου",
  exo: "Έξω", ap: "Απ'", ta: "Τα", dontia: "Δόντια", omorfi: "Όμορφη", poli: "Πόλη", akri: "Άκρη",
  ena: "Ένα", ennia: "Εννιά", kai: "Και", ogdontatria: "Ογδοντατρία", anemos: "Άνεμος",
  apla: "Απλά", koita: "Κοίτα", psila: "Ψηλά", ela: "Έλα", mia: "Μια", volta: "Βόλτα",
  o: "Ο", kairos: "Καιρός", tis: "Της", siopis: "Σιωπής", xroma: "Χρώμα", en: "Εν", ptisi: "Πτήση",
  ti: "Τι", na: "Να", mou: "Μου", peis: "Πεις", ki: "Κι", esy: "Εσύ",
}));

const phraseCorrections = new Map([
  ["oi zoes oson me niothoun", "Οι Ζωές Όσων Μας Νιώθουν"],
]);

const greeklishPairs = [
  ["th", "θ"], ["ps", "ψ"], ["ch", "χ"], ["ks", "ξ"], ["ou", "ου"],
  ["mp", "μπ"], ["nt", "ντ"], ["gk", "γκ"], ["tz", "τζ"], ["ts", "τσ"],
];

const greeklishLetters = {
  a: "α", b: "β", c: "κ", d: "δ", e: "ε", f: "φ", g: "γ", h: "η", i: "ι",
  j: "τζ", k: "κ", l: "λ", m: "μ", n: "ν", o: "ο", p: "π", q: "κ", r: "ρ",
  s: "σ", t: "τ", u: "υ", v: "β", w: "ω", x: "χ", y: "υ", z: "ζ",
};

export function greeklishToGreek(value) {
  const source = String(value || "").trim();
  if (!source || /[α-ωάέήίόύώϊϋΐΰ]/iu.test(source)) return source;
  const phraseKey = source.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
  if (phraseCorrections.has(phraseKey)) return phraseCorrections.get(phraseKey);

  return source.replace(/[a-z]+/gi, (word) => {
    const lower = word.toLocaleLowerCase("en-US");
    if (greekWordDictionary.has(lower)) return greekWordDictionary.get(lower);
    let prepared = lower;
    for (const [latin, greek] of greeklishPairs) prepared = prepared.replaceAll(latin, greek);
    let converted = [...prepared].map((character) => greeklishLetters[character] || character).join("");
    converted = converted.replace(/σ$/u, "ς");
    return /^[A-Z]/.test(word) ? `${converted.charAt(0).toLocaleUpperCase("el-GR")}${converted.slice(1)}` : converted;
  });
}

export function cleanTrackTitle(value) {
  return String(value || "")
    .replace(/\.(?:mp3|flac|m4a|aac|ogg|wav)$/i, "")
    .replace(/^\s*\d{1,3}\s*[.\-_)]\s*/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function trackNumberFrom(value, fallbackName = "") {
  const tagged = String(value || "").match(/^\s*(\d{1,3})/);
  const named = String(fallbackName || "").match(/^\s*(\d{1,3})\s*[.\-_)]/);
  return Number(tagged?.[1] || named?.[1] || 0);
}

export function parseId3Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return {};
  const version = bytes[3];
  const tagSize = syncSafe(bytes, 6);
  const end = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  const tags = {};
  const wanted = new Map([["TIT2", "title"], ["TPE1", "artist"], ["TPE2", "albumArtist"], ["TALB", "album"], ["TRCK", "track"]]);

  while (offset + 10 <= end) {
    const frameId = ascii(bytes, offset, 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = version === 4 ? syncSafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    if (!frameSize || offset + 10 + frameSize > end) break;
    const tagName = wanted.get(frameId);
    if (tagName) tags[tagName] = decodeTextFrame(bytes.slice(offset + 10, offset + 10 + frameSize));
    offset += 10 + frameSize;
  }
  return tags;
}

export function parseId3v1Bytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 128) return {};
  const offset = bytes.length - 128;
  if (ascii(bytes, offset, 3) !== "TAG") return {};
  const field = (start, length) => new TextDecoder("windows-1252").decode(bytes.slice(offset + start, offset + start + length)).replace(/\0+$/g, "").trim();
  const track = bytes[offset + 125] === 0 ? String(bytes[offset + 126] || "") : "";
  return { title: field(3, 30), artist: field(33, 30), album: field(63, 30), track };
}

export function rewriteMp3Bytes(input, row) {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  let start = 0;
  let end = source.length;
  if (source.length >= 10 && ascii(source, 0, 3) === "ID3") {
    start = Math.min(source.length, 10 + syncSafe(source, 6) + ((source[5] & 0x10) ? 10 : 0));
  }
  if (end - start >= 128 && ascii(source, end - 128, 3) === "TAG") end -= 128;

  const tag = buildId3v23Tag({
    title: row.title,
    artist: row.artist,
    albumArtist: row.artist,
    album: row.album,
    track: String(row.trackNumber),
  });
  const output = new Uint8Array(tag.length + Math.max(0, end - start));
  output.set(tag, 0);
  output.set(source.slice(start, end), tag.length);
  return output;
}

function buildId3v23Tag(tags) {
  const frames = [
    textFrameBytes("TIT2", tags.title),
    textFrameBytes("TPE1", tags.artist),
    textFrameBytes("TPE2", tags.albumArtist),
    textFrameBytes("TALB", tags.album),
    textFrameBytes("TRCK", tags.track),
  ];
  const payloadSize = frames.reduce((total, frame) => total + frame.length, 0);
  const output = new Uint8Array(10 + payloadSize);
  output.set([0x49, 0x44, 0x33, 3, 0, 0, ...syncSafeBytes(payloadSize)], 0);
  let offset = 10;
  for (const frame of frames) { output.set(frame, offset); offset += frame.length; }
  return output;
}

function textFrameBytes(id, value) {
  const encoded = new TextEncoder().encode(String(value || ""));
  const body = new Uint8Array(1 + encoded.length);
  body[0] = 3;
  body.set(encoded, 1);
  const frame = new Uint8Array(10 + body.length);
  frame.set(new TextEncoder().encode(id), 0);
  frame.set(uint32Bytes(body.length), 4);
  frame.set(body, 10);
  return frame;
}

export function buildPlaylistRows(items, discogs = null) {
  const canonicalTracks = (Array.isArray(discogs?.tracks) ? discogs.tracks : [])
    .map((track) => String(track || "").trim())
    .filter((track) => track && !/^(?:disc|disk|cd)\s*\d+/i.test(track));

  return [...items].sort((a, b) => (a.trackNumber || 9999) - (b.trackNumber || 9999) || a.fileName.localeCompare(b.fileName, "el"))
    .map((item, index) => {
      const number = item.trackNumber || index + 1;
      const prefix = String(number).padStart(2, "0");
      const canonicalTitle = canonicalTracks[number - 1] || greeklishToGreek(cleanTrackTitle(item.title || item.fileName));
      const artist = discogs?.artist || greeklishToGreek(item.artist || item.albumArtist || "Άγνωστος καλλιτέχνης");
      const album = discogs?.title || greeklishToGreek(item.album || "Άγνωστο άλμπουμ");
      const title = `${prefix}.${canonicalTitle}`;
      const extension = String(item.fileName).match(/\.[a-z0-9]{2,5}$/i)?.[0].toLocaleLowerCase("en-US") || ".mp3";
      return { fileName: `${title}${extension}`, title, artist, album, trackNumber: number };
    });
}

async function readAudioMetadata(file) {
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer());
  let tags = parseId3Bytes(head);
  if (!Object.keys(tags).length && file.size >= 128) {
    tags = parseId3v1Bytes(new Uint8Array(await file.slice(file.size - 128).arrayBuffer()));
  }
  return {
    file,
    fileName: file.name,
    title: tags.title || cleanTrackTitle(file.name),
    artist: tags.artist || "",
    albumArtist: tags.albumArtist || "",
    album: tags.album || "",
    trackNumber: trackNumberFrom(tags.track, file.name),
  };
}

function decodeTextFrame(frame) {
  if (!frame.length) return "";
  const encoding = frame[0];
  const content = frame.slice(1);
  let value = "";
  if (encoding === 1) {
    const littleEndian = content[0] === 0xff && content[1] === 0xfe;
    const bigEndian = content[0] === 0xfe && content[1] === 0xff;
    const body = littleEndian || bigEndian ? content.slice(2) : content;
    value = new TextDecoder(bigEndian ? "utf-16be" : "utf-16le").decode(body);
  } else if (encoding === 2) {
    value = new TextDecoder("utf-16be").decode(content);
  } else {
    value = new TextDecoder(encoding === 3 ? "utf-8" : "windows-1252").decode(content);
  }
  return value.replace(/\0+/g, " / ").replace(/\s+\/\s+$/g, "").trim();
}

function ascii(bytes, offset, length) { return String.fromCharCode(...bytes.slice(offset, offset + length)); }
function uint32(bytes, offset) { return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0; }
function syncSafe(bytes, offset) { return (bytes[offset] << 21) | (bytes[offset + 1] << 14) | (bytes[offset + 2] << 7) | bytes[offset + 3]; }
function uint32Bytes(size) { return [(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff]; }
function syncSafeBytes(size) { return [(size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]; }

async function saveCorrectedFiles(items, rows, status) {
  if (typeof window.showDirectoryPicker !== "function") throw new Error("Η αποθήκευση φακέλου υποστηρίζεται από Chrome ή Edge.");
  const destination = await window.showDirectoryPicker({ mode: "readwrite" });
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  const folderName = `Διορθωμένα MP3 ${stamp}`;
  const outputDirectory = await destination.getDirectoryHandle(folderName, { create: true });
  for (let index = 0; index < rows.length; index += 1) {
    const item = items[index];
    const row = rows[index];
    status.textContent = `Αποθήκευση ${index + 1} από ${rows.length}: ${row.fileName}`;
    const corrected = rewriteMp3Bytes(new Uint8Array(await item.file.arrayBuffer()), row);
    const handle = await outputDirectory.getFileHandle(row.fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(corrected);
    await writable.close();
  }
  return folderName;
}

async function fetchDiscogsMatch(tool, items) {
  if (tool.dataset.discogsEnabled !== "1") return null;
  const artist = items.find((item) => item.albumArtist || item.artist)?.albumArtist || items.find((item) => item.artist)?.artist || "";
  const album = items.find((item) => item.album)?.album || "";
  if (!artist || !album) return null;
  const response = await fetch("/admin/discogs/tracklist", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ csrf: tool.dataset.csrf || "", artist, title: album }),
  });
  if (!response.ok) return null;
  return response.json();
}

function renderRows(tool, rows) {
  const body = tool.querySelector("[data-playlist-results]");
  const table = tool.querySelector(".playlist-results-wrap");
  body.replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    for (const value of [row.fileName, row.title, row.artist, row.album]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.appendChild(cell);
    }
    return tr;
  }));
  table.hidden = false;
}

function rowsAsText(rows) {
  return rows.map((row) => `Όνομα: ${row.fileName}\nΤίτλος: ${row.title}\nΚαλλιτέχνες που συμμετέχουν: ${row.artist}\nΆλμπουμ: ${row.album}`).join("\n\n");
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-playlist-metadata]").forEach((tool) => {
    const input = tool.querySelector("[data-playlist-files]");
    const analyze = tool.querySelector("[data-playlist-analyze]");
    const copy = tool.querySelector("[data-playlist-copy]");
    const save = tool.querySelector("[data-playlist-save]");
    const status = tool.querySelector("[data-playlist-status]");
    let currentRows = [];
    let currentItems = [];

    analyze.addEventListener("click", async () => {
      const files = [...(input.files || [])].filter((file) => /\.mp3$/i.test(file.name));
      if (!files.length) { status.textContent = "Επίλεξε πρώτα τα αρχεία της playlist."; return; }
      analyze.disabled = true;
      copy.disabled = true;
      save.disabled = true;
      status.textContent = `Ανάγνωση metadata από ${files.length} αρχεία…`;
      try {
        const items = await Promise.all(files.map(readAudioMetadata));
        status.textContent = "Έλεγχος ελληνικών στοιχείων στο Discogs…";
        const discogs = await fetchDiscogsMatch(tool, items).catch(() => null);
        currentRows = buildPlaylistRows(items, discogs);
        currentItems = [...items].sort((a, b) => (a.trackNumber || 9999) - (b.trackNumber || 9999) || a.fileName.localeCompare(b.fileName, "el"));
        renderRows(tool, currentRows);
        copy.disabled = false;
        save.disabled = false;
        status.textContent = `${currentRows.length} κομμάτια αναλύθηκαν${discogs ? " · βρέθηκαν ελληνικά στοιχεία στο Discogs" : " · έγινε μετατροπή Greeklish"}. Τα αρχεία δεν ανέβηκαν στον server.`;
      } catch {
        status.textContent = "Δεν ήταν δυνατή η ανάγνωση των metadata.";
      } finally {
        analyze.disabled = false;
      }
    });

    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(rowsAsText(currentRows));
      status.textContent = "Τα αποτελέσματα αντιγράφηκαν.";
    });

    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        const folderName = await saveCorrectedFiles(currentItems, currentRows, status);
        status.textContent = `Αποθηκεύτηκαν ${currentRows.length} αρχεία στον φάκελο «${folderName}». Τα αρχικά αρχεία έμειναν ανέπαφα.`;
      } catch (error) {
        if (error?.name !== "AbortError") status.textContent = error instanceof Error ? error.message : "Η αποθήκευση απέτυχε.";
      } finally {
        save.disabled = currentRows.length === 0;
      }
    });
  });
});
