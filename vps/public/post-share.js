document.addEventListener("click", async (event) => {
  const button = event.target.closest(".post-share");
  if (!button) return;

  const url = button.dataset.shareUrl || window.location.href;
  const title = button.dataset.shareTitle || document.title;
  const status = button.parentElement?.querySelector(".post-share-status");

  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      if (status) status.textContent = "Κοινοποιήθηκε.";
      return;
    }
    await navigator.clipboard.writeText(url);
    if (status) status.textContent = "Ο σύνδεσμος αντιγράφηκε.";
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (status) status.textContent = "Δεν ήταν δυνατή η κοινοποίηση.";
  }

  window.setTimeout(() => {
    if (status) status.textContent = "";
  }, 3000);
});
