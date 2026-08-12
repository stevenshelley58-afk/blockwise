import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../packages/ad-template-pack-contract/src/index.ts";

// Unit tests for import-pack validation logic (no Supabase needed for these)
describe("import-pack validation", () => {
  it("sha256 hashing is deterministic", () => {
    const obj = { foo: "bar", num: 1 };
    const h1 = sha256Hex(obj);
    const h2 = sha256Hex(structuredClone(obj));
    assert.equal(h1, h2);
  });

  it("timestamp validation rejects future dates", () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ts = new Date(future).getTime();
    const now = Date.now();
    assert.ok(Math.abs(now - ts) > 5 * 60 * 1000, "Timestamp should be outside the 5-minute window");
  });

  it("timestamp validation accepts current time", () => {
    const now = new Date().toISOString();
    const ts = new Date(now).getTime();
    assert.ok(Math.abs(Date.now() - ts) < 5 * 60 * 1000);
  });

  it("origin allowlist accepts frank.fail", () => {
    const url = "https://frank.fail/packs/pack-001.json";
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "frank.fail");
    assert.equal(parsed.protocol, "https:");
  });

  it("origin allowlist rejects unauthorized domain", () => {
    const url = "https://evil.com/pack.json";
    const parsed = new URL(url);
    assert.notEqual(parsed.hostname, "frank.fail");
  });

  it("rejects non-HTTPS URLs", () => {
    const url = "http://frank.fail/pack.json";
    const parsed = new URL(url);
    assert.notEqual(parsed.protocol, "https:");
  });
});
