import { env } from "cloudflare:workers";

type RuntimeEnv = { DB?: D1Database };

export type SiteSettings = {
  ownerEmail: string;
  blogTitle: string;
  tagline: string;
  headerColor: string;
  headerImageUrl: string;
  aboutTitle: string;
  aboutText: string;
  categoriesTitle: string;
  archiveTitle: string;
  linksTitle: string;
  homeLabel: string;
  releasesLabel: string;
  aboutLabel: string;
  contactLabel: string;
  contactEmail: string;
  instagramUrl: string;
  soundcloudUrl: string;
  footerText: string;
};

export type CmsRelease = {
  id: number;
  slug: string;
  artist: string;
  title: string;
  publishDate: string;
  releaseDate: string;
  genre: string;
  format: string;
  description: string;
  youtubeUrl: string;
  coverUrl: string;
  coverKey: string;
  downloadUrl: string;
  downloadKey: string;
  downloadName: string;
  position: number;
  published: boolean;
  tracks: string[];
};

export type CmsContent = { settings: SiteSettings; releases: CmsRelease[] };

type SettingRow = {
  owner_email: string | null;
  blog_title: string;
  tagline: string;
  header_color: string;
  header_image_url: string;
  about_title: string;
  about_text: string;
  categories_title: string;
  archive_title: string;
  links_title: string;
  home_label: string;
  releases_label: string;
  about_label: string;
  contact_label: string;
  contact_email: string;
  instagram_url: string;
  soundcloud_url: string;
  footer_text: string;
};

type ReleaseRow = {
  id: number;
  slug: string;
  artist: string;
  title: string;
  publish_date: string;
  release_date: string;
  genre: string;
  format: string;
  description: string;
  youtube_url: string;
  cover_url: string;
  cover_key: string;
  download_url: string;
  download_key: string;
  download_name: string;
  position: number;
  published: number;
};

type TrackRow = { release_id: number; position: number; title: string };

const defaultSettings: SiteSettings = {
  ownerEmail: "",
  blogTitle: "NEEDLE / DROP",
  tagline: "μουσική για κατέβασμα · νέα releases & παλιά αγαπημένα",
  headerColor: "#4e5e4a",
  headerImageUrl: "",
  aboutTitle: "Σχετικά",
  aboutText: "Μικρό ανεξάρτητο blog για μουσική, mixtapes και κυκλοφορίες που μοιράζονται ελεύθερα.",
  categoriesTitle: "Κατηγορίες",
  archiveTitle: "Αρχείο",
  linksTitle: "Links",
  homeLabel: "Αρχική",
  releasesLabel: "Κυκλοφορίες",
  aboutLabel: "Σχετικά",
  contactLabel: "Επικοινωνία",
  contactEmail: "hello@needledrop.gr",
  instagramUrl: "",
  soundcloudUrl: "",
  footerText: "Powered By Codex",
};

const seedReleases = [
  {
    slug: "after-midnight",
    artist: "Nefeli K.",
    title: "After Midnight",
    publishDate: "2026-07-29",
    genre: "Electronic",
    format: "EP · MP3 / FLAC · 128 MB",
    description: "Τέσσερα κομμάτια με αναλογικά synths και νυχτερινά beats.",
    coverUrl: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=800&q=85",
    tracks: ["Night Drive", "Neon Rain", "No Signal", "After Midnight"],
  },
  {
    slug: "soft-static",
    artist: "Polaroid Days",
    title: "Soft Static",
    publishDate: "2026-07-20",
    genre: "Indie",
    format: "Album · MP3 · 92 MB",
    description: "Lo-fi κιθάρες, ήσυχα φωνητικά και πέντε τραγούδια για το τέλος του καλοκαιριού.",
    coverUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=85",
    tracks: ["Summer Ends", "Half Awake", "Soft Static", "Stay a Little", "Last Frame"],
  },
  {
    slug: "blue-room",
    artist: "Low Tides",
    title: "Blue Room Sessions",
    publishDate: "2026-07-10",
    genre: "Ambient",
    format: "Live · FLAC · 174 MB",
    description: "Ζωντανή ηχογράφηση, χωρίς edits. Ακουστικά ιδανικά μετά τα μεσάνυχτα.",
    coverUrl: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=85",
    tracks: ["Open Water", "Blue Room", "Slow Current", "Dawn Tape"],
  },
];

let schemaPromise: Promise<void> | null = null;

export function getD1(): D1Database {
  const db = (env as unknown as RuntimeEnv).DB;
  if (!db) throw new Error("Το CMS δεν έχει συνδεθεί ακόμη με τη βάση δεδομένων.");
  return db;
}

export async function ensureCmsSchema() {
  schemaPromise ??= initializeSchema().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function initializeSchema() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY,
      owner_email TEXT,
      blog_title TEXT NOT NULL DEFAULT 'NEEDLE / DROP',
      tagline TEXT NOT NULL DEFAULT '',
      header_color TEXT NOT NULL DEFAULT '#4e5e4a',
      header_image_url TEXT NOT NULL DEFAULT '',
      about_title TEXT NOT NULL DEFAULT 'Σχετικά',
      about_text TEXT NOT NULL DEFAULT '',
      categories_title TEXT NOT NULL DEFAULT 'Κατηγορίες',
      archive_title TEXT NOT NULL DEFAULT 'Αρχείο',
      links_title TEXT NOT NULL DEFAULT 'Links',
      home_label TEXT NOT NULL DEFAULT 'Αρχική',
      releases_label TEXT NOT NULL DEFAULT 'Κυκλοφορίες',
      about_label TEXT NOT NULL DEFAULT 'Σχετικά',
      contact_label TEXT NOT NULL DEFAULT 'Επικοινωνία',
      contact_email TEXT NOT NULL DEFAULT '',
      instagram_url TEXT NOT NULL DEFAULT '',
      soundcloud_url TEXT NOT NULL DEFAULT '',
      footer_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      artist TEXT NOT NULL,
      title TEXT NOT NULL,
      publish_date TEXT NOT NULL,
      release_date TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT 'Άλλο',
      format TEXT NOT NULL DEFAULT 'MP3',
      description TEXT NOT NULL DEFAULT '',
      youtube_url TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      cover_key TEXT NOT NULL DEFAULT '',
      download_url TEXT NOT NULL DEFAULT '',
      download_key TEXT NOT NULL DEFAULT '',
      download_name TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      release_id INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS releases_date_idx ON releases (publish_date DESC, position ASC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS tracks_release_idx ON tracks (release_id, position ASC)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
  ]);

  const releaseColumns = await db.prepare("PRAGMA table_info(releases)").all<{ name: string }>();
  if (!releaseColumns.results.some((column) => column.name === "release_date")) {
    await db.prepare("ALTER TABLE releases ADD COLUMN release_date TEXT NOT NULL DEFAULT ''").run();
  }
  if (!releaseColumns.results.some((column) => column.name === "youtube_url")) {
    await db.prepare("ALTER TABLE releases ADD COLUMN youtube_url TEXT NOT NULL DEFAULT ''").run();
  }

  await db.prepare(`INSERT OR IGNORE INTO site_settings (
    id, blog_title, tagline, header_color, about_title, about_text,
    categories_title, archive_title, links_title, home_label, releases_label,
    about_label, contact_label, contact_email, footer_text
  ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      defaultSettings.blogTitle, defaultSettings.tagline, defaultSettings.headerColor,
      defaultSettings.aboutTitle, defaultSettings.aboutText, defaultSettings.categoriesTitle,
      defaultSettings.archiveTitle, defaultSettings.linksTitle, defaultSettings.homeLabel,
      defaultSettings.releasesLabel, defaultSettings.aboutLabel, defaultSettings.contactLabel,
      defaultSettings.contactEmail, defaultSettings.footerText,
    ).run();

  await db.prepare(`UPDATE site_settings
    SET footer_text = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1 AND footer_text IN (?, ?)`)
    .bind("Powered By Codex", "NEEDLE / DROP · 2026", "MY HIP HOP BLOG · 2026")
    .run();

  const count = await db.prepare("SELECT COUNT(*) AS total FROM releases").first<{ total: number }>();
  if ((count?.total ?? 0) === 0) {
    for (let index = 0; index < seedReleases.length; index += 1) {
      const release = seedReleases[index];
      const result = await db.prepare(`INSERT INTO releases (
        slug, artist, title, publish_date, genre, format, description, cover_url, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(release.slug, release.artist, release.title, release.publishDate, release.genre,
          release.format, release.description, release.coverUrl, index)
        .run();
      const releaseId = Number(result.meta.last_row_id);
      await db.batch(release.tracks.map((track, trackIndex) =>
        db.prepare("INSERT INTO tracks (release_id, position, title) VALUES (?, ?, ?)")
          .bind(releaseId, trackIndex, track),
      ));
    }
  }
}

export async function getCmsContent(includeDrafts = false): Promise<CmsContent> {
  await ensureCmsSchema();
  const db = getD1();
  const settingsRow = await db.prepare("SELECT * FROM site_settings WHERE id = 1").first<SettingRow>();
  const releaseQuery = includeDrafts
    ? "SELECT * FROM releases ORDER BY publish_date DESC, position ASC, id DESC"
    : "SELECT * FROM releases WHERE published = 1 ORDER BY publish_date DESC, position ASC, id DESC";
  const [releaseResult, trackResult] = await Promise.all([
    db.prepare(releaseQuery).all<ReleaseRow>(),
    db.prepare("SELECT release_id, position, title FROM tracks ORDER BY release_id, position ASC, id ASC").all<TrackRow>(),
  ]);
  const tracksByRelease = new Map<number, string[]>();
  for (const track of trackResult.results) {
    const list = tracksByRelease.get(track.release_id) ?? [];
    list.push(track.title);
    tracksByRelease.set(track.release_id, list);
  }

  return {
    settings: mapSettings(settingsRow),
    releases: releaseResult.results.map((row) => ({
      id: row.id,
      slug: row.slug,
      artist: row.artist,
      title: row.title,
      publishDate: row.publish_date,
      releaseDate: row.release_date,
      genre: row.genre,
      format: row.format,
      description: row.description,
      youtubeUrl: row.youtube_url,
      coverUrl: row.cover_url,
      coverKey: row.cover_key,
      downloadUrl: row.download_url,
      downloadKey: row.download_key,
      downloadName: row.download_name,
      position: row.position,
      published: Boolean(row.published),
      tracks: tracksByRelease.get(row.id) ?? [],
    })),
  };
}

export async function claimAdmin(email: string) {
  await ensureCmsSchema();
  const db = getD1();
  await db.prepare("UPDATE site_settings SET owner_email = ? WHERE id = 1 AND (owner_email IS NULL OR owner_email = '')")
    .bind(email.toLowerCase()).run();
  const row = await db.prepare("SELECT owner_email FROM site_settings WHERE id = 1").first<{ owner_email: string | null }>();
  return row?.owner_email?.toLowerCase() === email.toLowerCase();
}

function mapSettings(row: SettingRow | null): SiteSettings {
  if (!row) return defaultSettings;
  return {
    ownerEmail: row.owner_email ?? "",
    blogTitle: row.blog_title,
    tagline: row.tagline,
    headerColor: row.header_color,
    headerImageUrl: row.header_image_url,
    aboutTitle: row.about_title,
    aboutText: row.about_text,
    categoriesTitle: row.categories_title,
    archiveTitle: row.archive_title,
    linksTitle: row.links_title,
    homeLabel: row.home_label,
    releasesLabel: row.releases_label,
    aboutLabel: row.about_label,
    contactLabel: row.contact_label,
    contactEmail: row.contact_email,
    instagramUrl: row.instagram_url,
    soundcloudUrl: row.soundcloud_url,
    footerText: row.footer_text,
  };
}

export function makeSlug(artist: string, title: string) {
  const base = `${artist}-${title}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "release"}-${Date.now().toString(36)}`;
}
