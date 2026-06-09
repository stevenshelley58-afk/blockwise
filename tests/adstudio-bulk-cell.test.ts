import assert from "node:assert/strict";
import test from "node:test";

import {
  generateBulkCell,
  type BulkCellInput,
} from "../src/lib/adstudio/bulk-cell.ts";
import {
  createDeterministicImageProvider,
  createDeterministicTextProvider,
} from "../src/lib/adstudio/providers.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMockSupabase() {
  const variantRows: unknown[] = [];
  const creativeRows: unknown[] = [];

  const upsertChain = (store: unknown[]) => ({
    upsert: (row: unknown, _opts?: unknown) => {
      store.push(row);
      return Promise.resolve({ data: null, error: null });
    },
  });

  return {
    from: (table: string) => {
      if (table === "adstudio_campaign_variants") return upsertChain(variantRows);
      if (table === "adstudio_creatives") return upsertChain(creativeRows);
      throw new Error(`Unexpected table: ${table}`);
    },
    variantRows,
    creativeRows,
  };
}

function makeMinimalBrandKit(): AdStudioBrandKit {
  return {
    brandKitId: "bk-test-001",
    workspaceId: "ws-test-001",
    source: { type: "website", url: "https://example.com.au", lastExtractedAt: "2026-01-01T00:00:00Z", pagesScanned: [] },
    identity: {
      businessName: "Test Realty",
      tradingName: null,
      marketCountry: "AU",
      marketRegion: "WA",
      licenceText: null,
    },
    logos: { primaryLogoUrl: null, darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
    colours: {
      primary: "#003087",
      secondary: "#e8a000",
      accent: "#ffffff",
      background: "#f5f5f5",
      text: "#111111",
      confidence: { primary: 1, secondary: 1 },
    },
    typography: {
      headingFont: "Inter",
      bodyFont: "Inter",
      fallbackHeading: "sans-serif",
      fallbackBody: "sans-serif",
    },
    visualStyle: {
      styleTags: ["modern", "minimal"],
      imageTreatment: "clean",
      layoutDensity: "medium",
      cornerRadius: "small",
    },
    tone: { voice: "professional", avoid: [], preferredPhrases: [], sampleCopy: [] },
    assets: { headshots: [], officeImages: [], listingImages: [], socialProofImages: [] },
    contact: { phone: null, email: null, address: null, socialLinks: [] },
    compliance: { disclaimers: [], privacyPolicyUrl: null, termsUrl: null },
    reviewStatus: "approved",
    lockedFields: [],
  };
}

// A vision provider that always says the image is AU-quality and passes.
function makePassingVisionProvider() {
  return {
    ...createDeterministicTextProvider(),
    generate: async () => ({
      json: {
        pass: true,
        reasons: [],
        is_au_appropriate: true,
        has_us_cues: false,
        has_garbled_text: false,
        has_distorted_faces: false,
        has_warped_buildings: false,
        is_low_resolution: false,
      },
      rawText: "{}",
      usage: {},
      providerMetadata: { model: "gpt-4v-test" },
    }),
  };
}

// A vision provider that always fails QA.
function makeFailingVisionProvider() {
  return {
    ...createDeterministicTextProvider(),
    generate: async () => ({
      json: {
        pass: false,
        reasons: ["American mailbox visible"],
        has_us_cues: true,
        is_au_appropriate: false,
      },
      rawText: "{}",
      usage: {},
      providerMetadata: { model: "gpt-4v-test" },
    }),
  };
}

function baseInput(overrides: Partial<BulkCellInput> = {}): BulkCellInput {
  return {
    templateId: "market-report",
    suburb: "Scarborough",
    state: "WA",
    format: "1:1",
    brandKit: makeMinimalBrandKit(),
    visionProvider: makePassingVisionProvider(),
    imageProvider: createDeterministicImageProvider(),
    maxRolls: 3,
    ...overrides,
  };
}

// ─── Guardrail: listing templates require owned photo ─────────────────────────

test("generateBulkCell returns error for listing template without ownedPhotoUrl", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput({
    templateId: "listing-hero",
  }));

  assert.ok(result.error, "expected an error result");
  assert.match(result.error!, /owned/i, "error must mention owned property photo");
  assert.equal(result.variantId, "");
  assert.equal(result.imageUrl, "");
});

test("generateBulkCell returns error for 'sold' template without ownedPhotoUrl", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput({
    templateId: "sold-results",
  }));

  assert.ok(result.error);
});

test("generateBulkCell returns error for 'open home' template without ownedPhotoUrl", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput({
    templateId: "open-home-reminder",
  }));

  assert.ok(result.error);
});

test("generateBulkCell does NOT error for listing template when ownedPhotoUrl is provided", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput({
    templateId: "listing-hero",
    ownedPhotoUrl: "https://storage.test/property-photo.jpg",
  }));

  assert.equal(result.error, null);
});

// ─── Successful generation ────────────────────────────────────────────────────

test("generateBulkCell returns a draft result with correct shape on success", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput());

  assert.equal(result.error, null);
  assert.equal(result.status, "draft");
  assert.ok(result.variantId.length > 0, "variantId must be set");
  assert.ok(result.campaignId.length > 0, "campaignId must be set");
  assert.ok(result.imageUrl.length > 0, "imageUrl must be set");
  assert.ok(typeof result.score === "number", "score must be a number");
  assert.ok(typeof result.gateResults === "object", "gateResults must be an object");
});

test("generateBulkCell always sets status='draft'", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput());
  assert.equal(result.status, "draft");
});

test("generateBulkCell persists one variant row and one creative row on success", async () => {
  const mock = makeMockSupabase();
  await generateBulkCell(mock as never, baseInput());

  assert.equal(mock.variantRows.length, 1, "must persist exactly one variant row");
  assert.equal(mock.creativeRows.length, 1, "must persist exactly one creative row");
});

test("generateBulkCell persisted variant has status='draft'", async () => {
  const mock = makeMockSupabase();
  await generateBulkCell(mock as never, baseInput());

  const row = mock.variantRows[0] as Record<string, unknown>;
  assert.equal(row.status, "draft");
});

test("generateBulkCell creative canvas_json has bulk_generated=true", async () => {
  const mock = makeMockSupabase();
  await generateBulkCell(mock as never, baseInput());

  const creativeRow = mock.creativeRows[0] as Record<string, unknown>;
  const canvasJson = creativeRow.canvas_json as Record<string, unknown>;
  const metadata = canvasJson.metadata as Record<string, unknown>;
  assert.equal(metadata.bulk_generated, true);
});

// ─── Re-roll on QA failure ────────────────────────────────────────────────────

test("generateBulkCell returns error when all rolls fail vision QA", async () => {
  const mock = makeMockSupabase();
  const callCount = { n: 0 };

  const failingImageProvider = {
    ...createDeterministicImageProvider(),
    generate: async (input: { seed?: number; [k: string]: unknown }) => {
      callCount.n += 1;
      return {
        assetUrl: `asset://generated/fail-${input.seed ?? 0}.svg`,
        seed: input.seed ?? 0,
        model: "deterministic-svg",
        providerMetadata: {},
      };
    },
  };

  const result = await generateBulkCell(mock as never, baseInput({
    imageProvider: failingImageProvider,
    visionProvider: makeFailingVisionProvider(),
    maxRolls: 2,
  }));

  assert.ok(result.error, "expected error after all rolls fail");
  assert.equal(callCount.n, 2, "must attempt exactly maxRolls=2 times");
  assert.match(result.error!, /2.*image/i, "error must mention roll count");
});

test("generateBulkCell re-rolls and succeeds on second attempt", async () => {
  const mock = makeMockSupabase();
  let callCount = 0;

  const firstFailThenPassVision = {
    ...createDeterministicTextProvider(),
    generate: async () => {
      callCount += 1;
      const pass = callCount > 1;
      return {
        json: {
          pass,
          reasons: pass ? [] : ["American mailbox"],
          is_au_appropriate: pass,
          has_us_cues: !pass,
        },
        rawText: "{}",
        usage: {},
        providerMetadata: { model: "test" },
      };
    },
  };

  const result = await generateBulkCell(mock as never, baseInput({
    visionProvider: firstFailThenPassVision,
    maxRolls: 3,
  }));

  assert.equal(result.error, null, "should succeed on second roll");
  assert.equal(callCount, 2, "vision provider called twice (first fail, second pass)");
  assert.equal(mock.variantRows.length, 1, "must persist once after succeeding");
});

// ─── Style descriptor plumbing ────────────────────────────────────────────────

test("generateBulkCell styleProfileGuidance is null when no styleDescriptor", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput({ styleDescriptor: undefined }));
  assert.equal(result.styleProfileGuidance, null);
});

test("generateBulkCell styleProfileGuidance is populated from styleDescriptor", async () => {
  const mock = makeMockSupabase();
  const result = await generateBulkCell(mock as never, baseInput({
    styleDescriptor: {
      composition: "rule-of-thirds",
      crop: "wide",
      lighting: "golden hour",
      time_of_day: "evening",
      palette: ["#ff6600"],
      mood: "aspirational",
      lens: "wide",
      do_not_copy: true,
    },
  }));

  assert.ok(result.styleProfileGuidance, "styleProfileGuidance must be set");
  assert.match(result.styleProfileGuidance!, /rule-of-thirds/i);
  assert.match(result.styleProfileGuidance!, /golden hour/i);
});
