import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePublishState, PublishError, buildPausedMetaPublishPlan, buildStubForm } from "../src/lib/adstudio/publish-adapter.ts";
import type { TemplatePack } from "../packages/ad-template-pack-contract/src/types.ts";

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

// ---------------------------------------------------------------------------
// BW-M — paused publish plan builder
// ---------------------------------------------------------------------------

const mockSetup = {
  metaAdAccountId: "act_123",
  pageId: "page_456",
  instagramActorId: null,
  pixelId: null,
  leadDestination: { type: "manual" as const, label: "Manual review" },
  privacyPolicyUrl: "https://example.com/privacy",
  currency: "AUD",
  timezone: "Australia/Perth",
};

describe("buildPausedMetaPublishPlan", () => {
  const plan = buildPausedMetaPublishPlan({
    adId: "ad-001",
    workspaceId: "ws-001",
    connectionId: "conn-001",
    setup: mockSetup,
    state: validState,
  });

  it("creates a campaign PAUSED with housing category", () => {
    assert.equal(plan.campaign.status, "PAUSED");
    assert.equal(plan.campaign.objective, "OUTCOME_LEADS");
    assert.deepEqual(plan.campaign.specialAdCategories, ["HOUSING"]);
  });

  it("creates one ad set PAUSED", () => {
    assert.equal(plan.adSets.length, 1);
    assert.equal(plan.adSets[0]!.status, "PAUSED");
    assert.equal(plan.adSets[0]!.campaignLocalId, "campaign_main");
    assert.equal(plan.adSets[0]!.dailyBudgetMinorUnits, 2000);
  });

  it("creates a lead form from the Instant Form", () => {
    assert.equal(plan.leadForms.length, 1);
    assert.equal(plan.leadForms[0]!.privacyPolicyUrl, mockSetup.privacyPolicyUrl);
    assert.ok(plan.leadForms[0]!.headline.length > 0);
  });

  it("creates feed + story creatives PAUSED referencing revision PNGs", () => {
    assert.equal(plan.creatives.length, 2);
    assert.deepEqual(plan.creatives.map(c => c.format).sort(), ["4:5", "9:16"]);
    for (const creative of plan.creatives) {
      assert.equal(creative.asset?.source, "storage");
      assert.ok(creative.asset?.storagePath);
    }
  });

  it("creates two ads PAUSED", () => {
    assert.equal(plan.ads.length, 2);
    for (const ad of plan.ads) {
      assert.equal(ad.status, "PAUSED");
    }
  });

  it("never reports live — plan status is draft and ads are PAUSED", () => {
    assert.equal(plan.status, "draft");
    assert.ok(!JSON.stringify(plan).toLowerCase().includes("live"));
  });

  it("is deterministic for the same frozen revision", () => {
    const again = buildPausedMetaPublishPlan({
      adId: "ad-001",
      workspaceId: "ws-001",
      connectionId: "conn-001",
      setup: mockSetup,
      state: validState,
    });
    assert.equal(plan.planId, again.planId);
    assert.equal(plan.idempotencyKey, again.idempotencyKey);
  });

  it("changes plan identity when the frozen revision changes", () => {
    const changed = structuredClone(validState);
    changed.revision.id = "rev-002";
    changed.revision.revisionNumber = 2;
    const again = buildPausedMetaPublishPlan({
      adId: "ad-001",
      workspaceId: "ws-001",
      connectionId: "conn-001",
      setup: mockSetup,
      state: changed,
    });
    assert.notEqual(plan.planId, again.planId);
  });

  it("uses a stub form when the state has none", () => {
    const noForm = structuredClone(validState);
    (noForm as any).form = null;
    const stubPlan = buildPausedMetaPublishPlan({
      adId: "ad-001",
      workspaceId: "ws-001",
      connectionId: "conn-001",
      setup: mockSetup,
      state: noForm,
    });
    assert.equal(stubPlan.leadForms.length, 1);
    assert.ok(stubPlan.leadForms[0]!.headline.length > 0);
  });
});

describe("buildStubForm", () => {
  it("produces a valid lead form shape from the frozen state", () => {
    const form = buildStubForm(validState, mockSetup);
    assert.ok(form.name.length > 0);
    assert.ok(form.contactFields.some(f => f.type === "email"));
    assert.equal(form.privacy.url, mockSetup.privacyPolicyUrl);
    assert.equal(form.thankYou.actionType, "visit_website");
  });
});
