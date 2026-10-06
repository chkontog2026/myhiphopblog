import assert from "node:assert/strict";
import test from "node:test";
import { parseProxyProbeOutput, parseProxyUrls, proxyIdentity, rankProxyUrls, sanitizeYouTubeError, youtubeAccessArgs, youtubeMp4Format, runYouTubeProxyAttempts, youtubeFailureCode, youtubeFailureMessage } from "./youtube-download.mjs";

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

test("passes the configured cookie file as one argument without reading its contents", () => {
  const previous = process.env.YOUTUBE_COOKIES_PATH;
  try {
    process.env.YOUTUBE_COOKIES_PATH = "/private/youtube cookies.txt";
    assert.deepEqual(youtubeAccessArgs(), ["--cookies", "/private/youtube cookies.txt"]);
    assert.deepEqual(youtubeAccessArgs({ cookiesPath: "" }), []);
    assert.deepEqual(youtubeAccessArgs({ cookiesPath: "/private/other.txt" }), ["--cookies", "/private/other.txt"]);
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_COOKIES_PATH;
    else process.env.YOUTUBE_COOKIES_PATH = previous;
  }
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

test("ranks healthy European proxies first and retains other exits as fallback", () => {
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
  assert.deepEqual(rankProxyUrls(proxies, health), [proxies[2], proxies[1], proxies[0]]);
});

test("does not retry known failed proxies when every proxy is cooling down", () => {
  const proxies = ["http://10.0.0.1:8080/", "http://10.0.0.2:8080/"];
  const now = 1_000;
  const health = {
    [proxyIdentity(proxies[0])]: { isEuropean: true, latencyMs: 10, cooldownUntil: now + 60_000 },
    [proxyIdentity(proxies[1])]: { isEuropean: true, latencyMs: 20 },
  };
  assert.deepEqual(rankProxyUrls(proxies, health, now), [proxies[1]]);
  health[proxyIdentity(proxies[1])].cooldownUntil = now + 60_000;
  assert.deepEqual(rankProxyUrls(proxies, health, now), []);
});

test("moves past authentication failure and returns the next successful download", async () => {
  const proxies = ["http://10.0.0.1:8080", "http://10.0.0.2:8080"];
  const failures = [];
  const result = await runYouTubeProxyAttempts({ proxyUrls: proxies, health: {},
    attempt: async (url) => { if (url === proxies[0]) throw new Error("407 Proxy Authentication Required"); return { size: 1000 }; },
    onFailure: (url, code) => failures.push([url, code]),
  });
  assert.deepEqual(result, { size: 1000 });
  assert.deepEqual(failures, [[proxies[0], "proxy-auth"]]);
});

test("uses a healthy alternative when the European proxy is cooling down", () => {
  const proxies = ["http://eu:80", "http://us:80"];
  const health = {
    [proxyIdentity(proxies[0])]: { isEuropean: true, cooldownUntil: 10_000 },
    [proxyIdentity(proxies[1])]: { isEuropean: false },
  };
  assert.deepEqual(rankProxyUrls(proxies, health, 0), [proxies[1]]);
});

test("caps a job at five attempts even with a large configured pool", async () => {
  let calls = 0;
  await assert.rejects(runYouTubeProxyAttempts({ proxyUrls: Array.from({ length: 100 }, (_, i) => `http://10.0.0.${i + 1}:8080`), health: {},
    attempt: async () => { calls++; throw new Error("Sign in to confirm you’re not a bot"); },
  }), /not a bot/);
  assert.equal(calls, 5);
});

test("enforces the total deadline and passes a bounded per-attempt timeout", async () => {
  let time = 0;
  const budgets = [];
  await assert.rejects(runYouTubeProxyAttempts({ proxyUrls: ["http://a:80", "http://b:80", "http://c:80"], health: {}, now: () => time,
    attempt: async (_url, timeout) => { budgets.push(timeout); time += timeout; throw new Error("DOWNLOAD_TIMEOUT"); },
  }), /DOWNLOAD_TIMEOUT/);
  assert.deepEqual(budgets, [120_000, 120_000]);
});

test("cancellation stops fallback without marking a proxy failed", async () => {
  let cancelled = false;
  let failures = 0;
  let attempts = 0;
  await assert.rejects(runYouTubeProxyAttempts({ proxyUrls: ["http://a:80", "http://b:80"], health: {}, isCancelled: () => cancelled,
    attempt: async () => { attempts++; cancelled = true; throw new Error("cancelled"); },
    onFailure: () => failures++,
  }), /cancelled/);
  assert.equal(attempts, 1);
  assert.equal(failures, 0);
});

test("cooldown yields a terminal message without starting another process", async () => {
  const url = "http://a:80";
  await assert.rejects(runYouTubeProxyAttempts({ proxyUrls: [url], health: { [proxyIdentity(url)]: { cooldownUntil: 10_000 } }, now: () => 0,
    attempt: async () => assert.fail("must not run"),
  }), /PROXIES_COOLING_DOWN/);
  assert.equal(youtubeFailureCode(new Error("PROXIES_COOLING_DOWN")), "cooldown");
});

test("public failure messages explain YouTube blocks without exposing credentials", () => {
  const error = new Error("--proxy http://user:secret@a:80 Sign in to confirm you’re not a bot");
  assert.equal(youtubeFailureCode(error), "youtube-blocked");
  assert.match(youtubeFailureMessage(youtubeFailureCode(error)), /YouTube/);
  assert.doesNotMatch(youtubeFailureMessage(youtubeFailureCode(error)), /secret|user|http/);
  assert.equal(youtubeFailureCode(new Error("DOWNLOAD_TIMEOUT")), "timeout");
});
