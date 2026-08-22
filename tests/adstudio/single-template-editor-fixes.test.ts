import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readEditorDefaults, type MetaCopy } from "../../src/components/adstudio/editor/use-editor-state.ts";
import { readGallerySampleUrl } from "../../src/lib/adstudio/pack-gallery.ts";
import { buildDeterministicCopyProposal } from "../../src/lib/adstudio/copy-proposal.ts";
import { normalizeAdStudioAiWritingGuidance } from "../../src/lib/adstudio/copy-generation.ts";
import { formatCampaignInput } from "../../src/lib/operator/prompts/assemble-prompt.ts";
import type { TemplatePack } from "../../packages/ad-template-pack-contract/src/types.ts";

const pack = {
  textInputs: [{ key: "title", label: "Title", placeholder: "", maxLength: 40 }],
  editorDefaults: {
    overlayTextInputs: [{ key: "overlay", label: "Overlay text", placeholder: "", maxLength: 32 }],
    textValues: { overlay: "A calm local move" },
    metaCopy: { headline: "Your next move" },
  },
} as unknown as TemplatePack;

describe("single-template editor fixes", () => {
  it("reads v2 overlay and Meta defaults without changing the portable pack contract", () => {
    const defaults = readEditorDefaults(pack);
    assert.deepEqual(defaults.textInputs.map(input => input.key), ["overlay"]);
    assert.equal(defaults.textValues.overlay, "A calm local move");
    assert.equal(defaults.metaCopy.headline, "Your next move");
  });

  it("reads portable v2 metadata defaults and gallery URLs", () => {
    const portable = {
      ...pack,
      metadata: {
        title: "Portable title",
        gallerySamples: { feed: { url: "https://frank.fail/sample.png" } },
        metaCopyDefaults: { primaryText: ["Primary"], headlines: ["Headline"], descriptions: ["Description"], cta: "LEARN_MORE" },
        aiWritingGuidance: { summary: "Be concise", fields: {} },
      },
    } as unknown as TemplatePack;
    const defaults = readEditorDefaults(portable);
    assert.equal(defaults.metaCopy.headline, "Headline");
    assert.equal(readGallerySampleUrl(portable), "https://frank.fail/sample.png");
  });

  it("prefers an imported gallery sample and keeps legacy fallback data absent", () => {
    assert.equal(readGallerySampleUrl({ gallerySample: { feed: { imageSrc: "/sample.png" } } }), "/sample.png");
    assert.equal(readGallerySampleUrl({ metadata: { gallerySamples: { feed: { url: "https://frank.fail/releases/v2/feed.png" } } } }), "https://frank.fail/releases/v2/feed.png");
    assert.equal(readGallerySampleUrl({ safePreviews: { feed: { sha256: "a".repeat(64) } } }), null);
  });

  it("returns copy suggestions without mutating the current copy", () => {
    const current: MetaCopy = { primaryText: "Current", headline: "Current", description: "Current", cta: "LEARN_MORE" };
    const proposal = buildDeterministicCopyProposal([{ key: "overlay", label: "Overlay", maxLength: 24 }], "Saturday appraisal in Subiaco", current);
    assert.equal(proposal.source, "fallback");
    assert.equal(current.headline, "Current");
    assert.equal(proposal.onImage.overlay, "Saturday appraisal in Su");
  });

  it("uses template field guidance in deterministic proposals and enforces guidance limits", () => {
    const guidance = normalizeAdStudioAiWritingGuidance({
      summary: "s".repeat(900),
      fields: { overlay: "g".repeat(400), second: "ok", ignored: 4 },
    });
    assert.equal(guidance?.summary.length, 600);
    assert.equal(guidance?.fields.overlay.length, 240);
    const proposal = buildDeterministicCopyProposal(
      [{ key: "overlay", label: "Overlay", maxLength: 80 }],
      "Saturday appraisal in Subiaco",
      {},
      guidance,
    );
    assert.match(proposal.onImage.overlay, /Saturday appraisal/);
    assert.doesNotMatch(proposal.onImage.overlay, /g{10}/);
    const promptContext = formatCampaignInput({ mode: "brief", templateName: "Open Home", aiWritingGuidance: guidance });
    assert.match(promptContext, /Template writing guidance/);
    assert.match(promptContext, /overlay/);
  });
});
