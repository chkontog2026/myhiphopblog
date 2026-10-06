"use client";

import { ChangeEvent, FormEvent, useState } from "react";
import type { CmsContent, CmsRelease } from "../../db/cms";

type Props = {
  initialContent: CmsContent;
  userEmail: string;
  signOutUrl: string;
};

type ReleaseDraft = {
  id?: number;
  artist: string;
  title: string;
  publishDate: string;
  releaseDate: string;
  genre: string;
  format: string;
  description: string;
  youtubeUrl: string;
  coverUrl: string;
  downloadUrl: string;
  position: number;
  published: boolean;
  tracksText: string;
};

const emptyDraft = (): ReleaseDraft => ({
  artist: "",
  title: "",
  publishDate: new Date().toISOString().slice(0, 10),
  releaseDate: "",
  genre: "",
  format: "MP3",
  description: "",
  youtubeUrl: "",
  coverUrl: "",
  downloadUrl: "",
  position: 0,
  published: true,
  tracksText: "",
});

function draftFromRelease(release: CmsRelease): ReleaseDraft {
  return {
    id: release.id,
    artist: release.artist,
    title: release.title,
    publishDate: release.publishDate,
    releaseDate: release.releaseDate,
    genre: release.genre,
    format: release.format,
    description: release.description,
    youtubeUrl: release.youtubeUrl,
    coverUrl: release.coverUrl,
    downloadUrl: release.downloadUrl.startsWith("/media/") ? "" : release.downloadUrl,
    position: release.position,
    published: release.published,
    tracksText: release.tracks.join("\n"),
  };
}

type UploadResponse = { error?: string };
type DiscogsResponse = {
  artist?: string;
  title?: string;
  releaseDate?: string;
  tracks?: string[];
  match?: { title?: string; year?: string; url?: string };
  error?: string;
};

function submitFormWithProgress(
  url: string,
  method: "POST" | "PUT",
  form: HTMLFormElement,
  onProgress: (value: number) => void,
) {
  return new Promise<{ ok: boolean; payload: UploadResponse }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      let payload: UploadResponse = {};
      try { payload = JSON.parse(request.responseText) as UploadResponse; } catch {}
      resolve({ ok: request.status >= 200 && request.status < 300, payload });
    });
    request.addEventListener("error", () => reject(new Error("Η σύνδεση διακόπηκε κατά το ανέβασμα.")));
    request.send(new FormData(form));
  });
}

function formHasFile(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .some((input) => Boolean(input.files?.length));
}

function parseReleaseFilename(filename: string) {
  const withoutExtension = filename.replace(/\.(?:zip|rar|7z|flac|mp3|m4a|aac|wav|ogg)$/i, "").trim();
  const yearMatch = withoutExtension.match(/\s*(?:\(((?:19|20)\d{2})\)|\[((?:19|20)\d{2})\]|((?:19|20)\d{2}))\s*$/);
  const year = yearMatch ? yearMatch.slice(1).find(Boolean) || "" : "";
  const releaseName = yearMatch ? withoutExtension.slice(0, yearMatch.index).trim() : withoutExtension;
  const separator = releaseName.match(/\s+(?:-|–|—)\s+/);
  if (!separator || separator.index === undefined) return null;
  const artist = releaseName.slice(0, separator.index).trim();
  const title = releaseName.slice(separator.index + separator[0].length).trim();
  return artist && title ? { artist, title, year } : null;
}

function formField<T extends HTMLInputElement | HTMLTextAreaElement>(form: HTMLFormElement, name: string) {
  return form.elements.namedItem(name) as T | null;
}

export default function AdminPanel({ initialContent, userEmail, signOutUrl }: Props) {
  const [content, setContent] = useState(initialContent);
  const [tab, setTab] = useState<"posts" | "settings">("posts");
  const [draft, setDraft] = useState<ReleaseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [discogsBusy, setDiscogsBusy] = useState(false);
  const [discogsMessage, setDiscogsMessage] = useState("");

  async function lookupDiscogs(form: HTMLFormElement) {
    const artistInput = formField<HTMLInputElement>(form, "artist");
    const titleInput = formField<HTMLInputElement>(form, "title");
    const yearInput = formField<HTMLInputElement>(form, "release_date");
    const tracksInput = formField<HTMLTextAreaElement>(form, "tracks");
    const artist = artistInput?.value.trim() || "";
    const title = titleInput?.value.trim() || "";
    if (!artist || !title) {
      setDiscogsMessage("Συμπλήρωσε πρώτα καλλιτέχνη και τίτλο.");
      return;
    }

    setDiscogsBusy(true);
    setDiscogsMessage("Αναζήτηση στο Discogs…");
    try {
      const response = await fetch("/api/admin/discogs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ artist, title, year: yearInput?.value || "" }),
      });
      const payload = await response.json() as DiscogsResponse;
      if (!response.ok) throw new Error(payload.error || "Δεν βρέθηκε η κυκλοφορία.");
      if (artistInput && payload.artist) artistInput.value = payload.artist;
      if (titleInput && payload.title) titleInput.value = payload.title;
      if (yearInput && payload.releaseDate) yearInput.value = payload.releaseDate;
      if (tracksInput && payload.tracks?.length) tracksInput.value = payload.tracks.join("\n");
      const year = payload.releaseDate ? ` (${payload.releaseDate})` : "";
      const trackCount = payload.tracks?.length ? ` · ${payload.tracks.length} κομμάτια` : "";
      setDiscogsMessage(`Βρέθηκε: ${payload.match?.title || `${payload.artist} — ${payload.title}`}${year}${trackCount}`);
    } catch (error) {
      setDiscogsMessage(error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.");
    } finally {
      setDiscogsBusy(false);
    }
  }

  async function readDownloadFilename(event: ChangeEvent<HTMLInputElement>) {
    const form = event.currentTarget.form;
    const parsed = parseReleaseFilename(event.currentTarget.files?.[0]?.name || "");
    if (!form || !parsed) return;
    const artistInput = formField<HTMLInputElement>(form, "artist");
    const titleInput = formField<HTMLInputElement>(form, "title");
    const yearInput = formField<HTMLInputElement>(form, "release_date");
    if (artistInput) artistInput.value = parsed.artist;
    if (titleInput) titleInput.value = parsed.title;
    if (yearInput && parsed.year) yearInput.value = parsed.year;
    setDiscogsMessage("Το όνομα του αρχείου αναγνωρίστηκε. Αναζήτηση στο Discogs…");
    await lookupDiscogs(form);
  }

  async function refreshContent() {
    const response = await fetch("/api/admin/content", { cache: "no-store" });
    const payload = await response.json() as { content?: CmsContent; error?: string };
    if (!response.ok || !payload.content) throw new Error(payload.error || "Αποτυχία ανανέωσης.");
    setContent(payload.content);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const hasFile = formHasFile(form);
    setBusy(true);
    setMessage("");
    setUploadProgress(hasFile ? 0 : null);
    try {
      const response = await submitFormWithProgress("/api/admin/settings", "PUT", form, (value) => {
        if (hasFile) setUploadProgress(value);
      });
      if (!response.ok) throw new Error(response.payload.error || "Δεν αποθηκεύτηκαν οι αλλαγές.");
      if (hasFile) setUploadProgress(100);
      await refreshContent();
      setMessage("Οι ρυθμίσεις αποθηκεύτηκαν.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  async function saveRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const form = event.currentTarget;
    const hasFile = formHasFile(form);
    setBusy(true);
    setMessage("");
    setUploadProgress(hasFile ? 0 : null);
    try {
      const url = draft.id ? `/api/admin/releases/${draft.id}` : "/api/admin/releases";
      const response = await submitFormWithProgress(url, draft.id ? "PUT" : "POST", form, (value) => {
        if (hasFile) setUploadProgress(value);
      });
      if (!response.ok) throw new Error(response.payload.error || "Δεν αποθηκεύτηκε η ανάρτηση.");
      if (hasFile) setUploadProgress(100);
      await refreshContent();
      setDraft(null);
      setMessage("Η ανάρτηση αποθηκεύτηκε.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.");
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }

  async function deleteRelease(release: CmsRelease) {
    if (!window.confirm(`Να διαγραφεί το «${release.title}»;`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/releases/${release.id}`, { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Δεν διαγράφηκε η ανάρτηση.");
      await refreshContent();
      setMessage("Η ανάρτηση διαγράφηκε.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p>NEEDLE / DROP</p>
          <h1>Διαχείριση blog</h1>
        </div>
        <nav>
          <a href="/" target="_blank">Προβολή blog ↗</a>
          <a href={signOutUrl}>Αποσύνδεση</a>
        </nav>
      </header>

      <div className="admin-user">Συνδεδεμένος ως {userEmail}</div>

      <div className="admin-tabs">
        <button className={tab === "posts" ? "active" : ""} onClick={() => setTab("posts")} type="button">Αναρτήσεις</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")} type="button">Κείμενα &amp; header</button>
      </div>

      {message && <p className="admin-message" role="status">{message}</p>}
      {uploadProgress !== null && (
        <div className="upload-progress" role="status" aria-live="polite">
          <div className="upload-progress-label"><span>Ανέβασμα αρχείου…</span><b>{uploadProgress}%</b></div>
          <progress max={100} value={uploadProgress}>{uploadProgress}%</progress>
        </div>
      )}

      {tab === "posts" && (
        <section className="admin-section">
          <div className="admin-section-heading">
            <div><h2>Αναρτήσεις</h2><p>{content.releases.length} συνολικά</p></div>
            <button className="admin-primary" type="button" onClick={() => { setDraft(emptyDraft()); setDiscogsMessage(""); }}>+ Νέα ανάρτηση</button>
          </div>

          {draft && (
            <form className="admin-card release-editor" onSubmit={saveRelease} key={draft.id ?? "new"}>
              <div className="editor-heading">
                <h3>{draft.id ? "Επεξεργασία ανάρτησης" : "Νέα ανάρτηση"}</h3>
                <button type="button" className="text-button" onClick={() => setDraft(null)}>Κλείσιμο ×</button>
              </div>
              <div className="admin-grid two">
                <label>Καλλιτέχνης<input name="artist" required defaultValue={draft.artist} /></label>
                <label>Τίτλος<input name="title" required defaultValue={draft.title} /></label>
                <label>Ημερομηνία<input name="publish_date" type="date" required defaultValue={draft.publishDate} /></label>
                <label>Χρονολογία κυκλοφορίας<input name="release_date" type="number" min="1900" max="2099" defaultValue={draft.releaseDate} placeholder="π.χ. 1994" /></label>
                <label>Είδος<input name="genre" required defaultValue={draft.genre} placeholder="π.χ. Electronic" /></label>
                <label>Μορφή / μέγεθος<input name="format" defaultValue={draft.format} placeholder="π.χ. MP3 · 80 MB" /></label>
                <label>Σειρά εμφάνισης<input name="position" type="number" defaultValue={draft.position} /></label>
              </div>
              <label>Περιγραφή<textarea name="description" rows={4} defaultValue={draft.description} /></label>
              <label>YouTube video <small>προαιρετικό — κανονικό link, youtu.be, Short ή Live</small><input name="youtube_url" type="url" defaultValue={draft.youtubeUrl} placeholder="https://www.youtube.com/watch?v=..." /></label>
              <div className="admin-discogs-tools">
                <button type="button" disabled={discogsBusy} onClick={(event) => event.currentTarget.form && void lookupDiscogs(event.currentTarget.form)}>
                  {discogsBusy ? "Αναζήτηση…" : "Συμπλήρωση στοιχείων & tracklist από Discogs"}
                </button>
                {discogsMessage && <span role="status" aria-live="polite">{discogsMessage}</span>}
              </div>
              <label>Tracklist <small>ένα τραγούδι ανά γραμμή</small><textarea name="tracks" rows={7} defaultValue={draft.tracksText} /></label>
              <div className="admin-grid two uploads-grid">
                <label>Εξώφυλλο<input name="cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
                <label>ή URL εξωφύλλου<input name="cover_url" type="url" defaultValue={draft.coverUrl.startsWith("http") ? draft.coverUrl : ""} placeholder="https://..." /></label>
                <label>Αρχείο μουσικής / ZIP<input name="download_file" type="file" accept="audio/*,.zip,.rar,.7z,.flac" onChange={(event) => void readDownloadFilename(event)} /></label>
                <label>ή εξωτερικό download link<input name="download_url" type="url" defaultValue={draft.downloadUrl} placeholder="https://..." /></label>
              </div>
              {draft.id && (
                <div className="inline-checks">
                  <label className="check-label"><input name="remove_cover" type="checkbox" value="1" /> Αφαίρεση εξωφύλλου</label>
                  <label className="check-label"><input name="remove_download" type="checkbox" value="1" /> Αφαίρεση download</label>
                </div>
              )}
              <label className="check-label"><input name="published" type="checkbox" value="1" defaultChecked={draft.published} /> Δημοσιευμένη</label>
              <div className="admin-form-actions">
                <button className="admin-primary" type="submit" disabled={busy}>{busy ? "Αποθήκευση..." : "Αποθήκευση"}</button>
                <button type="button" onClick={() => setDraft(null)}>Ακύρωση</button>
              </div>
            </form>
          )}

          <div className="admin-release-list">
            {content.releases.map((release) => (
              <article className="admin-release" key={release.id}>
                {release.coverUrl ? <img src={release.coverUrl} alt="" /> : <div className="admin-cover-empty">—</div>}
                <div>
                  <h3>{release.artist} — {release.title}{release.releaseDate ? ` (${release.releaseDate})` : ""}</h3>
                  <p>{release.publishDate} · {release.genre} · {release.published ? "Δημοσιευμένη" : "Πρόχειρο"}</p>
                </div>
                <div className="admin-release-actions">
                  <button type="button" onClick={() => { setDraft(draftFromRelease(release)); setDiscogsMessage(""); }}>Επεξεργασία</button>
                  <button className="danger" type="button" onClick={() => deleteRelease(release)} disabled={busy}>Διαγραφή</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "settings" && (
        <section className="admin-section">
          <div className="admin-section-heading"><div><h2>Κείμενα &amp; header</h2><p>Γενικές ρυθμίσεις του blog</p></div></div>
          <form className="admin-card settings-form" onSubmit={saveSettings}>
            <h3>Header</h3>
            <div className="admin-grid two">
              <label>Τίτλος blog<input name="blog_title" required defaultValue={content.settings.blogTitle} /></label>
              <label>Υπότιτλος<input name="tagline" defaultValue={content.settings.tagline} /></label>
              <label>Χρώμα header<input name="header_color" type="color" defaultValue={content.settings.headerColor} /></label>
              <label>Φωτογραφία header<input name="header_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
            </div>
            {content.settings.headerImageUrl && (
              <label className="check-label"><input name="remove_header_image" type="checkbox" value="1" /> Αφαίρεση υπάρχουσας φωτογραφίας header</label>
            )}

            <h3>Κείμενα sidebar</h3>
            <div className="admin-grid two">
              <label>Τίτλος «Σχετικά»<input name="about_title" defaultValue={content.settings.aboutTitle} /></label>
              <label>Τίτλος κατηγοριών<input name="categories_title" defaultValue={content.settings.categoriesTitle} /></label>
              <label>Τίτλος αρχείου<input name="archive_title" defaultValue={content.settings.archiveTitle} /></label>
              <label>Τίτλος links<input name="links_title" defaultValue={content.settings.linksTitle} /></label>
            </div>
            <label>Κείμενο «Σχετικά»<textarea name="about_text" rows={5} defaultValue={content.settings.aboutText} /></label>

            <h3>Μενού</h3>
            <div className="admin-grid four">
              <label>Αρχική<input name="home_label" defaultValue={content.settings.homeLabel} /></label>
              <label>Κυκλοφορίες<input name="releases_label" defaultValue={content.settings.releasesLabel} /></label>
              <label>Σχετικά<input name="about_label" defaultValue={content.settings.aboutLabel} /></label>
              <label>Επικοινωνία<input name="contact_label" defaultValue={content.settings.contactLabel} /></label>
            </div>

            <h3>Επικοινωνία &amp; footer</h3>
            <div className="admin-grid two">
              <label>Email<input name="contact_email" type="email" defaultValue={content.settings.contactEmail} /></label>
              <label>Instagram URL<input name="instagram_url" type="url" defaultValue={content.settings.instagramUrl} /></label>
              <label>SoundCloud URL<input name="soundcloud_url" type="url" defaultValue={content.settings.soundcloudUrl} /></label>
              <label>Κείμενο footer<input name="footer_text" defaultValue={content.settings.footerText} /></label>
            </div>
            <div className="admin-form-actions">
              <button className="admin-primary" type="submit" disabled={busy}>{busy ? "Αποθήκευση..." : "Αποθήκευση αλλαγών"}</button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
