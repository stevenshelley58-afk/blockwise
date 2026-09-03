import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyTemplateCopy,
  hasTemplateCopy,
  initialEditorState,
  resolveColourMap,
  templateCopyValues,
} from "../../src/components/adstudio/editor/use-editor-state.ts";
import { adDocumentSchema } from "../../packages/ad-template-contract/src/schema.ts";
import { InvalidActiveRevisionError } from "../../src/lib/adstudio/create-customer-ad.ts";
import type { AdTemplate } from "../../packages/ad-template-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Fixtures — a minimal portable template. New ads must start EMPTY; template
// copy is only ever inserted through the explicit checkbox.
// ---------------------------------------------------------------------------

function makeTemplate(): AdTemplate {
  return {
    schema: "blockwise.ad-template",
    templateId: "test-template",
    createdAt: "2026-01-01T00:00:00.000Z",
    feedLayout: { placement: "feed", layers: [], safeZones: [] },
    storyLayout: { placement: "story", layers: [], safeZones: [] },
    imageInputs: [{ key: "main_image", label: "Main image", required: true, acceptedTypes: ["image/png"] }],
    textInputs: [
      { key: "headline", label: "Headline", placeholder: "Template headline", maxLength: 40 },
      { key: "subline", label: "Sub-line", placeholder: "Template subline", maxLength: 60 },
    ],
    semanticColours: {
      background: "#ffffff",
      primary: "#0a4d2e",
      secondary: "#1f7a4d",
      accent: "#d9f2e5",
      mainText: "#111111",
      inverseText: "#ffffff",
    },
    assets: {},
    fonts: [],
    metadata: {
      title: "Test template",
      description: "",
      gallerySamples: {},
      // Direct-template architecture: suggested copy lives in metaCopyDefaults
      // only; overlay text ships placeholders, not persisted suggestions.
      metaCopyDefaults: {
        primaryText: ["Template primary text"],
        headlines: ["Template meta headline"],
        descriptions: ["Template description"],
        cta: "SIGN_UP",
      },
      aiWritingGuidance: { summary: "", fields: {} },
      publishRequirements: {
        objective: "OUTCOME_LEADS",
        specialAdCategory: null,
        instantForm: { required: false, dependency: null },
        destination: { required: false, kind: "none", dependency: null },
        requiredCtaTypes: [],
      },
      replacementAssets: [],
      realAssetRefs: [],
    },
  };
}

describe("new ads start with placeholders, not template copy", () => {
  it("initialEditorState leaves every text and Meta field empty", () => {
    const pack = makeTemplate();
    const state = initialEditorState(pack);
    for (const input of pack.textInputs) {
      assert.equal(state.textValues[input.key], "", `text input ${input.key} must start empty`);
    }
    assert.equal(state.metaCopy.primaryText, "");
    assert.equal(state.metaCopy.headline, "");
    assert.equal(state.metaCopy.description, "");
    // CTA keeps a valid default selection.
    assert.equal(state.metaCopy.cta, "LEARN_MORE");
    // Checkbox starts OFF with no provenance.
    assert.equal(state.templateCopyApplied, false);
    assert.deepEqual(state.templateFilled, { text: [], meta: [] });
  });

  it("restoring a saved ad never re-seeds template copy or flips the checkbox on", () => {
    // The hook seeds saved documents from initialEditorState + the document;
    // templateCopyApplied stays false and provenance is empty, so unchecking
    // can never erase saved customer copy.
    const source = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    assert.match(source, /templateCopyApplied: false/);
    assert.match(source, /templateFilled: \{ text: \[\], meta: \[\] \}/);
  });
});

describe("template-copy checkbox semantics", () => {
  it("reports whether a template offers copy", () => {
    assert.equal(hasTemplateCopy(makeTemplate()), true);
  });

  it("reads template copy without mutating the pack", () => {
    const pack = makeTemplate();
    const before = JSON.stringify(pack);
    const values = templateCopyValues(pack);
    assert.equal(values.metaCopy.cta, "SIGN_UP");
    assert.equal(values.metaCopy.primaryText, "Template primary text");
    assert.equal(values.metaCopy.headline, "Template meta headline");
    // Direct-template architecture: overlay text has placeholders, not
    // persisted suggestions, so the template copy map starts empty.
    assert.deepEqual(values.textValues, {});
    assert.equal(JSON.stringify(pack), before);
  });

  it("applyTemplateCopy fills only empty fields and records provenance", () => {
    const pack = makeTemplate();
    const customerText = "My own headline";
    const current = { headline: customerText, subline: "" };
    const currentMeta = { primaryText: "", headline: "", description: "My description", cta: "LEARN_MORE" };

    const result = applyTemplateCopy(current, currentMeta, pack);

    // Empty Meta fields got the template suggestion…
    assert.equal(result.metaCopy.primaryText, "Template primary text");
    assert.equal(result.metaCopy.headline, "Template meta headline");
    // …customer copy was never overwritten…
    assert.equal(result.textValues.headline, customerText);
    assert.equal(result.textValues.subline, "");
    assert.equal(result.metaCopy.description, "My description");
    // …and provenance lists exactly the filled fields.
    assert.deepEqual(result.filledText, {});
    assert.deepEqual(Object.keys(result.filledMeta).sort(), ["headline", "primaryText"]);
  });

  it("unchecking clears only still-unedited template-filled fields", () => {
    const pack = makeTemplate();
    const applied = applyTemplateCopy({ headline: "" }, { primaryText: "", headline: "", description: "", cta: "LEARN_MORE" }, pack);
    // Provenance covers exactly what the template filled (CTA kept its
    // customer selection, so it is not in provenance)…
    assert.deepEqual(Object.keys(applied.filledMeta), ["primaryText", "headline", "description"]);
    // …so a customer edit to a filled field leaves provenance for the rest:
    const editedMeta = { ...applied.metaCopy, primaryText: "Customer rewrite" };
    const remaining = Object.keys(applied.filledMeta).filter(f => f !== "primaryText");
    assert.deepEqual(remaining, ["headline", "description"]);
    // The hook's uncheck path clears exactly the remaining provenance keys:
    const source = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    assert.match(source, /for \(const key of prev\.templateFilled\.text\) textValues\[key\] = "";/);
    assert.match(source, /for \(const field of prev\.templateFilled\.meta\) metaCopy\[field as keyof MetaCopy\] = "";/);
    assert.equal(editedMeta.primaryText, "Customer rewrite");
  });

  it("editing a field removes it from template provenance", () => {
    const source = readFileSync("src/components/adstudio/editor/use-editor-state.ts", "utf8");
    // updateTextValue / updateMetaCopy drop the key from templateFilled.
    assert.match(source, /templateFilled\.text\.filter\(k => k !== key\)/);
    assert.match(source, /templateFilled\.meta\.filter\(f => f !== field\)/);
  });
});

describe("custom colour mode", () => {
  it("resolves custom mode from the customer's per-role palette", () => {
    const pack = makeTemplate();
    const custom = resolveColourMap(pack.semanticColours, "custom", null, {
      background: "#101010",
      primary: "#ff8800",
      mainText: "#fafafa",
    });
    assert.equal(custom.background, "#101010");
    assert.equal(custom.primary, "#ff8800");
    assert.equal(custom.mainText, "#fafafa");
    // Roles the customer did not set keep the template value.
    assert.equal(custom.accent, pack.semanticColours.accent);
    assert.equal(custom.inverseText, pack.semanticColours.inverseText);
  });

  it("never invents a palette in template mode", () => {
    const pack = makeTemplate();
    const resolved = resolveColourMap(pack.semanticColours, "template", null, { background: "#101010" });
    assert.deepEqual(resolved, pack.semanticColours);
  });

  it("brand pack roles override where the kit has a field", () => {
    const pack = makeTemplate();
    const resolved = resolveColourMap(pack.semanticColours, "brand_pack", { primary: "#0055ff" });
    assert.equal(resolved.primary, "#0055ff");
    assert.equal(resolved.background, pack.semanticColours.background);
  });

  it("the document schema accepts custom colour mode", () => {
    const doc = {
      schema: "blockwise.ad-document",
      templateId: "test-template",
      sharedImageValues: {},
      sharedTextValues: {},
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "custom",
      resolvedColourMap: { background: "#101010", primary: "#ff8800" },
      metaPrimaryText: "",
      metaHeadline: "",
      metaDescription: "",
      metaCta: "LEARN_MORE",
      revision: 1,
    };
    const parsed = adDocumentSchema.safeParse(doc);
    assert.equal(parsed.success, true);
  });
});

describe("business-name override (Brand Pack default, per-ad override)", () => {
  it("schema keeps brandBusinessName optional for old documents", () => {
    const legacy = {
      schema: "blockwise.ad-document",
      templateId: "test-template",
      sharedImageValues: {},
      sharedTextValues: {},
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "template",
      resolvedColourMap: {},
      metaPrimaryText: "",
      metaHeadline: "",
      metaDescription: "",
      metaCta: "LEARN_MORE",
      revision: 3,
    };
    const parsed = adDocumentSchema.safeParse(legacy);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.brandBusinessName, undefined);
  });

  it("schema accepts an explicit brandBusinessName override", () => {
    const doc = {
      schema: "blockwise.ad-document",
      templateId: "test-template",
      sharedImageValues: {},
      sharedTextValues: {},
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "template",
      resolvedColourMap: {},
      metaPrimaryText: "",
      metaHeadline: "",
      metaDescription: "",
      metaCta: "LEARN_MORE",
      brandBusinessName: "Jane's Plumbing",
      revision: 1,
    };
    const parsed = adDocumentSchema.safeParse(doc);
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.brandBusinessName, "Jane's Plumbing");
  });

  it("buildAdDocument serializes the override only when set", async () => {
    const { buildAdDocument } = await import("../../src/components/adstudio/editor/use-editor-state.ts");
    const pack = makeTemplate();

    const withName = initialEditorState(pack);
    withName.brandBusinessName = "  Jane's Plumbing  ";
    const namedDoc = await buildAdDocument(withName);
    assert.equal(namedDoc.brandBusinessName, "Jane's Plumbing");

    const withoutName = initialEditorState(pack);
    const anonDoc = await buildAdDocument(withoutName);
    assert.equal("brandBusinessName" in anonDoc, false);
  });
});

describe("malformed saved documents fail closed", () => {
  it("InvalidActiveRevisionError carries the revision ID and issues", () => {
    const error = new InvalidActiveRevisionError("rev-123", ["colourMode: invalid union option"]);
    assert.equal(error.revisionId, "rev-123");
    assert.deepEqual(error.issues, ["colourMode: invalid union option"]);
    assert.equal(error.code, "invalid_active_revision");
  });

  it("the stable ad route preserves the document, blocks saving, and offers read-only recovery", () => {
    const page = readFileSync("src/app/(customer)/ad-studio/ads/[id]/page.tsx", "utf8");
    assert.match(page, /RecoveryScreen/);
    assert.match(page, /InvalidActiveRevisionError/);
    assert.match(page, /revisionId=\{error\.revisionId\}/);
    assert.match(page, /issues=\{error\.issues\}/);
    assert.doesNotMatch(page, /detachDamagedRevision|detachActiveRevision|\.delete\(\)/);
  });

  it("the recovery branch exposes support evidence without an editor or mutation", () => {
    const page = readFileSync("src/app/(customer)/ad-studio/ads/[id]/page.tsx", "utf8");
    const recovery = page.slice(page.indexOf("function RecoveryScreen"));
    assert.match(recovery, /adId/);
    assert.match(recovery, /revisionId/);
    assert.match(recovery, /issues/);
    assert.doesNotMatch(recovery, /EditorShell|Save|detach|delete|update/);
  });
});

describe("Meta Feed and Story previews", () => {
  const source = readFileSync("src/components/adstudio/editor/meta-previews.tsx", "utf8");

  it("Feed preview carries the full Meta chrome and updates from editor state", () => {
    assert.match(source, /FeedPreview/);
    assert.match(source, /Sponsored/);
    assert.match(source, /ctaLabelText\(copy\.cta\)/);
    assert.match(source, /Like/);
    assert.match(source, /Comment/);
    assert.match(source, /Share/);
    assert.match(source, /copy\.primaryText/);
    assert.match(source, /copy\.headline/);
    assert.match(source, /copy\.description/);
    assert.match(source, /aspect-\[4\/5\]/);
  });

  it("Story preview is a full 9:16 presentation with progress bars and safe areas", () => {
    assert.match(source, /StoryPreview/);
    assert.match(source, /aspect-\[9\/16\]/);
    assert.match(source, /progress/i);
    assert.match(source, /ctaLabelText\(copy\.cta\)/);
  });

  it("both previews take the live business name and fall back to Brand Pack initials", () => {
    assert.match(source, /businessInitials/);
    assert.match(source, /businessName \|\| "Your business"/);
    assert.match(source, /logoUrl \?/);
  });
});

describe("publish reports active state honestly with safe retry", () => {
  const flow = readFileSync("src/app/(customer)/ad-studio/templates/[templateId]/publish/publish-flow.tsx", "utf8");
  const route = readFileSync("src/app/api/adstudio/ads/[id]/publish/route.ts", "utf8");

  it("publish is a single explicit action with no paused language", () => {
    assert.match(flow, /\{submitting \? "Publishing…" : "Publish"\}/);
    assert.doesNotMatch(flow, /Freeze & Create|Paused on Meta|Activate Campaign|paused ads/);
  });

  it("partial failure reports the real state and never claims the ad is active", () => {
    assert.match(flow, /Created on Meta — activation incomplete/);
    assert.match(flow, /nothing is running or spending/);
    assert.match(flow, /Published — active on Meta/);
  });

  it("retry targets the existing plan and never creates duplicates", () => {
    assert.match(flow, /RetryActivationSection/);
    assert.match(flow, /No new objects are created/);
    assert.match(route, /activationError/);
    assert.match(route, /status: unconfirmed \? "unknown" : "paused"/);
  });

  it("never reports a confirmed pause when the safety pause is unverified", () => {
    // Indeterminate compensation → distinct "unknown" state with honest
    // messaging, not a claimed pause while objects may be ACTIVE.
    assert.match(route, /activation_unconfirmed/);
    assert.match(route, /status: unconfirmed \? "unknown" : "paused"/);
    assert.match(route, /could not confirm that every object was paused/);
    assert.match(flow, /state unconfirmed/);
    // Both partial states offer the same idempotent safe retry.
    assert.match(flow, /receipt\.status === "paused" \|\| receipt\.status === "unknown"/);
  });

  it("the publish route verifies configured ACTIVE before reporting success", () => {
    assert.match(route, /campaign.*ACTIVE|ACTIVE.*campaign/s);
    assert.match(route, /adSets.*ACTIVE|ads.*ACTIVE/s);
  });
});
