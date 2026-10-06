document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".discogs-fetch").forEach((button) => {
    const form = button.closest("form");
    if (!form) return;

    const artistInput = form.querySelector('[name="artist"]');
    const titleInput = form.querySelector('[name="title"]');
    const releaseDate = form.querySelector('[name="release_date"]');
    const downloadFile = form.querySelector('[name="download_file"]');
    const coverFile = form.querySelector('[name="cover"]');
    const coverUrl = form.querySelector('[name="cover_url"]');
    const discogsCoverUrl = form.querySelector('[name="discogs_cover_url"]');
    const tracks = form.querySelector('[name="tracks"]');
    const tracksDisc2 = form.querySelector('[name="tracks_disc_2"]');
    const disc1Label = form.querySelector('[name="disc_1_label"]');
    const disc2Label = form.querySelector('[name="disc_2_label"]');
    const secondDiscToggle = form.querySelector('[name="has_second_disc"]');
    const secondDiscPanel = form.querySelector(".disc-editor-secondary");
    const message = form.querySelector(".discogs-message");

    const showSecondDisc = (show) => {
      if (secondDiscToggle) secondDiscToggle.checked = show;
      if (secondDiscPanel) secondDiscPanel.hidden = !show;
    };
    secondDiscToggle?.addEventListener("change", () => showSecondDisc(secondDiscToggle.checked));

    const fetchDiscogs = async () => {
      const artist = artistInput?.value.trim();
      const title = titleInput?.value.trim();
      const csrf = form.querySelector('[name="csrf"]')?.value;
      if (!tracks || !message) return;

      if (!artist || !title) {
        message.textContent = "Συμπλήρωσε πρώτα καλλιτέχνη και τίτλο.";
        return;
      }

      button.disabled = true;
      message.textContent = "Αναζήτηση στο Discogs…";
      try {
        const response = await fetch("/admin/discogs/tracklist", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ csrf, artist, title, release_date: releaseDate?.value || "" }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Δεν βρέθηκε tracklist.");
        const groups = splitDiscTracklist(payload.tracks);
        tracks.value = numberTracks(groups[0]?.tracks || payload.tracks);
        if (groups.length > 1 && tracksDisc2) {
          tracksDisc2.value = numberTracks(groups.slice(1).flatMap((group) => group.tracks));
          if (disc1Label) disc1Label.value = groups[0]?.label || "";
          if (disc2Label) disc2Label.value = groups[1]?.label || "";
          showSecondDisc(true);
        } else {
          if (tracksDisc2) tracksDisc2.value = "";
          if (disc1Label) disc1Label.value = "";
          if (disc2Label) disc2Label.value = "";
          showSecondDisc(false);
        }
        if (artistInput && payload.artist) artistInput.value = payload.artist;
        if (titleInput && payload.title) titleInput.value = payload.title;
        if (releaseDate && payload.releaseDate) releaseDate.value = payload.releaseDate;
        const automaticCover = discogsCoverUrl?.value && coverUrl?.value === discogsCoverUrl.value;
        const maySetCover = form.dataset.hasCover !== "1" && !coverFile?.files?.length && (!coverUrl?.value.trim() || automaticCover);
        if (maySetCover && payload.coverUrl && coverUrl && discogsCoverUrl) {
          coverUrl.value = payload.coverUrl;
          discogsCoverUrl.value = payload.coverUrl;
        }
        const year = payload.match.year ? ` (${payload.match.year})` : "";
        const cover = maySetCover && payload.coverUrl ? " · εξώφυλλο" : "";
        message.textContent = `Βρέθηκε: ${payload.match.title}${year} · ${payload.trackCount ?? payload.tracks.length} κομμάτια${cover}`;
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.";
      } finally {
        button.disabled = false;
      }
    };

    button.addEventListener("click", fetchDiscogs);
    downloadFile?.addEventListener("change", () => {
      const parsed = parseReleaseFilename(downloadFile.files?.[0]?.name || "");
      if (!parsed || !artistInput || !titleInput || !message) return;

      artistInput.value = parsed.artist;
      titleInput.value = parsed.title;
      if (releaseDate && parsed.year) releaseDate.value = parsed.year;

      if (button.disabled) {
        message.textContent = "Τα στοιχεία συμπληρώθηκαν από το όνομα του αρχείου. Αποθήκευσε Discogs token για αυτόματη επιβεβαίωση.";
        return;
      }
      message.textContent = "Το όνομα του αρχείου αναγνωρίστηκε. Αναζήτηση στο Discogs…";
      fetchDiscogs();
    });
  });
});

function splitDiscTracklist(items) {
  const groups = [];
  let current = { label: "", tracks: [] };
  for (const value of Array.isArray(items) ? items : []) {
    const track = String(value || "").trim();
    const heading = track.match(/^(?:disc|disk|cd)\s*\d{1,2}(?:\s*[-–—:]\s*(.*))?$/i);
    if (heading) {
      if (current.tracks.length) groups.push(current);
      current = { label: String(heading[1] || "").trim(), tracks: [] };
    } else if (track) {
      current.tracks.push(track);
    }
  }
  if (current.tracks.length) groups.push(current);
  return groups;
}

function numberTracks(items) {
  return (Array.isArray(items) ? items : []).map((track, index) => `${index + 1}. ${track}`).join("\n");
}

function parseReleaseFilename(filename) {
  const withoutExtension = String(filename)
    .replace(/\.(?:zip|rar|7z|flac|mp3|m4a|aac|wav|ogg)$/i, "")
    .trim();
  const yearMatch = withoutExtension.match(/\s*(?:\(((?:19|20)\d{2})\)|\[((?:19|20)\d{2})\]|((?:19|20)\d{2}))\s*$/);
  const year = yearMatch ? yearMatch.slice(1).find(Boolean) || "" : "";
  const releaseName = yearMatch ? withoutExtension.slice(0, yearMatch.index).trim() : withoutExtension;
  const separator = releaseName.match(/\s+(?:-|–|—)\s+/);
  if (!separator || separator.index === undefined) return null;

  const artist = releaseName.slice(0, separator.index).trim();
  const title = releaseName.slice(separator.index + separator[0].length).trim();
  return artist && title ? { artist, title, year } : null;
}
