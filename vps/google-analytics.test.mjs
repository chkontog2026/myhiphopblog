import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { googleAnalyticsHead, normalizeGoogleAnalyticsId } from "./google-analytics.mjs";

test("accepts a GA4 Measurement ID and rejects injectable values", () => {
  assert.equal(normalizeGoogleAnalyticsId(" g-601f0mjfr1 "), "G-601F0MJFR1");
  assert.equal(normalizeGoogleAnalyticsId('G-123456"><script>'), "");
  assert.equal(googleAnalyticsHead("not-an-id"), "");
});

test("renders one local analytics loader for the configured public stream", () => {
  const head = googleAnalyticsHead("G-601F0MJFR1");
  assert.equal((head.match(/google-analytics\.js/g) || []).length, 1);
  assert.match(head, /google-analytics\.js\?v=2/);
  assert.match(head, /data-measurement-id="G-601F0MJFR1"/);
  assert.doesNotMatch(head, /googletagmanager\.com/);
});

test("grants Analytics storage without enabling advertising signals", () => {
  const source = fs.readFileSync(new URL("./public/google-analytics.js", import.meta.url), "utf8");
  const consentIndex = source.indexOf('window.gtag("consent", "default"');
  const configIndex = source.indexOf('window.gtag("config"');
  assert.ok(consentIndex >= 0 && configIndex > consentIndex);
  assert.match(source, /analytics_storage:\s*"granted"/);
  assert.match(source, /ad_storage:\s*"denied"/);
  assert.match(source, /allow_google_signals:\s*false/);
});

test("loads the official Google tag once with Analytics enabled", () => {
  const source = fs.readFileSync(new URL("./public/google-analytics.js", import.meta.url), "utf8");
  const appended = [];
  const window = {};
  vm.runInNewContext(source, {
    window,
    document: {
      currentScript: { dataset: { measurementId: "G-601F0MJFR1" } },
      createElement: () => ({}),
      head: { append: (element) => appended.push(element) },
    },
  });
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, "https://www.googletagmanager.com/gtag/js?id=G-601F0MJFR1");
  assert.equal(appended[0].async, true);
  const commands = JSON.parse(JSON.stringify(window.dataLayer.map((args) => Array.from(args))));
  assert.deepEqual(commands[0], ["consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  }]);
  assert.equal(commands.find((command) => command[0] === "config")?.[1], "G-601F0MJFR1");
});
