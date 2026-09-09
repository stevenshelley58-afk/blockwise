import assert from "node:assert/strict";
import test from "node:test";

import {
  KILL_TEST_COPY,
  customerCopyForAccessibleLabel,
} from "../e2e/adstudio-real-loop-copy-binding.ts";

test("real-loop on-image copy binds accessible sibling-label text to distinct customer values", () => {
  for (const [label, value] of Object.entries(KILL_TEST_COPY)) {
    assert.equal(customerCopyForAccessibleLabel(label, `copy-${label.replace(/\s/g, "-")}`), value);
  }
  assert.equal(customerCopyForAccessibleLabel("Website / handle", "copy-website"), KILL_TEST_COPY["website handle"]);
});

test("real-loop on-image copy refuses fields without a declared accessible-label binding", () => {
  assert.throws(
    () => customerCopyForAccessibleLabel("Campaign disclaimer", "copy-disclaimer"),
    /cannot bind on-image copy input "copy-disclaimer".*accessible label was "Campaign disclaimer"/,
  );
});
