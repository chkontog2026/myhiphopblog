import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  ownerEmail: text("owner_email"),
  blogTitle: text("blog_title").notNull().default("NEEDLE / DROP"),
  tagline: text("tagline").notNull().default("μουσική για κατέβασμα · νέα releases & παλιά αγαπημένα"),
  headerColor: text("header_color").notNull().default("#4e5e4a"),
  headerImageUrl: text("header_image_url").notNull().default(""),
  aboutTitle: text("about_title").notNull().default("Σχετικά"),
  aboutText: text("about_text").notNull().default("Μικρό ανεξάρτητο blog για μουσική, mixtapes και κυκλοφορίες που μοιράζονται ελεύθερα."),
  categoriesTitle: text("categories_title").notNull().default("Κατηγορίες"),
  archiveTitle: text("archive_title").notNull().default("Αρχείο"),
  linksTitle: text("links_title").notNull().default("Links"),
  homeLabel: text("home_label").notNull().default("Αρχική"),
  releasesLabel: text("releases_label").notNull().default("Κυκλοφορίες"),
  aboutLabel: text("about_label").notNull().default("Σχετικά"),
  contactLabel: text("contact_label").notNull().default("Επικοινωνία"),
  contactEmail: text("contact_email").notNull().default("hello@needledrop.gr"),
  instagramUrl: text("instagram_url").notNull().default(""),
  soundcloudUrl: text("soundcloud_url").notNull().default(""),
  footerText: text("footer_text").notNull().default("Powered By Codex"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const releases = sqliteTable("releases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  artist: text("artist").notNull(),
  title: text("title").notNull(),
  publishDate: text("publish_date").notNull(),
  releaseDate: text("release_date").notNull().default(""),
  genre: text("genre").notNull().default("Άλλο"),
  format: text("format").notNull().default("MP3"),
  description: text("description").notNull().default(""),
  youtubeUrl: text("youtube_url").notNull().default(""),
  coverUrl: text("cover_url").notNull().default(""),
  coverKey: text("cover_key").notNull().default(""),
  downloadUrl: text("download_url").notNull().default(""),
  downloadKey: text("download_key").notNull().default(""),
  downloadName: text("download_name").notNull().default(""),
  position: integer("position").notNull().default(0),
  published: integer("published", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("releases_date_idx").on(table.publishDate, table.position),
]);

export const tracks = sqliteTable("tracks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  releaseId: integer("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  position: integer("position").notNull().default(0),
  title: text("title").notNull(),
}, (table) => [
  index("tracks_release_idx").on(table.releaseId, table.position),
]);

export const newsletterSubscribers = sqliteTable("newsletter_subscribers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  subscribedAt: text("subscribed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
