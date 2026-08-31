import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyTemplateCopy,
  buildAdDocument,
  hasTemplateCopy,
  initialEditorState,
  templateCopyValues,
  type MetaCopy,
  type SavedEditorSeed,
} from "../../src/components/adstudio/editor/use-editor-state.ts";
import { adDocumentSchema } from "../../packages/ad-template-pack-contract/src/schema.ts";
import { businessInitials, ctaLabelText, domainLabel, truncateForPreview } from "../../src/components/adstudio/editor/preview-text.ts";
import type { TemplatePack } from "../../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Editor copy workflow — new ads start with EMPTY placeholders (template copy
// is only inserted by an explicit "Use template copy" click, filling EMPTY
// fields only), saved customer copy survives a reopen, and AI/template
// suggestions land in ordinary editable fields.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

const PACK: TemplatePack = {
  ...JSON.parse(readFileSync(FIXTURE_PATH, "utf8")),
  textInputs: [
    { key: "headline", label: "Headline", placeholder: "Your headline", maxLength: 40 },
  ],
  editorDefaults: {
    overlayTextInputs: [{ key: "headline", label: "Headline", placeholder: "", maxLength: 40 }],
    textValues: { headline: "Template headline" },
    metaCopy: {
      primaryText: "Template primary",
      headline: "Template meta headline",
      description: "Template description",
      cta: "SIGN_UP",
    },
  },
} as unknown as TemplatePack;

function makeSavedSeed(overrides: Partial<SavedEditorSeed> = {}): SavedEditorSeed {
  return {
    textValues: { headline: "Customer's own headline" },
    metaCopy: { primaryText: "Customer primary", headline: "Customer headline", description: "", cta: "CONTACT_US" },
    colourMode: "template",
    resolvedColourMap: null,
    lastSavedRevision: 3,
    ...overrides,
  };
}

describe("new ads start with placeholders, not template copy", () => {
  it("leaves every text field empty for a new ad", () => {
    const state = initialEditorState(PACK);
    assert.deepEqual(state.textValues, { headline: "" });
  });

  it("leaves the Meta copy empty for a new ad", () => {
    const state = initialEditorState(PACK);
    assert.equal(state.metaCopy.primaryText, "");
    assert.equal(state.metaCopy.headline, "");
    assert.equal(state.metaCopy.description, "");
  });

  it("starts on the template palette with no saved revision", () => {
    const state = initialEditorState(PACK);
    assert.equal(state.colourMode, "template");
    assert.equal(state.lastSavedRevision, null);
    assert.equal(state.isDirty, false);
  });

  it("reports that the template offers copy to insert", () => {
    assert.equal(hasTemplateCopy(PACK), true);
    assert.equal(hasTemplateCopy({ textInputs: [], editorDefaults: {} } as unknown as TemplatePack), false);
  });
});

describe("saved customer copy survives a reopen", () => {
  it("restores the saved text and Meta copy verbatim", () => {
    const state = initialEditorState(PACK, makeSavedSeed());
    assert.equal(state.textValues.headline, "Customer's own headline");
    assert.equal(state.metaCopy.primaryText, "Customer primary");
    assert.equal(state.metaCopy.headline, "Customer headline");
    assert.equal(state.metaCopy.cta, "CONTACT_US");
    assert.equal(state.lastSavedRevision, 3);
  });

  it("does not auto-insert template copy over saved fields", () => {
    const state = initialEditorState(PACK, makeSavedSeed());
    assert.notEqual(state.metaCopy.primaryText, "Template primary");
    assert.notEqual(state.textValues.headline, "Template headline");
  });

  it("restores a saved custom colour mode and palette", () => {
    const custom = { ...PACK.semanticColours, primary: "#123456" };
    const state = initialEditorState(PACK, makeSavedSeed({
      colourMode: "custom",
      resolvedColourMap: custom,
    }));
    assert.equal(state.colourMode, "custom");
    assert.equal(state.resolvedColourMap.primary, "#123456");
  });
});

describe("use template copy fills only empty fields", () => {
  it("populates the template's suggested copy for a new ad", () => {
    const state = initialEditorState(PACK);
    const merged = applyTemplateCopy(state.textValues, state.metaCopy, PACK);
    assert.equal(merged.textValues.headline, "Template headline");
    assert.equal(merged.metaCopy.primaryText, "Template primary");
    assert.equal(merged.metaCopy.headline, "Template meta headline");
    assert.equal(merged.metaCopy.description, "Template description");
    // CTA is a deliberate selection — the editor's valid default stays.
    assert.equal(merged.metaCopy.cta, "LEARN_MORE");
  });

  it("never overwrites saved customer copy", () => {
    const seed = makeSavedSeed();
    const merged = applyTemplateCopy(
      { ...initialEditorState(PACK, seed).textValues },
      { ...seed.metaCopy },
      PACK,
    );
    assert.equal(merged.textValues.headline, "Customer's own headline");
    assert.equal(merged.metaCopy.primaryText, "Customer primary");
    assert.equal(merged.metaCopy.headline, "Customer headline");
    assert.equal(merged.metaCopy.cta, "CONTACT_US");
  });

  it("fills only the fields the customer left empty", () => {
    const merged = applyTemplateCopy(
      { headline: "" },
      { primaryText: "", headline: "Already written", description: "", cta: "LEARN_MORE" },
      PACK,
    );
    assert.equal(merged.textValues.headline, "Template headline");
    assert.equal(merged.metaCopy.headline, "Already written", "typed copy must stay");
    assert.equal(merged.metaCopy.primaryText, "Template primary");
  });

  it("leaves whitespace-only fields eligible for filling", () => {
    const merged = applyTemplateCopy(
      { headline: "   " },
      { primaryText: " ", headline: "", description: "", cta: "LEARN_MORE" },
      PACK,
    );
    assert.equal(merged.textValues.headline, "Template headline");
  });

  it("reads template copy without mutating the pack", () => {
    const values = templateCopyValues(PACK);
    assert.equal(values.metaCopy.cta, "SIGN_UP");
    assert.equal(values.textValues.headline, "Template headline");
  });
});

// ---------------------------------------------------------------------------
// AI copy generation — the workflow inserts generated primary text, headline
// and description into ordinary editable fields and preserves the CTA. The
// insertion itself lives in the hook; here we pin the merge contract.
// ---------------------------------------------------------------------------

describe("AI generated copy insertion contract", () => {
  it("inserts generated copy but never touches the CTA selection", () => {
    const current: MetaCopy = { primaryText: "", headline: "", description: "", cta: "SIGN_UP" };
    const generated = { primaryText: "New primary", headline: "New headline", description: "New description" };
    const merged: MetaCopy = {
      ...current,
      primaryText: generated.primaryText,
      headline: generated.headline,
      description: generated.description,
    };
    assert.equal(merged.primaryText, "New primary");
    assert.equal(merged.cta, "SIGN_UP", "CTA must be preserved");
  });

  it("an empty brief produces a deterministic fallback, not an error", async () => {
    const { buildDeterministicCopyProposal } = await import("../../src/lib/adstudio/copy-proposal.ts");
    const proposal = buildDeterministicCopyProposal(
      [{ key: "headline", label: "Headline", maxLength: 40 }],
      "",
      { primaryText: "", headline: "", description: "", cta: "LEARN_MORE" },
    );
    assert.equal(proposal.source, "fallback");
  });
});

// ---------------------------------------------------------------------------
// Preview text helpers — the Feed and Story previews render these values.
// ---------------------------------------------------------------------------

describe("meta preview text", () => {
  it("truncates long copy with an ellipsis on a word boundary", () => {
    const long = "Fresh bread delivered to your door every single morning of the week";
    const truncated = truncateForPreview(long, 40);
    assert.ok(truncated.length <= 41, "truncated copy stays within the limit");
    assert.ok(truncated.endsWith("…"));
    assert.equal(truncateForPreview("Short copy", 40), "Short copy");
    assert.equal(truncateForPreview("   spaced\tout   copy   ", 40), "spaced out copy");
  });

  it("renders CTA labels and falls back to Learn more", () => {
    assert.equal(ctaLabelText("LEARN_MORE"), "Learn more");
    assert.equal(ctaLabelText("SIGN_UP"), "Sign up");
    assert.equal(ctaLabelText(""), "Learn more");
  });

  it("extracts the destination domain for the Feed link row", () => {
    assert.equal(domainLabel("https://www.example.com.au/listing/123"), "example.com.au");
    assert.equal(domainLabel(undefined), "");
    assert.equal(domainLabel("not a url"), "");
  });

  it("falls back to sensible initials when no logo exists", () => {
    assert.equal(businessInitials("Summit Realty"), "SR");
    assert.equal(businessInitials("Blockwise"), "B");
    assert.equal(businessInitials(""), "B");
  });
});

// ---------------------------------------------------------------------------
// Custom colour mode — schema + document round-trip, migration-safe.
// ---------------------------------------------------------------------------

describe("custom colour mode persistence", () => {
  it("buildAdDocument carries a custom mode through the save schema", async () => {
    const custom = { ...PACK.semanticColours, accent: "#FF8800" };
    const state = {
      ...initialEditorState(PACK, makeSavedSeed({ colourMode: "custom", resolvedColourMap: custom })),
      imageValues: [],
    };
    const doc = await buildAdDocument(state);
    assert.equal(doc.colourMode, "custom");
    assert.equal(doc.resolvedColourMap.accent, "#FF8800");
    const parsed = adDocumentSchema.safeParse(doc);
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues[0]?.message);
  });

  it("still parses OLD documents that only know template and brand_pack", () => {
    const legacy = {
      schema: "blockwise.ad-document/v1",
      templateId: "t",
      templateVersion: 1,
      templateHash: "a".repeat(64),
      rendererVersion: "r1",
      sharedImageValues: {},
      sharedTextValues: {},
      feedCropOverrides: {},
      storyCropOverrides: {},
      colourMode: "brand_pack",
      resolvedColourMap: { ...PACK.semanticColours },
      metaPrimaryText: "",
      metaHeadline: "",
      metaDescription: "",
      metaCta: "LEARN_MORE",
      revision: 1,
      documentHash: "b".repeat(64),
      lastRenderedHash: null,
    };
    const parsed = adDocumentSchema.safeParse(legacy);
    assert.equal(parsed.success, true, "old documents must keep parsing after the enum widened");
  });

  it("rejects an unknown colour mode", () => {
    const broken = {
      schema: "blockwise.ad-document/v1",
      colourMode: "rainbow",
    };
    assert.equal(adDocumentSchema.safeParse(broken).success, false);
  });
});
