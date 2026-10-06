export const youtubeMp4Format = [
  "18",
  "b[ext=mp4][vcodec^=avc1][height<=720]",
  "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]",
].join("/");

export function youtubeAccessArgs({ proxyUrl, nodePath, potProviderHome, cookiesPath = process.env.YOUTUBE_COOKIES_PATH } = {}) {
  const args = [];
  if (proxyUrl) args.push("--proxy", proxyUrl);
  if (cookiesPath) args.push("--cookies", cookiesPath);
  if (nodePath) args.push("--js-runtimes", `node:${nodePath}`);
  if (potProviderHome) {
    args.push("--extractor-args", "youtube:player_client=mweb");
    args.push("--extractor-args", `youtubepot-bgutilscript:server_home=${potProviderHome}`);
  }
  return args;
}

export function sanitizeYouTubeError(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown YouTube error");
  return message.replace(/((?:https?|socks[45]):\/\/)[^\s/@]+@/gi, "$1***@");
}

export function parseProxyUrls(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const url = new URL(item);
      if (!["http:", "https:", "socks4:", "socks5:"].includes(url.protocol) || !url.hostname || !url.port) {
        throw new Error("Invalid proxy URL");
      }
      return url.toString();
    });
}

export const europeanCountryCodes = new Set([
  "AD", "AL", "AT", "AX", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FO",
  "FR", "GB", "GG", "GI", "GR", "HR", "HU", "IE", "IM", "IS", "IT", "JE", "LI", "LT", "LU", "LV", "MC",
  "MD", "ME", "MK", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "SJ", "SK", "SM", "UA", "VA",
]);

export function proxyIdentity(proxyUrl) {
  const url = new URL(proxyUrl);
  return `${url.hostname}:${url.port}`;
}

export function parseProxyProbeOutput(output) {
  const marker = "\n__PROXY_TIME__:";
  const markerIndex = String(output || "").lastIndexOf(marker);
  if (markerIndex < 0) throw new Error("Invalid proxy probe response");
  const payload = JSON.parse(String(output).slice(0, markerIndex));
  const seconds = Number(String(output).slice(markerIndex + marker.length).trim());
  const countryCode = String(payload.country_code || "").toUpperCase();
  if (payload.success !== true || !countryCode || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Invalid proxy probe response");
  }
  return {
    countryCode,
    isEuropean: europeanCountryCodes.has(countryCode),
    latencyMs: Math.round(seconds * 1000),
  };
}

export function rankProxyUrls(proxyUrls, healthByIdentity = {}, now = Date.now()) {
  const entries = proxyUrls.map((proxyUrl, index) => {
    const health = healthByIdentity[proxyIdentity(proxyUrl)] || {};
    return { proxyUrl, index, health };
  });
  const available = entries.filter(({ health }) => Number(health.cooldownUntil || 0) <= now);
  return available.sort((a, b) => {
    const europeanPreference = Number(b.health.isEuropean === true) - Number(a.health.isEuropean === true);
    if (europeanPreference) return europeanPreference;
    const aThroughput = Number(a.health.throughputBytesPerSecond || 0);
    const bThroughput = Number(b.health.throughputBytesPerSecond || 0);
    if (aThroughput || bThroughput) return bThroughput - aThroughput;
    const aSpeed = Number(a.health.averageDownloadMs || a.health.latencyMs || Number.MAX_SAFE_INTEGER);
    const bSpeed = Number(b.health.averageDownloadMs || b.health.latencyMs || Number.MAX_SAFE_INTEGER);
    return aSpeed - bSpeed || Number(a.health.failures || 0) - Number(b.health.failures || 0) || a.index - b.index;
  }).map(({ proxyUrl }) => proxyUrl);
}

export function youtubeFailureCode(error) {
  const message = `${error?.code || ""} ${error?.stderr || ""} ${error?.message || error || ""}`;
  if (/407|Proxy Authentication Required/i.test(message)) return "proxy-auth";
  if (/confirm you.?re not a bot|LOGIN_REQUIRED|sign in/i.test(message)) return "youtube-blocked";
  if (/timed? ?out|ETIMEDOUT|DOWNLOAD_TIMEOUT/i.test(message)) return "timeout";
  if (/PROXIES_COOLING_DOWN/.test(message)) return "cooldown";
  return "unavailable";
}

export function youtubeFailureMessage(code) {
  const messages = {
    "proxy-auth": "Η υπηρεσία λήψης δεν μπόρεσε να συνδεθεί. Δοκίμασε ξανά αργότερα.",
    "youtube-blocked": "Το YouTube μπλόκαρε προσωρινά την προετοιμασία του MP4. Δοκίμασε ξανά αργότερα.",
    timeout: "Η προετοιμασία ξεπέρασε το όριο χρόνου και σταμάτησε. Μπορείς να δοκιμάσεις ξανά.",
    cooldown: "Η υπηρεσία λήψης είναι προσωρινά μη διαθέσιμη. Δοκίμασε ξανά σε λίγα λεπτά.",
  };
  return messages[code] || "Το MP4 δεν ετοιμάστηκε. Μπορείς να δοκιμάσεις ξανά αργότερα.";
}

// Bound the whole selection, including HTTPS checks and downloader retries.
export async function runYouTubeProxyAttempts({ proxyUrls, health, attempt, onAttempt = () => {}, onFailure = () => {}, isCancelled = () => false, now = Date.now }) {
  const candidates = rankProxyUrls(proxyUrls, health, now()).slice(0, 5);
  const deadline = now() + 4 * 60_000;
  let lastError = new Error("PROXIES_COOLING_DOWN");
  for (const [index, proxyUrl] of candidates.entries()) {
    if (isCancelled()) throw new Error("Download cancelled");
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("DOWNLOAD_TIMEOUT");
    onAttempt(index + 1, candidates.length);
    try {
      return await attempt(proxyUrl, Math.min(120_000, remaining));
    } catch (error) {
      if (isCancelled()) throw error;
      lastError = error;
      onFailure(proxyUrl, youtubeFailureCode(error));
    }
  }
  throw lastError;
}
