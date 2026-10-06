import fs from "node:fs";
import path from "node:path";

// Use only generated filenames, never a path supplied by a form or URL.
export function videoFilePath(directory, filename) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$/i.test(
      filename || "",
    )
  )
    return null;
  return path.join(directory, filename);
}

export function isUploadedVideo(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (![".mp4", ".webm"].includes(extension)) return false;
  const descriptor = fs.openSync(file.path, "r");
  try {
    const header = Buffer.alloc(4096);
    const length = fs.readSync(descriptor, header, 0, header.length, 0);
    if (extension === ".mp4") {
      return (
        length >= 16 &&
        header.toString("ascii", 4, 8) === "ftyp" &&
        header.readUInt32BE(0) >= 16 &&
        header.readUInt32BE(0) <= file.size
      );
    }
    return (
      length >= 16 &&
      header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
      header.subarray(4, length).includes(Buffer.from("webm"))
    );
  } finally {
    fs.closeSync(descriptor);
  }
}
