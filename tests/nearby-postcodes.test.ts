import assert from "node:assert/strict";
import test from "node:test";

import { resolveNearbyPostcodes } from "../src/lib/research/nearby-postcodes.ts";

test("nearby postcodes keep the exact Perth postcode first and exclude Sydney", () => {
  const result = resolveNearbyPostcodes("6000");

  assert.equal(result[0], "6000");
  assert.ok(result.includes("6004"));
  assert.equal(result.includes("2000"), false);
  assert.ok(result.length <= 9);
});

test("nearby postcodes preserve leading zeroes", () => {
  const result = resolveNearbyPostcodes("0800");

  assert.equal(result[0], "0800");
  assert.ok(result.every((postcode) => /^\d{4}$/u.test(postcode)));
});

test("distance and result bounds never widen a postcode lookup", () => {
  assert.deepEqual(resolveNearbyPostcodes("6000", { maxDistanceKm: 0.3 }), ["6000"]);
  assert.deepEqual(resolveNearbyPostcodes("6000", { maxResults: 0 }), ["6000"]);
  const all = resolveNearbyPostcodes("6000");
  const nearest = resolveNearbyPostcodes("6000", { maxResults: 1 });
  assert.deepEqual(all.slice(0, 2), nearest);
  assert.equal(resolveNearbyPostcodes("6000", { maxResults: 2 }).length, 3);
});

test("invalid postcodes return no search key and unknown valid postcodes stay exact-only", () => {
  assert.deepEqual(resolveNearbyPostcodes("60"), []);
  assert.deepEqual(resolveNearbyPostcodes("0000"), ["0000"]);
});
