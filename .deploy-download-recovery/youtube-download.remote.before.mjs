export const youtubeMp4Format = [
  "18",
  "b[ext=mp4][vcodec^=avc1][height<=720]",
  "bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]",
].join("/");

export function youtubeAccessArgs({ proxyUrl, nodePath, potProviderHome } = {}) {
  const args = [];
  if (proxyUrl) args.push("--proxy", proxyUrl);
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
  const european = entries.filter(({ health }) => health.isEuropean === true);
  const candidates = european.length ? european : entries.filter(({ health }) => health.isEuropean !== false);
  const usable = candidates.some(({ health }) => Number(health.cooldownUntil || 0) <= now)
    ? candidates.filter(({ health }) => Number(health.cooldownUntil || 0) <= now)
    : candidates;
  return usable.sort((a, b) => {
    const aThroughput = Number(a.health.throughputBytesPerSecond || 0);
    const bThroughput = Number(b.health.throughputBytesPerSecond || 0);
    if (aThroughput || bThroughput) return bThroughput - aThroughput;
    const aSpeed = Number(a.health.averageDownloadMs || a.health.latencyMs || Number.MAX_SAFE_INTEGER);
    const bSpeed = Number(b.health.averageDownloadMs || b.health.latencyMs || Number.MAX_SAFE_INTEGER);
    return aSpeed - bSpeed || Number(a.health.failures || 0) - Number(b.health.failures || 0) || a.index - b.index;
  }).map(({ proxyUrl }) => proxyUrl);
}
