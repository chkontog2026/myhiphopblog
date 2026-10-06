export function parseYouTubeMetadata(videoTitle, authorName, publishedYear = "") {
  let cleanTitle = String(videoTitle || "").trim();
  cleanTitle = cleanTitle
    .replace(/\s*[([](?:official(?: music)? video|official audio|video clip|audio|lyrics?)[)\]]\s*$/i, "")
    .trim();
  const explicitYear = cleanTitle.match(/[([]((?:19|20)\d{2})[)\]]\s*$/)?.[1] || "";
  if (explicitYear) cleanTitle = cleanTitle.replace(/\s*[([](?:19|20)\d{2}[)\]]\s*$/, "").trim();

  const separator = cleanTitle.match(/\s+(?:-|–|—|\|)\s+/);
  const fallbackArtist = String(authorName || "").replace(/\s+-\s+Topic$/i, "").trim();
  if (!separator || separator.index === undefined) {
    return { artist: fallbackArtist, title: cleanTitle, releaseDate: explicitYear || String(publishedYear || "") };
  }

  return {
    artist: cleanTitle.slice(0, separator.index).trim() || fallbackArtist,
    title: cleanTitle.slice(separator.index + separator[0].length).trim(),
    releaseDate: explicitYear || String(publishedYear || ""),
  };
}

export function extractYouTubePublishedYear(html) {
  return String(html || "").match(/\\?"(?:publishDate|uploadDate)\\?"\s*:\s*\\?"((?:19|20)\d{2})-\d{2}-\d{2}/)?.[1] || "";
}
