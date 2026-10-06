const SPOTIFY_HOSTS = new Set(["open.spotify.com", "www.open.spotify.com"]);
const SPOTIFY_TYPES = new Set(["track", "album", "playlist", "artist", "show", "episode"]);
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export function spotifyResource(value) {
  const input = String(value || "").trim();
  if (!input) return null;

  try {
    const url = new URL(input);
    if (!SPOTIFY_HOSTS.has(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const type = parts[0]?.toLowerCase() || "";
    const id = parts[1] || "";
    if (!SPOTIFY_TYPES.has(type) || !SPOTIFY_ID.test(id) || parts.length !== 2) return null;
    return { type, id };
  } catch {
    return null;
  }
}

export function normalizeSpotifyUrl(value) {
  const resource = spotifyResource(value);
  return resource ? `https://open.spotify.com/${resource.type}/${resource.id}` : "";
}

export function spotifyEmbedUrl(value) {
  const resource = spotifyResource(value);
  return resource ? `https://open.spotify.com/embed/${resource.type}/${resource.id}?utm_source=generator` : "";
}
