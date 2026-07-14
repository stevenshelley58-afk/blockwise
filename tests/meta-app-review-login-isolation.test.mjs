import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/record-meta-app-review.mjs", "utf8");

test("Meta review recordings use a dedicated account instead of the operator login", () => {
  assert.match(
    source,
    /const reviewEmail = process\.env\.META_REVIEW_TEST_EMAIL \|\| "meta-review@blockwise\.sale";/,
  );
  assert.match(source, /BLOCKWISE_OPERATOR_EMAIL: reviewEmail,/);
  assert.doesNotMatch(
    source,
    /const reviewEmail = .*BLOCKWISE_OPERATOR_EMAIL.*steven@blockwise\.sale/,
  );
});
