import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("./public/theme-toggle.js", import.meta.url), "utf8");

function runThemeScript(savedTheme = null) {
  const root = { dataset: { theme: "dark" }, style: {} };
  const button = {
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
    querySelector(selector) {
      if (selector === ".theme-toggle-icon") return this.icon ||= {};
      if (selector === "[data-theme-label]") return this.label ||= {};
      return null;
    },
  };
  const storage = new Map(savedTheme ? [["myhiphopblog-theme", savedTheme]] : []);
  vm.runInNewContext(source, {
    document: {
      documentElement: root,
      readyState: "complete",
      querySelector: () => button,
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  return { root, button };
}

test("uses dark theme by default when the visitor has no saved choice", () => {
  const { root, button } = runThemeScript();
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(button.label.textContent, "Light");
  assert.equal(button.attributes["aria-pressed"], "true");
});

test("keeps an existing visitor's saved light-theme choice", () => {
  const { root, button } = runThemeScript("light");
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.style.colorScheme, "light");
  assert.equal(button.label.textContent, "Dark");
  assert.equal(button.attributes["aria-pressed"], "false");
});
