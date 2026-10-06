import { env } from "cloudflare:workers";

type RuntimeEnv = { MEDIA?: R2Bucket };

export function getMediaBucket(): R2Bucket {
  const bucket = (env as unknown as RuntimeEnv).MEDIA;
  if (!bucket) throw new Error("Η αποθήκευση αρχείων δεν είναι ακόμη διαθέσιμη.");
  return bucket;
}

export async function storeMedia(file: File, folder: "covers" | "headers" | "downloads") {
  const extension = safeExtension(file.name);
  const key = `${folder}/${crypto.randomUUID()}${extension}`;
  await getMediaBucket().put(key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
    customMetadata: { originalName: file.name.slice(0, 240) },
  });
  return {
    key,
    url: `/media/${key}${folder === "downloads" ? "?download=1" : ""}`,
    name: file.name,
  };
}

function safeExtension(name: string) {
  const match = name.toLowerCase().match(/\.[a-z0-9]{1,8}$/);
  return match?.[0] ?? "";
}
