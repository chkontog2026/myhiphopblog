import assert from "node:assert/strict";
import test from "node:test";
import { parseProxyProbeOutput, parseProxyUrls, proxyIdentity, rankProxyUrls, sanitizeYouTubeError, youtubeAccessArgs, youtubeMp4Format } from "./youtube-download.mjs";

test("prefers the fast combined MP4 and keeps higher quality as fallback", () => {
  assert.match(youtubeMp4Format, /^18\//);
  assert.match(youtubeMp4Format, /height<=1080/);
  assert.match(youtubeMp4Format, /vcodec\^=avc1/);
  assert.match(youtubeMp4Format, /acodec\^=mp4a/);
});

test("parses authenticated proxy URLs without exposing their values", () => {
  const proxies = parseProxyUrls("http://user:pass@127.0.0.1:8080; socks5://u:p@127.0.0.2:1080");
  assert.equal(proxies.length, 2);
  assert.equal(new URL(proxies[0]).username, "user");
});

test("rejects unsupported proxy protocols", () => {
  assert.throws(() => parseProxyUrls("file:///tmp/proxy"), /Invalid proxy URL/);
});

test("adds the isolated Node PO-token provider to YouTube downloads", () => {
  assert.deepEqual(youtubeAccessArgs({
    proxyUrl: "http://user:pass@127.0.0.1:8080/",
    nodePath: "/usr/bin/node",
    potProviderHome: "/opt/provider/server",
  }), [
    "--proxy", "http://user:pass@127.0.0.1:8080/",
    "--js-runtimes", "node:/usr/bin/node",
    "--extractor-args", "youtube:player_client=mweb",
    "--extractor-args", "youtubepot-bgutilscript:server_home=/opt/provider/server",
  ]);
});

test("redacts proxy credentials from YouTube errors", () => {
  const message = sanitizeYouTubeError(new Error("Command failed: --proxy http://user:secret@127.0.0.1:8080/"));
  assert.equal(message, "Command failed: --proxy http://***@127.0.0.1:8080/");
  assert.doesNotMatch(message, /user|secret/);
});

test("recognizes European proxy probes and extracts their latency", () => {
  assert.deepEqual(parseProxyProbeOutput('{"success":true,"country_code":"DE"}\n__PROXY_TIME__:0.184'), {
    countryCode: "DE",
    isEuropean: true,
    latencyMs: 184,
  });
  assert.equal(parseProxyProbeOutput('{"success":true,"country_code":"SG"}\n__PROXY_TIME__:0.2').isEuropean, false);
});

test("ranks healthy European proxies first and omits non-European exits", () => {
  const proxies = [
    "http://user:pass@10.0.0.1:8080/",
    "http://user:pass@10.0.0.2:8080/",
    "http://user:pass@10.0.0.3:8080/",
  ];
  const health = {
    [proxyIdentity(proxies[0])]: { isEuropean: false, latencyMs: 20 },
    [proxyIdentity(proxies[1])]: { isEuropean: true, latencyMs: 250 },
    [proxyIdentity(proxies[2])]: { isEuropean: true, latencyMs: 90 },
  };
  assert.deepEqual(rankProxyUrls(proxies, health), [proxies[2], proxies[1]]);
});

test("temporarily skips a failed proxy and falls back when every proxy is cooling down", () => {
  const proxies = ["http://10.0.0.1:8080/", "http://10.0.0.2:8080/"];
  const now = 1_000;
  const health = {
    [proxyIdentity(proxies[0])]: { isEuropean: true, latencyMs: 10, cooldownUntil: now + 60_000 },
    [proxyIdentity(proxies[1])]: { isEuropean: true, latencyMs: 20 },
  };
  assert.deepEqual(rankProxyUrls(proxies, health, now), [proxies[1]]);
  health[proxyIdentity(proxies[1])].cooldownUntil = now + 60_000;
  assert.deepEqual(rankProxyUrls(proxies, health, now), proxies);
});
