document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.release-form input[name="youtube_url"]').forEach((youtubeInput) => {
    const form = youtubeInput.closest("form");
    if (!form) return;

    const button = form.querySelector(".youtube-fetch");
    const importButton = form.querySelector(".youtube-import");
    const message = form.querySelector(".youtube-message");
    const artistInput = form.querySelector('[name="artist"]');
    const titleInput = form.querySelector('[name="title"]');
    const releaseDateInput = form.querySelector('[name="release_date"]');
    let timer;
    let lastFetchedUrl = "";

    const pageParams = new URLSearchParams(window.location.search);
    const resumedJobId = pageParams.get("youtube_job");
    const importNotice = pageParams.get("youtube_import");
    if (resumedJobId && form.querySelector('[name="id"]')?.value === pageParams.get("edit")) {
      if (importButton) importButton.disabled = true;
      if (message) message.textContent = "Συνέχεια δημιουργίας MP4…";
      pollImport(resumedJobId);
    } else if (importNotice && form.querySelector('[name="id"]')?.value === pageParams.get("edit") && message) {
      message.textContent = importNotice === "busy"
        ? "Υπάρχει ήδη άλλη λήψη σε εξέλιξη. Δοκίμασε ξανά μόλις ολοκληρωθεί."
        : "Δεν έχουν ρυθμιστεί ακόμη τα Webshare proxies.";
    }

    const fetchMetadata = async (overwrite = false) => {
      const url = youtubeInput.value.trim();
      if (!url || url === lastFetchedUrl || !message) return;
      lastFetchedUrl = url;
      if (button) button.disabled = true;
      message.textContent = "Ανάγνωση στοιχείων από το YouTube…";

      try {
        const response = await fetch(`/admin/youtube/metadata?url=${encodeURIComponent(url)}`, {
          headers: { Accept: "application/json" },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Δεν διαβάστηκαν τα στοιχεία του video.");

        if (artistInput && (overwrite || !artistInput.value.trim())) artistInput.value = payload.artist || "";
        if (titleInput && (overwrite || !titleInput.value.trim())) titleInput.value = payload.title || "";
        if (releaseDateInput && (overwrite || !releaseDateInput.value.trim())) releaseDateInput.value = payload.releaseDate || "";
        const yearMessage = payload.releaseDate ? ` · έτος ${payload.releaseDate}` : " · δεν βρέθηκε έτος";
        message.textContent = `Συμπληρώθηκαν: ${payload.artist} — ${payload.title}${yearMessage}. Έλεγξέ τα πριν τη δημοσίευση.`;
      } catch (error) {
        lastFetchedUrl = "";
        message.textContent = error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.";
      } finally {
        if (button) button.disabled = false;
      }
    };

    youtubeInput.addEventListener("input", () => {
      clearTimeout(timer);
      lastFetchedUrl = "";
      timer = setTimeout(() => fetchMetadata(false), 650);
    });
    button?.addEventListener("click", () => {
      lastFetchedUrl = "";
      fetchMetadata(true);
    });
    importButton?.addEventListener("click", async () => {
      const id = form.querySelector('[name="id"]')?.value;
      const csrf = form.querySelector('[name="csrf"]')?.value;
      if (!id || !message) return;
      importButton.disabled = true;
      message.textContent = "Έναρξη δημιουργίας MP4…";
      try {
        const response = await fetch("/admin/youtube/import", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ id, csrf }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Δεν ξεκίνησε η λήψη.");
        await pollImport(payload.jobId);
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.";
        importButton.disabled = false;
      }
    });

    async function pollImport(jobId) {
      try {
        const response = await fetch(`/admin/youtube/import/${encodeURIComponent(jobId)}`, { headers: { Accept: "application/json" } });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Χάθηκε η εργασία λήψης.");
        message.textContent = payload.message;
        if (["complete", "failed", "cancelled"].includes(payload.status)) {
          importButton.disabled = false;
          return;
        }
        setTimeout(() => pollImport(jobId), 2500);
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "Παρουσιάστηκε σφάλμα.";
        importButton.disabled = false;
      }
    }
  });
});
