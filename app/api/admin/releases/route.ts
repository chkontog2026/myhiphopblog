import { ensureCmsSchema, getD1, makeSlug } from "../../../../db/cms";
import { storeMedia } from "../../../../db/media";
import { normalizeYouTubeUrl } from "../../../../db/youtube";
import { errorResponse, formFile, formText, requireAdminApi } from "../_auth";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  try {
    await ensureCmsSchema();
    const form = await request.formData();
    const artist = formText(form, "artist");
    const title = formText(form, "title");
    const publishDate = formText(form, "publish_date");
    if (!artist || !title || !publishDate) {
      return Response.json({ error: "Καλλιτέχνης, τίτλος και ημερομηνία είναι υποχρεωτικά." }, { status: 400 });
    }

    const cover = formFile(form, "cover");
    const download = formFile(form, "download_file");
    const validation = validateUploads(cover, download);
    if (validation) return validation;

    const coverMedia = cover ? await storeMedia(cover, "covers") : null;
    const downloadMedia = download ? await storeMedia(download, "downloads") : null;
    const coverUrl = coverMedia?.url || formText(form, "cover_url");
    const downloadUrl = downloadMedia?.url || formText(form, "download_url");
    const rawYouTubeUrl = formText(form, "youtube_url");
    const youtubeUrl = normalizeYouTubeUrl(rawYouTubeUrl);
    if (rawYouTubeUrl && !youtubeUrl) {
      return Response.json({ error: "Το YouTube URL δεν είναι έγκυρο link βίντεο." }, { status: 400 });
    }
    const db = getD1();
    const result = await db.prepare(`INSERT INTO releases (
      slug, artist, title, publish_date, release_date, genre, format, description, youtube_url,
      cover_url, cover_key, download_url, download_key, download_name, position, published
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        makeSlug(artist, title), artist, title, publishDate, releaseYear(formText(form, "release_date")), formText(form, "genre") || "Άλλο",
        formText(form, "format") || "MP3", formText(form, "description"), youtubeUrl,
        coverUrl, coverMedia?.key || "", downloadUrl, downloadMedia?.key || "",
        downloadMedia?.name || "", Number(formText(form, "position")) || 0,
        formText(form, "published") === "1" ? 1 : 0,
      ).run();
    const releaseId = Number(result.meta.last_row_id);
    await replaceTracks(releaseId, formText(form, "tracks"));
    return Response.json({ ok: true, id: releaseId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function releaseYear(value: string) {
  return value.match(/(?:19|20)\d{2}/)?.[0] || "";
}

export async function replaceTracks(releaseId: number, trackText: string) {
  const db = getD1();
  const tracks = trackText.split(/\r?\n/).map((track) => track.trim()).filter(Boolean).slice(0, 200);
  const statements = [db.prepare("DELETE FROM tracks WHERE release_id = ?").bind(releaseId)];
  tracks.forEach((track, index) => {
    statements.push(db.prepare("INSERT INTO tracks (release_id, position, title) VALUES (?, ?, ?)").bind(releaseId, index, track));
  });
  await db.batch(statements);
}

export function validateUploads(cover: File | null, download: File | null) {
  if (cover && (!imageTypes.has(cover.type) || cover.size > 12 * 1024 * 1024)) {
    return Response.json({ error: "Το εξώφυλλο πρέπει να είναι JPG, PNG, WEBP ή GIF έως 12 MB." }, { status: 400 });
  }
  if (download && download.size > 100 * 1024 * 1024) {
    return Response.json({ error: "Το αρχείο μουσικής πρέπει να είναι έως 100 MB. Για μεγαλύτερο αρχείο χρησιμοποίησε εξωτερικό link." }, { status: 400 });
  }
  return null;
}
