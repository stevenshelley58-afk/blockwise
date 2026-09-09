import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAndValidateExtractionUrl } from "../src/lib/adstudio/extraction-url.ts";

test("brand extraction keeps public DNS URLs and rejects every IPv6 literal", () => {
  assert.deepEqual(normalizeAndValidateExtractionUrl("https://agency.com.au/about"), {
    ok: true,
    url: "https://agency.com.au/about",
  });

  for (const value of [
    "https://[fec0::1]/",
    "https://[100::1]/",
    "https://[2001:2::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:100.64.0.1]/",
    "https://[::ffff:192.0.2.1]/",
    "https://[2606:4700:4700::1111]/",
  ]) {
    assert.deepEqual(
      normalizeAndValidateExtractionUrl(value),
      { ok: false, error: "Use your public agency website." },
      value,
    );
  }
});
