import assert from "node:assert/strict";
import test from "node:test";
import { discogsGreekAccentVariants, greeklishDiscogsSearchTerms, greeklishDiscogsStems, normalizeDiscogsSearchText } from "./discogs-lookup.mjs";

test("creates a searchable Greek stem from a Greeklish release title", () => {
  const stems = greeklishDiscogsStems("Agnostofovia");
  assert.ok(stems.includes("αγνωστοφοβ"));
  assert.ok(normalizeDiscogsSearchText("Άλφα Γάμα* - Αγνωστοφοβία").includes("αγνωστοφοβ"));
});

test("does not alter titles that are already written in Greek", () => {
  assert.deepEqual(greeklishDiscogsStems("Αγνωστοφοβία"), []);
});

test("keeps the complete Greeklish title for the Discogs API query", () => {
  const terms = greeklishDiscogsSearchTerms("Sta Vimata Tou Iskiou");
  assert.ok(terms.includes("στα βηματα του ισκιου"));
});

test("creates accented artist alternatives needed by the Discogs search index", () => {
  const terms = greeklishDiscogsSearchTerms("Agnvstos Xeimwnas");
  const accented = terms.flatMap(discogsGreekAccentVariants);
  assert.ok(accented.includes("άγνωστος χειμώνας"));
  assert.ok(accented.slice(0, 24).includes("άγνωστος χειμώνας"));
});

test("matches uppercase unaccented Greek titles against accented Discogs titles", () => {
  const requested = normalizeDiscogsSearchText("ΠΑΡΑΜΟΝΕΣ ΤΟΥ ΠΟΛΕΜΟΥ");
  const result = normalizeDiscogsSearchText("542* - Παραμονές Του Πολέμου");
  assert.ok(result.includes(requested));
});
