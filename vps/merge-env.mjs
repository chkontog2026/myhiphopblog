import fs from "node:fs";
import path from "node:path";

const destination = path.resolve(process.argv[2] || ".env");
const additions = path.resolve(process.argv[3] || ".env.update");
const backupPath = `${destination}.backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;

const currentLines = fs.readFileSync(destination, "utf8").split(/\r?\n/);
const updateLines = fs.readFileSync(additions, "utf8").split(/\r?\n/).filter(Boolean);
const updates = new Map(updateLines.map((line) => {
  const separator = line.indexOf("=");
  if (separator < 1) throw new Error("Invalid environment update");
  return [line.slice(0, separator), line];
}));
const merged = currentLines.filter((line) => !updates.has(line.split("=", 1)[0]));
merged.push(...updates.values(), "");

fs.copyFileSync(destination, backupPath, fs.constants.COPYFILE_EXCL);
fs.chmodSync(backupPath, 0o600);
const temporaryPath = `${destination}.next`;
fs.writeFileSync(temporaryPath, merged.join("\n"), { mode: 0o600, flag: "wx" });
fs.renameSync(temporaryPath, destination);
fs.rmSync(additions);
console.log(`Environment updated; backup=${backupPath}`);
