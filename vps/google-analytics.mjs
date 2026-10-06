export function normalizeGoogleAnalyticsId(value) {
  const id = String(value || "").trim().toUpperCase();
  return /^G-[A-Z0-9]{6,16}$/.test(id) ? id : "";
}

export function googleAnalyticsHead(value) {
  const id = normalizeGoogleAnalyticsId(value);
  return id
    ? `<script src="/google-analytics.js?v=2" data-measurement-id="${id}" defer></script>`
    : "";
}
