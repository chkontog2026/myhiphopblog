import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./public/view-counter.js", import.meta.url), "utf8");

test("records one view only after a trusted visible interaction", async () => {
  const listeners = new Map();
  const requests = [];
  let now = 0;
  const window = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
  };

  vm.runInNewContext(source, {
    document: { visibilityState: "visible" },
    window,
    navigator: { webdriver: false },
    performance: { now: () => now },
    fetch: async (...args) => { requests.push(args); },
  });

  listeners.get("scroll")({ isTrusted: true });
  assert.equal(requests.length, 0);
  now = 1_000;
  listeners.get("click")({ isTrusted: false });
  assert.equal(requests.length, 0);
  listeners.get("scroll")({ isTrusted: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], "/analytics/page-view");
  assert.equal(requests[0][1].method, "POST");
  assert.equal(requests[0][1].credentials, "same-origin");
  assert.equal(requests[0][1].keepalive, true);
  assert.equal(requests[0][1].headers["X-Page-View-Intent"], "1");
  assert.equal(listeners.size, 0);
});

test("does not arm the view counter in webdriver sessions", () => {
  let armed = false;
  vm.runInNewContext(source, {
    document: { visibilityState: "visible" },
    window: {
      addEventListener() { armed = true; },
      removeEventListener() {},
    },
    navigator: { webdriver: true },
    performance: { now: () => 1_000 },
    fetch: async () => {},
  });
  assert.equal(armed, false);
});
