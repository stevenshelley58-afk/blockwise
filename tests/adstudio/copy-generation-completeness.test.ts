import assert from "node:assert/strict";
import test from "node:test";

import {
  IncompleteAdStudioCopyResponseError,
  parseCompleteAdStudioCopy,
  parseCompleteAdStudioTemplateCopy,
} from "../../src/lib/adstudio/copy-generation.ts";

const completeCopy = {
  primaryText: "A bright home, open this Saturday.",
  headline: "See 18 Smith Street",
  description: "Request the property guide.",
  cta: "DOWNLOAD",
};

test("complete AI output is trimmed and constrained to editor limits", () => {
  const parsed = parseCompleteAdStudioCopy({
    ...completeCopy,
    headline: `  ${"H".repeat(60)}  `,
  });
  assert.equal(parsed.headline, "H".repeat(40));
  assert.equal(parsed.primaryText, completeCopy.primaryText);
});

test("missing Meta output rejects instead of falling back to existing copy", () => {
  assert.throws(
    () => parseCompleteAdStudioCopy({ ...completeCopy, description: "" }),
    (error: unknown) => {
      assert.ok(error instanceof IncompleteAdStudioCopyResponseError);
      assert.deepEqual(error.missingFields, ["copy.description"]);
      return true;
    },
  );
});

test("missing on-image output rejects instead of using template sample text", () => {
  assert.throws(
    () => parseCompleteAdStudioTemplateCopy(
      { ...completeCopy, onImage: { headline: "Open this Saturday" } },
      [
        { key: "headline", label: "Headline", maxLength: 32, sample: "JUST LISTED" },
        { key: "address", label: "Address", maxLength: 70, sample: "PROPERTY ADDRESS" },
      ],
    ),
    (error: unknown) => {
      assert.ok(error instanceof IncompleteAdStudioCopyResponseError);
      assert.deepEqual(error.missingFields, ["onImage.address"]);
      return true;
    },
  );
});

test("undeclared on-image fields fail closed", () => {
  assert.throws(
    () => parseCompleteAdStudioTemplateCopy(
      { ...completeCopy, onImage: { headline: "Open this Saturday", invented: "Do not apply" } },
      [{ key: "headline", label: "Headline", maxLength: 32 }],
    ),
    (error: unknown) => {
      assert.ok(error instanceof IncompleteAdStudioCopyResponseError);
      assert.deepEqual(error.unexpectedFields, ["onImage.invented"]);
      return true;
    },
  );
});
