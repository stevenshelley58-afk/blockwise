import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAndValidateExtractionUrl } from "../extraction-url.ts";

test("blocks link-local IPv4 169.254.x.x", () => {
  const result = normalizeAndValidateExtractionUrl("http://169.254.169.254/");
  assert.equal(result.ok, false);
});

test("blocks CGNAT 100.64.x.x – 100.127.x.x", () => {
  const result = normalizeAndValidateExtractionUrl("http://100.100.100.100/");
  assert.equal(result.ok, false);
});

test("blocks IPv6 link-local fe80::/10", () => {
  const result = normalizeAndValidateExtractionUrl("http://[fe80::1]/");
  assert.equal(result.ok, false);
});

test("blocks IPv6 ULA fc00::/7 (fc prefix)", () => {
  const result = normalizeAndValidateExtractionUrl("http://[fc00::1]/");
  assert.equal(result.ok, false);
});

test("blocks IPv6 ULA fc00::/7 (fd prefix)", () => {
  const result = normalizeAndValidateExtractionUrl("http://[fd00::1]/");
  assert.equal(result.ok, false);
});

test("blocks IPv6-mapped link-local ::ffff:169.254.1.1", () => {
  const result = normalizeAndValidateExtractionUrl("http://[::ffff:169.254.1.1]/");
  assert.equal(result.ok, false);
});

test("blocks metadata.google.internal hostname", () => {
  const result = normalizeAndValidateExtractionUrl("http://metadata.google.internal/");
  assert.equal(result.ok, false);
});

test("allows a normal public HTTPS URL", () => {
  const result = normalizeAndValidateExtractionUrl("https://example.com/");
  assert.equal(result.ok, true);
  assert.ok(result.url?.startsWith("https://example.com"));
});
