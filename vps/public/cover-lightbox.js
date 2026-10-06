document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.querySelector(".cover-lightbox");
  const largeCover = dialog?.querySelector("img");
  if (!dialog || !largeCover || typeof dialog.showModal !== "function") return;

  document.querySelectorAll(".cover-zoom").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const thumbnail = link.querySelector("img");
      largeCover.src = link.href;
      largeCover.alt = thumbnail?.alt || "Μεγεθυμένο εξώφυλλο";
      dialog.showModal();
    });
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    largeCover.removeAttribute("src");
    largeCover.alt = "";
  });
});
