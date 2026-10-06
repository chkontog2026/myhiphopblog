const DISC_HEADING = /^(?:(?:disc|disk|cd)\s*\d{0,2}(?:\s*[-–—:]\s*.+)?|.+\s+(?:disc|disk|cd))$/i;

export function discNumberFromPosition(value) {
  const position = String(value || "").trim();
  return Number(position.match(/^(?:disc|disk|cd)\s*(\d{1,2})(?:\D|$)/i)?.[1]
    || position.match(/^(\d{1,2})[-.:]\d+/)?.[1]
    || 0);
}

export function formatDiscogsTracklist(items) {
  const entries = flattenDiscogsEntries(items);
  const discNumbers = [...new Set(entries.map((entry) => entry.disc).filter(Boolean))];
  if (discNumbers.length < 2) return entries.map((entry) => entry.title).slice(0, 200);

  const lines = [];
  let currentDisc = 0;
  for (const entry of entries) {
    const disc = entry.disc || currentDisc || 1;
    if (disc !== currentDisc) {
      currentDisc = disc;
      const label = cleanDiscLabel(entry.heading);
      lines.push(`Disc ${disc}${label ? ` — ${label}` : ""}`);
    }
    lines.push(entry.title);
  }
  return lines.slice(0, 200);
}

export function isDiscHeading(value) {
  return DISC_HEADING.test(String(value || "").trim());
}

export function formatTracklistForEditor(tracks) {
  let trackNumber = 0;
  return (Array.isArray(tracks) ? tracks : []).map((track) => {
    if (isDiscHeading(track)) {
      trackNumber = 0;
      return String(track).trim();
    }
    trackNumber += 1;
    return `${trackNumber}. ${track}`;
  }).join("\n");
}

export function tracklistEditorFields(tracks) {
  const groups = tracklistGroups(tracks);
  const numbered = (items) => items.map((track, index) => `${index + 1}. ${track}`).join("\n");
  if (groups.length < 2 || !groups.some((group) => group.label)) {
    return { disc1: formatTracklistForEditor(tracks), disc2: "", disc1Label: "", disc2Label: "" };
  }
  return {
    disc1: numbered(groups[0]?.tracks || []),
    disc2: numbered(groups.slice(1).flatMap((group) => group.tracks)),
    disc1Label: cleanDiscLabel(groups[0]?.label),
    disc2Label: cleanDiscLabel(groups[1]?.label),
  };
}

export function combineTracklistDiscs(disc1Value, disc2Value, disc1Label = "", disc2Label = "") {
  const disc1 = parseEditorTrackLines(disc1Value);
  const disc2 = parseEditorTrackLines(disc2Value);
  if (!disc2.length) return disc1.slice(0, 200);
  const heading = (number, label) => {
    const cleanLabel = String(label || "").replace(/\s+/g, " ").trim();
    return `CD ${number}${cleanLabel ? ` — ${cleanLabel}` : ""}`;
  };
  return [heading(1, disc1Label), ...disc1, heading(2, disc2Label), ...disc2].slice(0, 200);
}

export function trackCount(tracks) {
  return (Array.isArray(tracks) ? tracks : []).filter((track) => !isDiscHeading(track)).length;
}

export function tracklistGroups(tracks) {
  const groups = [];
  let current = { label: "", tracks: [] };
  for (const value of Array.isArray(tracks) ? tracks : []) {
    const track = String(value || "").trim();
    if (!track) continue;
    if (isDiscHeading(track)) {
      if (current.tracks.length) groups.push(current);
      current = { label: track, tracks: [] };
    } else {
      current.tracks.push(track);
    }
  }
  if (current.label || current.tracks.length) groups.push(current);
  return groups;
}

function flattenDiscogsEntries(items, inheritedHeading = "") {
  const entries = [];
  let heading = inheritedHeading;
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.type_ === "heading" && String(item.title || "").trim()) {
      heading = String(item.title).trim();
    }
    if (item?.type_ === "track" && String(item.title || "").trim()) {
      entries.push({ title: String(item.title).trim(), disc: discNumberFromPosition(item.position), heading });
    }
    if (Array.isArray(item?.sub_tracks)) entries.push(...flattenDiscogsEntries(item.sub_tracks, heading));
  }
  return entries;
}

function cleanDiscLabel(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:disc|disk|cd)\s*\d*\s*[-–—:]?\s*/i, "")
    .replace(/\s+(?:disc|disk|cd)$/i, "")
    .trim();
}

function parseEditorTrackLines(value) {
  const lines = String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const hasNumberedLines = lines.some((line) => /^\d{1,3}[.)]\s*/.test(line));
  if (!hasNumberedLines) return lines;

  const tracks = [];
  for (const line of lines) {
    const numbered = line.match(/^\d{1,3}[.)]\s*(.*)$/);
    const content = (numbered?.[1] || line).trim();
    if (!content) continue;
    if (numbered || !tracks.length) {
      tracks.push(content);
    } else {
      tracks[tracks.length - 1] = `${tracks[tracks.length - 1]}\n${content}`;
    }
  }
  return tracks;
}
