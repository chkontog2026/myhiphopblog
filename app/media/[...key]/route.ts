import { getMediaBucket } from "../../../db/media";

type Context = { params: Promise<{ key: string[] | string }> };

export async function GET(request: Request, context: Context) {
  const rawKey = (await context.params).key;
  const key = Array.isArray(rawKey) ? rawKey.join("/") : rawKey;
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
  const object = await getMediaBucket().get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  if (new URL(request.url).searchParams.get("download") === "1") {
    const name = object.customMetadata?.originalName || key.split("/").pop() || "download";
    headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }
  return new Response(object.body, { headers });
}
