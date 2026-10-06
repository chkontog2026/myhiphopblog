import fs from "node:fs";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) throw new Error("Usage: webshare-proxy-env.mjs <proxy-list> <output-env>");

const proxyUrls = fs.readFileSync(sourcePath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [host, port, username, password, ...extra] = line.split(":");
    if (!host || !/^\d+$/.test(port || "") || !username || !password || extra.length) {
      throw new Error("Invalid Webshare proxy list format");
    }
    return `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
  });

if (!proxyUrls.length) throw new Error("The Webshare proxy list is empty");
fs.writeFileSync(outputPath, `WEBSHARE_PROXY_URLS=${proxyUrls.join(",")}\n`, { mode: 0o600, flag: "wx" });
console.log(`Prepared ${proxyUrls.length} proxies`);
