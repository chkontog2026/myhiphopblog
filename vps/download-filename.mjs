import path from "node:path";

export function normalizeDownloadFilename(filename) {
  const cleanName = path.basename(String(filename || "download").replace(/[\\/]/g, "/"))
    .replace(/[\r\n]/g, "") || "download";

  // Browsers send multipart filenames as UTF-8, while busboy/multer decodes
  // that header as Latin-1. Recover the original text only when those bytes
  // form valid UTF-8; this leaves genuine Latin-1 names unchanged.
  if ([...cleanName].some((character) => character.codePointAt(0) > 0xFF)) return cleanName;
  const decoded = Buffer.from(cleanName, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? cleanName : decoded;
}

export function downloadContentDisposition(filename) {
  const normalized = normalizeDownloadFilename(filename);
  const encoded = encodeURIComponent(normalized)
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const fallback = normalized
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_") || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
