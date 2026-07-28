import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrandPackLocation } from "../src/lib/research/brand-pack-suburb.ts";

test("full AU address resolves to the postcode with a readable label", () => {
  assert.deepEqual(resolveBrandPackLocation("Shop 3, 122 Scarborough Beach Rd, Scarborough WA 6019"), {
    searchTerm: "6019",
    label: "Scarborough, WA 6019",
  });
});

test("comma-separated state and postcode resolve the same way", () => {
  assert.deepEqual(resolveBrandPackLocation("12 Brighton Road, Scarborough, WA, 6019"), {
    searchTerm: "6019",
    label: "Scarborough, WA 6019",
  });
});

test("suburb and state without a postcode fall back to the suburb", () => {
  assert.deepEqual(resolveBrandPackLocation("Suite 2, 45 King St, Perth WA"), {
    searchTerm: "Perth",
    label: "Perth, WA",
  });
});

test("multi-word suburbs keep their words", () => {
  assert.deepEqual(resolveBrandPackLocation("1 Marine Terrace, Lake Coogee WA 6166"), {
    searchTerm: "6166",
    label: "Lake Coogee, WA 6166",
  });
});

test("a bare postcode is used when no state token is present", () => {
  assert.deepEqual(resolveBrandPackLocation("PO Box 91, 6019"), {
    searchTerm: "6019",
    label: "6019",
  });
});

test("the last four-digit run wins so street numbers are not mistaken for postcodes", () => {
  assert.deepEqual(resolveBrandPackLocation("1200 Some Road, 6019"), {
    searchTerm: "6019",
    label: "6019",
  });
});

test("addresses with no location signal return null", () => {
  assert.equal(resolveBrandPackLocation("123 Main Street"), null);
});

test("empty and missing input return null", () => {
  assert.equal(resolveBrandPackLocation(null), null);
  assert.equal(resolveBrandPackLocation(undefined), null);
  assert.equal(resolveBrandPackLocation(""), null);
  assert.equal(resolveBrandPackLocation("   "), null);
});
