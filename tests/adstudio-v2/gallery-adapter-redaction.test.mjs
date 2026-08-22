import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("customer gallery adapts only the canonical redacted provenance", () => {
  const adapter = readFileSync("src/lib/adstudio/v2/gallery-adapter.ts", "utf8");

  assert.match(adapter, /import \{ redactTemplateV2ForCustomer \} from "\.\/template-resolver"/);
  assert.match(adapter, /const customerDoc = redactTemplateV2ForCustomer\(doc\)/);
  assert.match(adapter, /sourceAd: customerDoc\.provenance\.sourceAd/);
  assert.doesNotMatch(adapter, /sourceAd: doc\.provenance\.sourceAd/);
});
