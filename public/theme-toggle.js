(() => {
  const storageKey = "myhiphopblog-theme";
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const storedTheme = () => {
    try {
      const value = localStorage.getItem(storageKey);
      return value === "dark" || value === "light" ? value : null;
    } catch {
      return null;
    }
  };

  const preferredTheme = () => storedTheme() || (media.matches ? "dark" : "light");

  const updateButton = (theme) => {
    const button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    const dark = theme === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Ενεργοποίηση φωτεινής εμφάνισης" : "Ενεργοποίηση σκοτεινής εμφάνισης");
    button.title = dark ? "Φωτεινή εμφάνιση" : "Σκοτεινή εμφάνιση";
    const icon = button.querySelector(".theme-toggle-icon");
    const label = button.querySelector("[data-theme-label]");
    if (icon) icon.textContent = dark ? "☀" : "☾";
    if (label) label.textContent = dark ? "Light" : "Dark";
  };

  const applyTheme = (theme, persist = false) => {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (persist) {
      try { localStorage.setItem(storageKey, theme); } catch {}
    }
    updateButton(theme);
  };

  applyTheme(preferredTheme());

  const bindToggle = () => {
    const button = document.querySelector("[data-theme-toggle]");
    if (!button || button.dataset.themeReady === "true") return;
    button.dataset.themeReady = "true";
    updateButton(root.dataset.theme || preferredTheme());
    button.addEventListener("click", () => {
      applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindToggle, { once: true });
  else bindToggle();

  media.addEventListener?.("change", () => {
    if (!storedTheme()) applyTheme(media.matches ? "dark" : "light");
  });
})();
