import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";
import {
  mapAdStudioLibraryTemplate,
  mergeAdStudioTemplateLibrary,
  type AdStudioLibraryTemplate,
} from "../src/lib/adstudio/templates.ts";

const fixture = JSON.parse(readFileSync("tests/fixtures/adstudio-template-engine-foundation.json", "utf8")) as {
  creativeSkeletons: unknown[];
};
const skeleton = creativeSkeletonSchema.parse(fixture.creativeSkeletons[0]);

function row(input: Partial<AdStudioLibraryTemplate>): AdStudioLibraryTemplate {
  return {
    template_key: input.template_key ?? "TPL-1",
    status: "approved",
    category: input.category ?? "appraisal",
    adstudio_template_id: input.adstudio_template_id ?? "meta_002",
    offer_id: "home_value_update",
    goal: "appraisal_bookings",
    headline: input.headline ?? "Find out what your home is worth",
    primary_text: input.primary_text ?? "Book a local appraisal with a practical market read.",
    cta: "Book appraisal",
    evidence_score: input.evidence_score ?? 50,
    sample_card_image_path: input.sample_card_image_path,
    sample_style: input.sample_style,
    creative_skeleton: input.creative_skeleton,
    exemplar_observed_ad_ids: input.exemplar_observed_ad_ids,
  };
}

test("template library pins skeleton-backed templates before older evidence-only rows", () => {
  const leakedPreviewRow = row({
    template_key: "DNA-70",
    category: "creative dna",
    hook_style: "markets don't guarantee great outcomes",
    headline: "Don't undersell your home, call Andy Nye",
    primary_text: "The real competitor wording should not appear in the template picker.",
    evidence_score: 70,
    creative_skeleton: skeleton,
    exemplar_observed_ad_ids: ["observed-ad-1"],
  }) as AdStudioLibraryTemplate & { preview_image_url: string };
  leakedPreviewRow.preview_image_url = "https://cdn.example/observed-ad-1.jpg";

  const approved = [
    row({ template_key: "OLD-99", category: "legacy", evidence_score: 99 }),
    leakedPreviewRow,
  ]
    .map((template) => mapAdStudioLibraryTemplate(template))
    .filter((template) => template !== null);

  const merged = mergeAdStudioTemplateLibrary(approved);

  assert.equal(merged[0]?.id, "DNA-70");
  assert.equal(merged[0]?.creativeSkeleton?.archetype, skeleton.archetype);
  assert.deepEqual(merged[0]?.exemplars, ["observed-ad-1"]);
  assert.equal("previewImageUrl" in merged[0], false);
  assert.doesNotMatch(merged[0]?.promptHint ?? "", /undersell|Andy Nye|competitor wording/i);
  assert.doesNotMatch(merged[0]?.name ?? "", /markets don't guarantee|creative dna/i);
  assert.ok(
    merged.findIndex((template) => template.id === "DNA-70") < merged.findIndex((template) => template.id === "OLD-99"),
  );
});

test("template library exposes only generated sample-card URLs, not observed media URLs", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
  try {
    const safe = mapAdStudioLibraryTemplate(
      row({
        template_key: "HV-01",
        headline: "How much is your {{suburb}} home worth?",
        primary_text: "Get a practical {{suburb}} price update.",
        description: "Free {{suburb}} price update",
        cta: "Request price update",
        sample_card_image_path: "adstudio-samples/v1/hv-01.png",
      }),
    );
    assert.ok(safe);
    assert.equal(
      safe.sampleCardImageUrl,
      "https://supabase.example/storage/v1/object/public/template-cards/adstudio-samples/v1/hv-01.png",
    );
    assert.match(safe.sampleCopy?.headline ?? "", /Scarborough|Bicton|Maylands|Cottesloe|Victoria Park|Fremantle/);

    const unsafe = mapAdStudioLibraryTemplate(
      row({
        template_key: "HV-02",
        sample_card_image_path: "https://cdn.example/observed-ad.jpg",
      }),
    );
    assert.ok(unsafe);
    assert.equal("sampleCardImageUrl" in unsafe, false);
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
    }
  }
});

test("template library hides old first-pass rows from the visible picker merge", () => {
  const oldRows = [
    row({ template_key: "HV-01", adstudio_template_id: "free_appraisal", evidence_score: 99 }),
    row({ template_key: "MU-01", adstudio_template_id: "market_update", evidence_score: 98 }),
  ]
    .map((template) => mapAdStudioLibraryTemplate(template))
    .filter((template) => template !== null);

  assert.ok(oldRows.every((template) => template.manualFirstPass), "legacy-backed rows should be marked hidden");

  const merged = mergeAdStudioTemplateLibrary(oldRows);
  assert.ok(!merged.some((template) => template.id === "HV-01" || template.id === "MU-01"));
  assert.ok(merged.some((template) => template.id === "meta_002"));
});
