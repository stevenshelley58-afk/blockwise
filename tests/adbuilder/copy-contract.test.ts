import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AdBuilderCopyNormalizationError,
  normalizeAdBuilderOnImage,
  normalizeAdBuilderCopy,
} from "../../src/lib/adbuilder/copy-generation.ts";
import { META_COPY_CONSTRAINTS, truncateAtWordBoundary } from "../../src/lib/adbuilder/meta-copy-contract.ts";
import { metaLeadAdPackSchema } from "../../src/lib/adbuilder/types.ts";
import { validateMetaCopyForSave, SaveError } from "../../src/lib/adbuilder/save-ad.ts";
import { truncateForPreview } from "../../src/components/adbuilder/editor/preview-text.ts";

test("Meta copy normalization clamps overlength provider fields and accepts singular or array values", () => {
  const singular = normalizeAdBuilderCopy({
    primaryText: "p".repeat(200),
    headline: "h".repeat(80),
    description: "d".repeat(80),
    cta: "learn more",
  });
  const arrays = normalizeAdBuilderCopy({
    primaryText: ["primary array value"],
    headlines: ["headline array value"],
    descriptions: ["description array value"],
    cta: "CONTACT US",
  });

  assert.equal(singular.primaryText.length, META_COPY_CONSTRAINTS.primaryText);
  assert.equal(singular.headline.length, META_COPY_CONSTRAINTS.headline);
  assert.equal(singular.description.length, META_COPY_CONSTRAINTS.description);
  assert.equal(singular.cta, "LEARN_MORE");
  assert.equal(arrays.headline, "headline array value");
  assert.equal(arrays.description, "description array value");
  assert.equal(arrays.cta, "CONTACT_US");
});

test("malformed provider copy fails explicitly instead of silently becoming empty", () => {
  assert.throws(
    () => normalizeAdBuilderCopy({ primaryText: [], headline: [], description: [], cta: "" }),
    (error: unknown) => error instanceof AdBuilderCopyNormalizationError && /primary text/.test(error.message),
  );
  const mapped = normalizeAdBuilderCopy({ primaryText: "ok", headline: "ok", description: "ok", cta: "Book free appraisal" });
  assert.equal(mapped.cta, "CONTACT_US");
});

test("missing provider fields are never masked by current copy, samples, or raw mid-word truncation", () => {
  assert.throws(
    () => normalizeAdBuilderCopy(
      { primaryText: "new primary", headline: "new headline", description: "new description" },
      { primaryText: "old primary", headline: "old headline", description: "old description", cta: "LEARN_MORE" },
    ),
    (error: unknown) => error instanceof AdBuilderCopyNormalizationError && /CTA/.test(error.message),
  );
  assert.throws(
    () => normalizeAdBuilderOnImage({}, [{ key: "address", label: "Address", sample: "123 Old Road" }]),
    (error: unknown) => error instanceof AdBuilderCopyNormalizationError && /address/.test(error.message),
  );
  assert.equal(
    normalizeAdBuilderOnImage(
      { address: "18 Smith Street Scarborough" },
      [{ key: "address", label: "Address", maxLength: 18, sample: "123 Old Road" }],
    ).address,
    "18 Smith Street",
  );
  assert.equal(truncateAtWordBoundary("18 Smith Street Scarborough", 18), "18 Smith Street");
});

test("provider schema normalizes singular Meta fields while retaining array output", () => {
  const parsed = metaLeadAdPackSchema.parse({
    platform: "meta",
    specialAdCategory: "housing",
    primaryText: "Primary",
    headlines: "Headline",
    descriptions: "Description",
    cta: "Learn more",
    leadForm: {
      headline: "Get the guide",
      questions: [],
      privacyPolicyUrl: null,
      thankYouScreen: { title: "Thanks", body: "We will be in touch." },
    },
  });
  assert.deepEqual(parsed.primaryText, ["Primary"]);
  assert.deepEqual(parsed.headlines, ["Headline"]);
  assert.deepEqual(parsed.descriptions, ["Description"]);
  assert.equal(parsed.cta, "LEARN_MORE");
});

test("server save validation rejects every overlength Meta field", () => {
  for (const [field, maxLength] of Object.entries(META_COPY_CONSTRAINTS)) {
    const copy = {
      metaPrimaryText: "",
      metaHeadline: "",
      metaDescription: "",
      metaCta: "LEARN_MORE",
    };
    const key = field === "primaryText" ? "metaPrimaryText" : field === "headline" ? "metaHeadline" : field === "description" ? "metaDescription" : "metaCta";
    copy[key] = "x".repeat(maxLength + 1);
    assert.throws(
      () => validateMetaCopyForSave(copy),
      (error: unknown) => error instanceof SaveError && error.code === "meta_copy_too_long",
    );
  }
});

test("preview truncation uses the exact editor contract", () => {
  assert.equal(truncateForPreview("x".repeat(200), META_COPY_CONSTRAINTS.primaryText).length, META_COPY_CONSTRAINTS.primaryText);
  assert.equal(truncateForPreview("x".repeat(80), META_COPY_CONSTRAINTS.description).length, META_COPY_CONSTRAINTS.description);
});

test("editor and preview keep the clarity and fidelity contracts visible", () => {
  const shell = readFileSync("src/components/adbuilder/editor/editor-shell.tsx", "utf8");
  const preview = readFileSync("src/components/adbuilder/editor/meta-previews.tsx", "utf8");
  const aiBrief = shell.indexOf("<ProposalPanel");
  const copyFields = shell.indexOf("<MetaCopyPanel");
  assert.ok(aiBrief >= 0 && aiBrief < copyFields, "AI brief must precede editable Meta fields");
  assert.match(shell, /label: "Photos"/);
  assert.match(shell, /grid-cols-\[2\.75rem_minmax\(0,1fr\)_2\.75rem_auto\]/);
  assert.match(shell, /aria-label="Ad format" value=\{placementView\}/);
  assert.match(shell, /col-span-4 flex min-w-0 items-center justify-between/);
  assert.match(shell, /min-h-11 min-w-11/);
  assert.match(shell, /pointer-events-none absolute inset-x-0/);
  assert.match(shell, /className="pointer-events-auto"/);
  assert.doesNotMatch(shell, /grid-rows-\[auto_auto_auto\]/);
  assert.doesNotMatch(preview, /👍|💬|↗/u);
  assert.doesNotMatch(preview, /your-business\.com\.au/);
  assert.match(preview, /ThumbsUp/);
  assert.match(preview, /startsWith\("\/"\)/);
});
