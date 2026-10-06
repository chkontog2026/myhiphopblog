import { env } from "cloudflare:workers";
import { requireAdminApi } from "../_auth";

type RuntimeEnv = { DISCOGS_TOKEN?: string };
type DiscogsArtist = { name?: string };
type DiscogsTrack = { type_?: string; title?: string; sub_tracks?: DiscogsTrack[] };
type DiscogsSearchResult = { id?: number | string; title?: string; year?: number | string };
type DiscogsSearchResponse = { results?: DiscogsSearchResult[] };
type DiscogsMaster = {
  artists?: DiscogsArtist[];
  main_release?: number | string;
  title?: string;
  tracklist?: DiscogsTrack[];
  year?: number | string;
};
type DiscogsRelease = {
  artists_sort?: string;
  released?: string;
  title?: string;
  tracklist?: DiscogsTrack[];
  year?: number | string;
};

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const body = await request.json() as { artist?: unknown; title?: unknown; year?: unknown };
    const artist = cleanText(body.artist);
    const title = cleanText(body.title);
    const requestedYear = releaseYear(body.year) || releaseYear(title);
    const cleanTitle = title.replace(/\s*[([](?:19|20)\d{2}[)\]]\s*$/, "").trim();
    if (!artist || !cleanTitle) {
      return Response.json({ error: "Συμπλήρωσε πρώτα καλλιτέχνη και τίτλο." }, { status: 400 });
    }

    const masterMatches = await searchDiscogs("master", artist, cleanTitle, requestedYear);
    for (const candidate of masterMatches.slice(0, 3)) {
      try {
        const id = Number(candidate.id);
        if (!id) continue;
        const master = await discogsRequest<DiscogsMaster>(`/masters/${id}`);
        let tracks = flattenTracks(master.tracklist);
        if (!tracks.length && Number(master.main_release)) {
          const mainRelease = await discogsRequest<DiscogsRelease>(`/releases/${Number(master.main_release)}`);
          tracks = flattenTracks(mainRelease.tracklist);
        }
        const matchedArtist = master.artists?.map((item) => cleanText(item.name)).filter(Boolean).join(", ") || artist;
        const matchedTitle = cleanText(master.title) || cleanTitle;
        const year = releaseYear(master.year) || releaseYear(candidate.year) || requestedYear;
        return Response.json({
          artist: matchedArtist,
          title: matchedTitle,
          releaseDate: year,
          tracks: tracks.slice(0, 200),
          match: { title: `${matchedArtist} — ${matchedTitle}`, year, url: `https://www.discogs.com/master/${id}` },
        });
      } catch {}
    }

    const releaseMatches = await searchDiscogs("release", artist, cleanTitle, requestedYear);
    for (const candidate of releaseMatches.slice(0, 5)) {
      try {
        const id = Number(candidate.id);
        if (!id) continue;
        const release = await discogsRequest<DiscogsRelease>(`/releases/${id}`);
        const matchedArtist = cleanText(release.artists_sort) || artist;
        const matchedTitle = cleanText(release.title) || cleanTitle;
        const year = releaseYear(release.released) || releaseYear(release.year) || releaseYear(candidate.year) || requestedYear;
        return Response.json({
          artist: matchedArtist,
          title: matchedTitle,
          releaseDate: year,
          tracks: flattenTracks(release.tracklist).slice(0, 200),
          match: { title: `${matchedArtist} — ${matchedTitle}`, year, url: `https://www.discogs.com/release/${id}` },
        });
      } catch {}
    }

    return Response.json({ error: "Δεν βρέθηκε σχετική κυκλοφορία στο Discogs." }, { status: 404 });
  } catch (error) {
    console.warn("Discogs lookup failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Το Discogs δεν απάντησε. Δοκίμασε ξανά σε λίγο." }, { status: 502 });
  }
}

async function searchDiscogs(type: "master" | "release", artist: string, title: string, year: string) {
  const normalizedTitle = normalizeDiscogsSearchText(title);
  const exact = new URLSearchParams({ type, artist, release_title: title, per_page: "10" });
  if (year) exact.set("year", year);
  let response = await discogsRequest<DiscogsSearchResponse>(`/database/search?${exact}`);
  let matches = response.results?.filter((item) => Number(item.id)) ?? [];
  if (!matches.length) {
    const broad = new URLSearchParams({ type, q: `${artist} ${title}`, per_page: "10" });
    if (year) broad.set("year", year);
    response = await discogsRequest<DiscogsSearchResponse>(`/database/search?${broad}`);
    matches = response.results?.filter((item) => Number(item.id)) ?? [];
  }
  if (!matches.some((item) => normalizeDiscogsSearchText(item.title).includes(normalizedTitle))) {
    const artistOnly = new URLSearchParams({ type, q: artist, per_page: "50" });
    if (year) artistOnly.set("year", year);
    response = await discogsRequest<DiscogsSearchResponse>(`/database/search?${artistOnly}`);
    const titleMatches = (response.results ?? []).filter((item) =>
      Number(item.id) && normalizeDiscogsSearchText(item.title).includes(normalizedTitle)
    );
    if (titleMatches.length) matches = titleMatches;
  }
  return matches;
}

async function discogsRequest<T>(endpoint: string): Promise<T> {
  const token = cleanText((env as unknown as RuntimeEnv).DISCOGS_TOKEN);
  const headers: Record<string, string> = {
    Accept: "application/vnd.discogs.v2.discogs+json",
    "User-Agent": "NeedleDropBlog/1.0",
  };
  if (token) headers.Authorization = `Discogs token=${token}`;
  const response = await fetch(`https://api.discogs.com${endpoint}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Discogs HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function flattenTracks(items: DiscogsTrack[] | undefined): string[] {
  const tracks: string[] = [];
  for (const item of items ?? []) {
    if (item.type_ === "track" && cleanText(item.title)) tracks.push(cleanText(item.title));
    if (item.sub_tracks?.length) tracks.push(...flattenTracks(item.sub_tracks));
  }
  return tracks;
}

function releaseYear(value: unknown) {
  return cleanText(value).match(/(?:19|20)\d{2}/)?.[0] || "";
}

function cleanText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeDiscogsSearchText(value: unknown) {
  return cleanText(value)
    .toLocaleLowerCase("el-GR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ς/g, "σ")
    .replace(/[^a-z0-9α-ω]+/gu, " ")
    .trim();
}
