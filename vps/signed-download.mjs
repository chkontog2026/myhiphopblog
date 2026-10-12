import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { downloadContentDisposition, normalizeDownloadFilename } from "./download-filename.mjs";

export async function sendSignedDownload(req, res, next, url, filename) {
  const name = normalizeDownloadFilename(filename);
  const disposition = new URL(url).searchParams.get("response-content-disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let matches = false;
  try { matches = Boolean(encodedName) && decodeURIComponent(encodedName) === name; } catch {}
  if (matches) return res.redirect(302, url);

  // A signed URL cannot be edited without invalidating its signature. Stream
  // only names changed by storage, supplying the original filename ourselves.
  const controller = new AbortController();
  const abort = () => { if (!res.writableFinished) controller.abort(); };
  res.once("close", abort);
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const headers = { "accept-encoding": "identity" };
    for (const header of ["range", "if-range"]) {
      if (req.headers[header]) headers[header] = req.headers[header];
    }
    const upstream = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (![200, 206, 416].includes(upstream.status)) {
      await upstream.body?.cancel();
      return res.status(502).send("Download temporarily unavailable");
    }
    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Content-Disposition", downloadContentDisposition(name));
    res.setHeader("Cache-Control", "private, no-store");
    if (!upstream.body) return res.end();
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (!res.destroyed) next(error);
  } finally {
    clearTimeout(timeout);
    res.off("close", abort);
  }
}
