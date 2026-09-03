import assert from "node:assert/strict";
import { test } from "node:test";

import { hydrateEditorMetaCopy, normalizeEditorMetaCopy } from "../../src/components/adstudio/editor/use-editor-state.ts";

test("authored Meta defaults fill historical blank documents without blocking later edits", () => {
  const authored = {
    primaryText: "Inspect this Saturday.",
    headline: "Modern family home",
    description: "Four bedrooms near the park.",
    cta: "CONTACT_US",
  };

  assert.deepEqual(hydrateEditorMetaCopy({ primaryText: "", headline: "", description: "", cta: "" }, authored), authored);
  assert.deepEqual(hydrateEditorMetaCopy({ headline: "Customer headline" }, authored), {
    ...authored,
    headline: "Customer headline",
  });
  assert.equal(normalizeEditorMetaCopy({ cta: "contact_us" }).cta, "CONTACT_US");
});
