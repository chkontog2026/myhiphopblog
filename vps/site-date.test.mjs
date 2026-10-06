import assert from "node:assert/strict";
import test from "node:test";
import { dateInTimeZone } from "./site-date.mjs";

test("uses the real calendar date in Athens across the UTC midnight boundary", () => {
  assert.equal(dateInTimeZone(new Date("2026-08-02T20:30:00Z"), "Europe/Athens"), "2026-08-02");
  assert.equal(dateInTimeZone(new Date("2026-08-02T21:30:00Z"), "Europe/Athens"), "2026-08-03");
});
