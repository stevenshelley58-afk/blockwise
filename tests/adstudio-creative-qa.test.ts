import assert from "node:assert/strict";
import test from "node:test";

import {
  SCORE_GATE_THRESHOLD,
  runComplianceGate,
  runCreativeQA,
  runRenderedTileQA,
  runScoreGate,
  runSkeletonQA,
  runSimilarityGuard,
  runVisionQA,
  type ScoreDimensions,
} from "../src/lib/adstudio/creative-qa.ts";
import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";
import { createDeterministicTextProvider, type TextProviderRequest } from "../src/lib/adstudio/providers.ts";
import { extractBrandKitFromWebsite, generateAdStudioCampaignPack } from "../src/lib/adstudio/index.ts";
import { PROMPT_FALLBACKS } from "../src/lib/operator/prompts/prompt-registry.ts";

// ─── runVisionQA ─────────────────────────────────────────────────────────────

function makeVisionProvider(json: Record<string, unknown>) {
  return {
    ...createDeterministicTextProvider(),
    generate: async () => ({
      json,
      rawText: JSON.stringify(json),
      usage: {},
      providerMetadata: { model: "gpt-4-vision-test" },
    }),
  };
}

test("runVisionQA passes when provider returns pass:true", async () => {
  const provider = makeVisionProvider({
    pass: true,
    reasons: [],
    is_au_appropriate: true,
    has_us_cues: false,
    has_garbled_text: false,
    has_distorted_faces: false,
    has_warped_buildings: false,
    is_low_resolution: false,
  });

  const result = await runVisionQA("https://cdn.test/ad-01.jpg", provider);
  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});

test("runVisionQA fails when provider returns pass:false with has_us_cues", async () => {
  const provider = makeVisionProvider({
    pass: false,
    reasons: [],
    is_au_appropriate: false,
    has_us_cues: true,
    has_garbled_text: false,
    has_distorted_faces: false,
    has_warped_buildings: false,
    is_low_resolution: false,
  });

  const result = await runVisionQA("https://cdn.test/ad-02.jpg", provider);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.length > 0, "must populate reasons");
  assert.ok(
    result.reasons.some((r) => /us cues/i.test(r)),
    `expected 'us cues' in reasons, got: ${JSON.stringify(result.reasons)}`,
  );
});

test("runVisionQA collects multiple failure flags into reasons", async () => {
  const provider = makeVisionProvider({
    pass: false,
    reasons: [],
    is_au_appropriate: false,
    has_us_cues: true,
    has_garbled_text: true,
    has_distorted_faces: false,
    has_warped_buildings: false,
    is_low_resolution: true,
  });

  const result = await runVisionQA("https://cdn.test/ad-03.jpg", provider);
  assert.equal(result.pass, false);
  assert.equal(result.reasons.length, 3, "should collect 3 flag reasons");
});

test("runVisionQA uses reasons from provider when already populated", async () => {
  const provider = makeVisionProvider({
    pass: false,
    reasons: ["American mailbox visible", "flag cue detected"],
    has_us_cues: true,
  });

  const result = await runVisionQA("https://cdn.test/ad-04.jpg", provider);
  assert.equal(result.pass, false);
  assert.deepEqual(result.reasons, ["American mailbox visible", "flag cue detected"]);
});

test("runVisionQA defaults to the registry adstudio.qa.v1 prompt and forwards a custom one", async () => {
  let captured = "";
  const provider = {
    ...createDeterministicTextProvider(),
    generate: async (request: TextProviderRequest) => {
      captured = request.system;
      return { json: { pass: true, reasons: [] }, rawText: "{}", usage: {}, providerMetadata: {} };
    },
  };

  await runVisionQA("https://cdn.test/a.jpg", provider);
  assert.equal(captured, PROMPT_FALLBACKS["adstudio.qa.v1"], "defaults to the registry QA prompt, not an inline literal");

  await runVisionQA("https://cdn.test/a.jpg", provider, "OPERATOR OVERRIDE PROMPT");
  assert.equal(captured, "OPERATOR OVERRIDE PROMPT", "forwards the operator's active QA prompt");
});

test("runRenderedTileQA scores the composited tile and re-runs cheaply on edits", () => {
  const brandKit = {
    ...extractBrandKitFromWebsite({
      workspaceId: "workspace_demo",
      websiteUrl: "https://northstar.example",
      marketCountry: "AU",
      htmlByUrl: { "https://northstar.example": "<html><head><title>Northstar</title></head><body></body></html>" },
    }),
    reviewStatus: "approved" as const,
  };
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_demo",
    brandKit,
    goal: "appraisal_bookings",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "home_value_update",
    platforms: ["meta"],
    creativeFormats: ["4:5"],
    variantCount: 1,
  });
  const creative = pack.creatives[0]!;

  const clean = runRenderedTileQA({ creative, copyText: "Get your free Scarborough market report." });
  assert.equal(clean.pass, true, JSON.stringify(clean.reasons));
  assert.equal(clean.layout.pass, true);

  // Re-running after an edit that introduces non-compliant copy fails the tile.
  const edited = runRenderedTileQA({ creative, copyText: "Guaranteed sale price — search Zillow today." });
  assert.equal(edited.pass, false);
  assert.equal(edited.compliance.pass, false);
});

test("runSkeletonQA passes when zones, palette, legibility, and brief match", () => {
  const result = runSkeletonQA({
    skeleton: creativeSkeletonSchema.parse({
      version: 1,
      archetype: "market_stat",
      shot: { type: "suburb street", lighting: "daylight", mood: "authority" },
      composition: {
        focal_point: "street",
        horizon: "middle",
        copy_safe_zones: [{ id: "stat-panel", x: 0.1, y: 0.1, width: 0.4, height: 0.4, priority: "primary" }],
      },
      color: { palette: ["navy", "white"], overlay: "soft panel", contrast: "high" },
      text_system: { headline_zone: "left", badge: "top", cta_style: "link" },
      copy: { hook_style: "market", headline_pattern: "{suburb} market update", cta: "Get report" },
      variables: ["suburb"],
      confidence: 90,
    }),
    observedCopyZoneIds: ["stat-panel"],
    palette: ["navy"],
    legible: true,
    onBrief: true,
  });

  assert.equal(result.pass, true);
});

test("runSkeletonQA reports skeleton-specific failures", () => {
  const result = runSkeletonQA({
    skeleton: creativeSkeletonSchema.parse({
      version: 1,
      archetype: "market_stat",
      shot: { type: "suburb street", lighting: "daylight", mood: "authority" },
      composition: {
        focal_point: "street",
        horizon: "middle",
        copy_safe_zones: [{ id: "stat-panel", x: 0.1, y: 0.1, width: 0.4, height: 0.4, priority: "primary" }],
      },
      color: { palette: ["navy", "white"], overlay: "soft panel", contrast: "high" },
      text_system: { headline_zone: "left", badge: "top", cta_style: "link" },
      copy: { hook_style: "market", headline_pattern: "{suburb} market update", cta: "Get report" },
      variables: ["suburb"],
      confidence: 90,
    }),
    observedCopyZoneIds: [],
    palette: ["orange"],
    legible: false,
    onBrief: false,
  });

  assert.equal(result.pass, false);
  assert.match(result.reasons.join(" "), /missing copy-safe zone stat-panel/);
  assert.match(result.reasons.join(" "), /off-palette/);
  assert.match(result.reasons.join(" "), /not legible/);
  assert.match(result.reasons.join(" "), /does not match skeleton brief/);
});

// ─── runSimilarityGuard ──────────────────────────────────────────────────────

test("runSimilarityGuard passes for a new hash not in the known list", () => {
  const result = runSimilarityGuard("abc123", ["def456", "ghi789"]);
  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});

test("runSimilarityGuard fails for an exact hash duplicate", () => {
  const hash = "deadbeef00112233";
  const result = runSimilarityGuard(hash, ["other-hash", hash, "another-hash"]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.length > 0, "must populate a reason");
});

test("runSimilarityGuard passes when candidateHash is null", () => {
  const result = runSimilarityGuard(null, ["deadbeef00112233"]);
  assert.equal(result.pass, true);
});

test("runSimilarityGuard passes when knownHashes is empty", () => {
  const result = runSimilarityGuard("abc123", []);
  assert.equal(result.pass, true);
});

// ─── runScoreGate ────────────────────────────────────────────────────────────

const MAX_DIMS: ScoreDimensions = {
  offerClarity: 20,
  localRelevance: 15,
  leadIntentStrength: 20,
  brandFit: 15,
  complianceSafety: 20,
  visualHierarchy: 10,
};

const ZERO_DIMS: ScoreDimensions = {
  offerClarity: 0,
  localRelevance: 0,
  leadIntentStrength: 0,
  brandFit: 0,
  complianceSafety: 0,
  visualHierarchy: 0,
};

test("runScoreGate passes when score equals 100 (all dimensions at max)", () => {
  const result = runScoreGate(MAX_DIMS);
  assert.equal(result.score, 100);
  assert.equal(result.pass, true);
  assert.equal(result.threshold, SCORE_GATE_THRESHOLD);
});

test("runScoreGate fails when score is 0 (all dimensions at zero)", () => {
  const result = runScoreGate(ZERO_DIMS);
  assert.equal(result.score, 0);
  assert.equal(result.pass, false);
});

test("runScoreGate respects a custom threshold", () => {
  // Score = 20+0+0+0+0+0 = 20; threshold 15 → pass; threshold 25 → fail
  const dims: ScoreDimensions = { ...ZERO_DIMS, offerClarity: 20 };
  assert.equal(runScoreGate(dims, 15).pass, true);
  assert.equal(runScoreGate(dims, 25).pass, false);
});

test("runScoreGate score equals sum of clamped dimensions", () => {
  const dims: ScoreDimensions = {
    offerClarity: 15,
    localRelevance: 10,
    leadIntentStrength: 15,
    brandFit: 10,
    complianceSafety: 15,
    visualHierarchy: 8,
  };
  const result = runScoreGate(dims);
  assert.equal(result.score, 15 + 10 + 15 + 10 + 15 + 8);
});

// ─── runComplianceGate ───────────────────────────────────────────────────────

test("runComplianceGate passes for clean AU copy", () => {
  const result = runComplianceGate(
    "Thinking about selling in Scarborough? Get your free suburb market report today.",
  );
  assert.equal(result.pass, true);
  assert.equal(result.issues.length, 0);
});

test("runComplianceGate fails for 'guaranteed price' pattern", () => {
  const result = runComplianceGate("We offer a guaranteed sale price for your home.");
  assert.equal(result.pass, false);
  assert.ok(
    result.issues.some((i) => i.code === "guaranteed_price"),
    "expected guaranteed_price issue",
  );
});

test("runComplianceGate fails for US portal brand mention", () => {
  const result = runComplianceGate("See listings on Zillow and other portals.");
  assert.equal(result.pass, false);
  assert.ok(
    result.issues.some((i) => i.code === "us_portal"),
    "expected us_portal issue",
  );
});

test("runComplianceGate fails for discriminatory targeting language", () => {
  const result = runComplianceGate("This property is perfect for families only.");
  assert.equal(result.pass, false);
  assert.ok(
    result.issues.some((i) => i.code === "discriminatory"),
    "expected discriminatory issue",
  );
});

test("runComplianceGate fails for fake scarcity claim", () => {
  const result = runComplianceGate("Only 2 homes left in this area — last chance!");
  assert.equal(result.pass, false);
  assert.ok(
    result.issues.some((i) => i.code === "fake_scarcity"),
    "expected fake_scarcity issue",
  );
});

test("runComplianceGate collects multiple issues in one pass", () => {
  const result = runComplianceGate(
    "Guaranteed sale price — only 1 home left — search Zillow today.",
  );
  assert.equal(result.pass, false);
  assert.ok(result.issues.length >= 3, "expected at least 3 issues");
});

// ─── runCreativeQA composite ─────────────────────────────────────────────────

function makePassingVisionProvider() {
  return makeVisionProvider({
    pass: true,
    reasons: [],
    is_au_appropriate: true,
    has_us_cues: false,
    has_garbled_text: false,
    has_distorted_faces: false,
    has_warped_buildings: false,
    is_low_resolution: false,
  });
}

test("runCreativeQA passes when all gates pass", async () => {
  const result = await runCreativeQA({
    imageUrl: "https://cdn.test/ok-image.jpg",
    copyText: "Thinking about selling in Mandurah? Get your free market report.",
    scoreDimensions: MAX_DIMS,
    knownContentHashes: [],
    candidateContentHash: "uniquehash001",
    visionProvider: makePassingVisionProvider(),
  });

  assert.equal(result.pass, true);
  assert.equal(result.gates.visionQA.pass, true);
  assert.equal(result.gates.similarity.pass, true);
  assert.equal(result.gates.scoreGate.pass, true);
  assert.equal(result.gates.compliance.pass, true);
  assert.equal(result.score, 100);
});

test("runCreativeQA fails when visionQA fails", async () => {
  const failVision = makeVisionProvider({
    pass: false,
    reasons: ["American mailbox"],
    has_us_cues: true,
  });

  const result = await runCreativeQA({
    imageUrl: "https://cdn.test/us-house.jpg",
    copyText: "Clean copy text for Scarborough.",
    scoreDimensions: MAX_DIMS,
    visionProvider: failVision,
  });

  assert.equal(result.pass, false);
  assert.equal(result.gates.visionQA.pass, false);
});

test("runCreativeQA fails when similarity guard flags a duplicate", async () => {
  const knownHash = "aabbccddeeff0011";

  const result = await runCreativeQA({
    imageUrl: "https://cdn.test/dup.jpg",
    copyText: "Good copy, no issues.",
    scoreDimensions: MAX_DIMS,
    candidateContentHash: knownHash,
    knownContentHashes: [knownHash],
    visionProvider: makePassingVisionProvider(),
  });

  assert.equal(result.pass, false);
  assert.equal(result.gates.similarity.pass, false);
});

test("runCreativeQA fails when score gate fails (zero dimensions)", async () => {
  const result = await runCreativeQA({
    imageUrl: "https://cdn.test/low-score.jpg",
    copyText: "Plain copy, no compliance issues.",
    scoreDimensions: ZERO_DIMS,
    visionProvider: makePassingVisionProvider(),
  });

  assert.equal(result.pass, false);
  assert.equal(result.gates.scoreGate.pass, false);
});

test("runCreativeQA fails when compliance gate fires", async () => {
  const result = await runCreativeQA({
    imageUrl: "https://cdn.test/ok-image.jpg",
    copyText: "Guaranteed price on your Zillow listing today.",
    scoreDimensions: MAX_DIMS,
    visionProvider: makePassingVisionProvider(),
  });

  assert.equal(result.pass, false);
  assert.equal(result.gates.compliance.pass, false);
});

test("runCreativeQA score reflects the scoreGate result", async () => {
  const dims: ScoreDimensions = {
    offerClarity: 15,
    localRelevance: 10,
    leadIntentStrength: 15,
    brandFit: 10,
    complianceSafety: 15,
    visualHierarchy: 8,
  };

  const result = await runCreativeQA({
    imageUrl: "https://cdn.test/med.jpg",
    copyText: "Discover what your home is worth in Fremantle.",
    scoreDimensions: dims,
    visionProvider: makePassingVisionProvider(),
  });

  assert.equal(result.score, 15 + 10 + 15 + 10 + 15 + 8);
});
