import assert from "node:assert/strict";
import test from "node:test";

import {
  AdStudioCopyLimitError,
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
  const longHeadline = "A beautifully renovated family home with room to grow";
  const parsed = parseCompleteAdStudioCopy({
    ...completeCopy,
    headline: `  ${longHeadline}  `,
  });
  assert.equal(parsed.headline, "A beautifully renovated family home with");
  assert.ok(parsed.headline.length <= 40);
  assert.equal(parsed.primaryText, completeCopy.primaryText);
});

test("over-limit Meta copy keeps complete sentences or words instead of hard-cutting", () => {
  const primaryText = "Saturday open home at 18 Smith Street. Download the free Seller Guide for practical next steps and local insights. Secure your copy before the inspection this weekend.";
  const description = "Get the latest local sales evidence and a practical property guide for your next move today with a tailored action plan for your suburb and property goals.";
  const parsed = parseCompleteAdStudioCopy({ ...completeCopy, primaryText, description });

  assert.ok(parsed.primaryText.length <= 125);
  assert.ok(parsed.description.length <= 90);
  assert.notEqual(parsed.primaryText, primaryText);
  assert.notEqual(parsed.description, description);
  assert.match(parsed.primaryText, /[.!?]$/);
  assert.ok(primaryText.startsWith(parsed.primaryText));
  assert.ok(description.startsWith(parsed.description));
  assert.match(primaryText.charAt(parsed.primaryText.length), /\s/);
  assert.match(description.charAt(parsed.description.length), /\s/);
  assert.doesNotMatch(parsed.primaryText, /Download the free S$/);
  assert.doesNotMatch(parsed.description, /Get the l$/);
});

test("an unbreakable over-limit token fails instead of displaying a broken word", () => {
  assert.throws(
    () => parseCompleteAdStudioCopy({ ...completeCopy, headline: "X".repeat(60) }),
    (error: unknown) => error instanceof AdStudioCopyLimitError && error.field === "copy.headline",
  );
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
