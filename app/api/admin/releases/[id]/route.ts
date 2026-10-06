import { ensureCmsSchema, getD1 } from "../../../../../db/cms";
import { storeMedia } from "../../../../../db/media";
import { normalizeYouTubeUrl } from "../../../../../db/youtube";
import { errorResponse, formFile, formText, requireAdminApi } from "../../_auth";
import { replaceTracks, validateUploads } from "../route";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  try {
    await ensureCmsSchema();
    const id = Number((await context.params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "Μη έγκυρη ανάρτηση." }, { status: 400 });
    const db = getD1();
    const current = await db.prepare("SELECT cover_url, cover_key, download_url, download_key, download_name FROM releases WHERE id = ?")
      .bind(id).first<{ cover_url: string; cover_key: string; download_url: string; download_key: string; download_name: string }>();
    if (!current) return Response.json({ error: "Η ανάρτηση δεν βρέθηκε." }, { status: 404 });

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

    const externalCover = formText(form, "cover_url");
    const externalDownload = formText(form, "download_url");
    const coverUrl = formText(form, "remove_cover") === "1" ? "" : (coverMedia?.url || externalCover || current.cover_url);
    const downloadUrl = formText(form, "remove_download") === "1" ? "" : (downloadMedia?.url || externalDownload || current.download_url);
    const coverKey = coverMedia?.key || (coverUrl === current.cover_url ? current.cover_key : "");
    const downloadKey = downloadMedia?.key || (downloadUrl === current.download_url ? current.download_key : "");
    const downloadName = downloadMedia?.name || (downloadUrl === current.download_url ? current.download_name : "");
    const rawYouTubeUrl = formText(form, "youtube_url");
    const youtubeUrl = normalizeYouTubeUrl(rawYouTubeUrl);
    if (rawYouTubeUrl && !youtubeUrl) {
      return Response.json({ error: "Το YouTube URL δεν είναι έγκυρο link βίντεο." }, { status: 400 });
    }

    await db.prepare(`UPDATE releases SET
      artist = ?, title = ?, publish_date = ?, release_date = ?, genre = ?, format = ?, description = ?, youtube_url = ?,
      cover_url = ?, cover_key = ?, download_url = ?, download_key = ?, download_name = ?,
      position = ?, published = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(
        artist, title, publishDate, releaseYear(formText(form, "release_date")), formText(form, "genre") || "Άλλο", formText(form, "format") || "MP3",
        formText(form, "description"), youtubeUrl, coverUrl, coverKey, downloadUrl, downloadKey, downloadName,
        Number(formText(form, "position")) || 0, formText(form, "published") === "1" ? 1 : 0, id,
      ).run();
    await replaceTracks(id, formText(form, "tracks"));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function releaseYear(value: string) {
  return value.match(/(?:19|20)\d{2}/)?.[0] || "";
}

export async function DELETE(_request: Request, context: Context) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  try {
    await ensureCmsSchema();
    const id = Number((await context.params).id);
    if (!Number.isInteger(id)) return Response.json({ error: "Μη έγκυρη ανάρτηση." }, { status: 400 });
    const db = getD1();
    await db.batch([
      db.prepare("DELETE FROM tracks WHERE release_id = ?").bind(id),
      db.prepare("DELETE FROM releases WHERE id = ?").bind(id),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
