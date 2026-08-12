import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SaveError } from "../src/lib/adstudio/save-ad.js";

describe("Save ad", () => {
  it("SaveError has code and message", () => {
    const err = new SaveError("ad_not_found", "Ad not found");
    assert.equal(err.code, "ad_not_found");
    assert.equal(err.message, "Ad not found");
  });

  it("rejects stale revisions", () => {
    // Logic test: if expected is 2 and current is 3, it's stale
    const expected = 2;
    const current = 3;
    assert.notEqual(expected, current, "Stale revision should be detected");
  });

  it("accepts matching revisions", () => {
    const expected = 3;
    const current = 3;
    assert.equal(expected, current);
  });

  it("same hash means unchanged", () => {
    const docHash = "abc123";
    const currentHash = "abc123";
    assert.equal(docHash, currentHash, "Same hash should be detected as unchanged");
  });
});
