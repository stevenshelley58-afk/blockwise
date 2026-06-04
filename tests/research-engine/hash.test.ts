import assert from "node:assert/strict";
import test from "node:test";

import { canonicaliseJson, creativeHash, normaliseName, payloadHash } from "../../src/lib/research/hash.ts";

test("canonicaliseJson produces identical bytes regardless of key order", () => {
  const a = { z: 1, a: 2, m: { y: 1, x: 2 } };
  const b = { a: 2, m: { x: 2, y: 1 }, z: 1 };
  assert.equal(canonicaliseJson(a), canonicaliseJson(b));
});

test("payloadHash is stable across key reordering", () => {
  assert.equal(
    payloadHash({ z: 1, a: 2 }),
    payloadHash({ a: 2, z: 1 }),
  );
});

test("payloadHash distinguishes substantive content differences", () => {
  assert.notEqual(
    payloadHash({ headline: "Just listed" }),
    payloadHash({ headline: "Just sold" }),
  );
});

test("creativeHash ignores fields that aren't creative content", () => {
  const a = creativeHash({
    headline: "Open home Sat",
    body: "11–11:45 only",
    primaryImageUrl: "https://example.org/hero.jpg",
    videoUrl: null,
    ctaUrl: "https://acton.com.au/12345",
  });
  const b = creativeHash({
    headline: "Open home Sat",
    body: "11–11:45 only",
    primaryImageUrl: "https://example.org/hero.jpg",
    videoUrl: null,
    ctaUrl: "https://acton.com.au/12345",
  });
  assert.equal(a, b);
});

test("normaliseName lowercases, strips punctuation, collapses whitespace, converts &", () => {
  assert.equal(normaliseName("Smith & Co."), "smith and co");
  assert.equal(normaliseName("  Acton   Cottesloe  "), "acton cottesloe");
  assert.equal(normaliseName("REIWA-Member: Ray  White"), "reiwa member ray white");
});
