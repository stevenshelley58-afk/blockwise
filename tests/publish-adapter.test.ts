import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePublishState, PublishError } from "../src/lib/adstudio/publish-adapter.js";
import type { TemplatePack } from "../packages/ad-template-pack-contract/src/types.js";

const mockPack: TemplatePack = {
  schema: "blockwise.template-pack/v1",
  templateId: "test-001",
  version: 1,
  packId: "pack-test-001-v1",
  createdAt: new Date().toISOString(),
  builderVersion: "v1",
  rendererVersion: "v1",
  classification: { label: "test", modelVersion: "v1", confidence: 0.9 },
  manifestSha256: "0".repeat(64),
  signature: "sig",
  feedLayout: { placement: "feed", layers: [], safeZones: [] },
  storyLayout: { placement: "story", layers: [], safeZones: [] },
  imageInputs: [],
  textInputs: [],
  semanticColours: { background: "#FFF", primary: "#00F", secondary: "#666", accent: "#F90", mainText: "#111", inverseText: "#FFF" },
  assets: {},
  fonts: [],
  safePreviews: { feed: { sha256: "f".repeat(64) }, story: { sha256: "f".repeat(64) } },
  qaEvidence: { feedPassed: true, storyPassed: true, reviewerVersions: ["v1"], stressFixtureResults: {} },
};

const validState = {
  ad: {
    id: "ad-001",
    templatePackId: "pack-test-001-v1",
    colourMode: "template" as const,
    metaPrimaryText: "Primary text",
    metaHeadline: "Headline",
    metaDescription: "Description",
    metaCta: "LEARN_MORE",
  },
  revision: {
    id: "rev-001",
    revisionNumber: 1,
    documentHash: "abc123",
    feedPngHash: "feed-hash",
    feedPngPath: "feeds/test.png",
    storyPngHash: "story-hash",
    storyPngPath: "stories/test.png",
  },
  pack: mockPack,
  form: {
    name: "Test Form",
    formType: "more_volume" as const,
    intro: { headline: "Hi", body: "Hello" },
    contactFields: [{ type: "email" as const, required: true }, { type: "full_name" as const, required: true }],
    customQuestions: [],
    privacy: { url: "https://example.com/privacy", linkText: "Privacy" },
    thankYou: { title: "Thanks", body: "Done", actionType: "visit_website" as const },
  },
};

describe("Publish adapter", () => {
  it("validates complete state", () => {
    const issues = validatePublishState(validState);
    assert.equal(issues.length, 0, JSON.stringify(issues));
  });

  it("detects missing Feed PNG", () => {
    const s = structuredClone(validState);
    s.revision.feedPngHash = "";
    assert.ok(validatePublishState(s).some(i => i.includes("Feed PNG")));
  });

  it("detects missing Story PNG", () => {
    const s = structuredClone(validState);
    s.revision.storyPngHash = "";
    assert.ok(validatePublishState(s).some(i => i.includes("Story PNG")));
  });

  it("detects missing primary text", () => {
    const s = structuredClone(validState);
    s.ad.metaPrimaryText = "";
    assert.ok(validatePublishState(s).some(i => i.includes("primary text")));
  });

  it("detects missing headline", () => {
    const s = structuredClone(validState);
    s.ad.metaHeadline = "";
    assert.ok(validatePublishState(s).some(i => i.includes("headline")));
  });

  it("detects missing CTA", () => {
    const s = structuredClone(validState);
    s.ad.metaCta = "";
    assert.ok(validatePublishState(s).some(i => i.includes("CTA")));
  });

  it("detects missing form", () => {
    const s = structuredClone(validState);
    (s as any).form = null;
    assert.ok(validatePublishState(s).some(i => i.includes("Instant Form")));
  });

  it("PublishError has code and message", () => {
    const err = new PublishError("not_saved", "Save first");
    assert.equal(err.code, "not_saved");
    assert.equal(err.message, "Save first");
  });
});
