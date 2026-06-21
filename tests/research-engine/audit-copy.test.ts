import assert from "node:assert/strict";
import test from "node:test";

import type { AdAuditStats } from "../../src/lib/research/ad-audit.ts";
import { buildAuditNarrative, computeAuditSignals } from "../../src/lib/research/audit-insights.ts";
import {
  auditCopyEnabled,
  auditCopyViolations,
  computeAuditSignature,
  generateReviewedNarrative,
  generatedCopySchema,
  resolveAuditNarrative,
  toAuditNarrative,
  type ModelCall,
  type ReviewVerdict,
} from "../../src/lib/research/audit-copy.ts";

// --- fixtures --------------------------------------------------------------

type Advertiser = AdAuditStats["topAdvertisers"][number];
type Count = AdAuditStats["formats"][number];

function adv(name: string, ads: number, active = 0, longest = 0): Advertiser {
  return { name, ads, active, activeRate: ads ? active / ads : 0, longestRunningDays: longest } as Advertiser;
}
function count(label: string, n: number): Count {
  return { label, count: n } as Count;
}

function makeStats(over: Partial<AdAuditStats> & { totals: AdAuditStats["totals"] }): AdAuditStats {
  return {
    advertiserCount: 0,
    activeAdvertiserCount: 0,
    topAdvertisers: [],
    longestRunning: [],
    formats: [],
    platforms: [],
    adTypes: [],
    topCtas: [],
    commonHooks: [],
    newLast30Days: 0,
    launchesByMonth: [],
    medianDaysRunning: 0,
    longestRunningDays: 0,
    sampleSize: over.totals.detected,
    capped: false,
    ...over,
  } as AdAuditStats;
}

// 6166-like: 24 detected, 0 active, recent burst, image-led, listing-led.
function stats6166(): AdAuditStats {
  return makeStats({
    totals: { detected: 24, active: 0, inactive: 24, activeRate: 0 },
    advertiserCount: 5,
    activeAdvertiserCount: 0,
    topAdvertisers: [adv("Acme Realty", 9), adv("Bay Property", 6), adv("Coast Agents", 4), adv("Dune Estates", 3), adv("Esk Group", 2)],
    formats: [count("Image", 18), count("Video", 4), count("Carousel", 2)],
    platforms: [count("Facebook", 23), count("Instagram", 15)],
    adTypes: [count("Just Listed", 11), count("Open Home", 5), count("Free Appraisal", 3)],
    topCtas: [count("Learn more", 12), count("Contact us", 6)],
    newLast30Days: 21,
    medianDaysRunning: 8,
    longestRunningDays: 41,
  });
}

// High-activity fixture for context-sensitive checks.
function statsBusy(): AdAuditStats {
  return makeStats({
    totals: { detected: 40, active: 20, inactive: 20, activeRate: 0.5 },
    advertiserCount: 8,
    activeAdvertiserCount: 7,
    topAdvertisers: [adv("Acme Realty", 8, 5), adv("Bay Property", 7, 4), adv("Coast Agents", 6, 3)],
    formats: [count("Image", 20), count("Video", 16), count("Carousel", 4)],
    platforms: [count("Facebook", 38), count("Instagram", 30)],
    adTypes: [count("Just Listed", 14), count("Just Sold", 12), count("Free Appraisal", 8)],
    newLast30Days: 15,
    medianDaysRunning: 20,
    longestRunningDays: 90,
  });
}

function narrativeFor(stats: AdAuditStats, label = "6166") {
  const signals = computeAuditSignals(stats);
  return { signals, narrative: buildAuditNarrative({ label, stats, signals }) };
}

function approvingVerdict(): ReviewVerdict {
  return {
    approved: true,
    unsupported_claims: [],
    generic_advice: [],
    sales_language: [],
    data_contradictions: [],
    missing_caveats: [],
    recommended_rewrites: [],
  };
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AUDIT_LLM_COPY: "",
    OPENAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    AZURE_OPENAI_API_KEY: "",
    AZURE_OPENAI_ENDPOINT: "",
    AZURE_OPENAI_CHAT_COMPLETIONS_URL: "",
    ...overrides,
  };
}

// --- the gate must accept the deterministic engine's own output -------------

test("auditCopyViolations: deterministic narrative passes the gate cleanly", () => {
  for (const stats of [stats6166(), statsBusy()]) {
    const { signals, narrative } = narrativeFor(stats);
    const violations = auditCopyViolations(narrative, stats, signals);
    assert.deepEqual(violations, [], `expected no violations, got: ${violations.join(" | ")}`);
  }
});

test("auditCopyViolations: flags sales language", () => {
  const stats = stats6166();
  const { signals, narrative } = narrativeFor(stats);
  const bad = { ...narrative, snapshot: ["Launch a campaign now to beat the competition."] };
  const violations = auditCopyViolations(bad, stats, signals);
  assert.ok(violations.length > 0);
  assert.ok(violations.some((v) => /campaign|launch/i.test(v)));
});

test("auditCopyViolations: flags current-pressure claims when no ads are active", () => {
  const stats = stats6166(); // active === 0
  const { signals, narrative } = narrativeFor(stats);
  const bad = { ...narrative, snapshot: ["Competitors are buying local attention now."] };
  const violations = auditCopyViolations(bad, stats, signals);
  assert.ok(violations.length > 0, "should flag current-pressure claim");
});

test("auditCopyViolations: allows live-market language when activity is genuinely high", () => {
  const stats = statsBusy(); // 20 active
  const { signals, narrative } = narrativeFor(stats, "Fremantle");
  const ok = { ...narrative, snapshot: ["At scan time, attention is currently being bought by several advertisers."] };
  const violations = auditCopyViolations(ok, stats, signals);
  assert.deepEqual(violations, [], `unexpected violations: ${violations.join(" | ")}`);
});

test("auditCopyViolations: flags ungrounded numbers", () => {
  const stats = stats6166(); // detected 24
  const { signals, narrative } = narrativeFor(stats);
  const bad = { ...narrative, snapshot: ["This scan detected 999 real estate ads around 6166."] };
  const violations = auditCopyViolations(bad, stats, signals);
  assert.ok(violations.some((v) => /999/.test(v)), "should flag the invented 999");
});

test("auditCopyViolations: flags an insight block missing a required field", () => {
  const stats = stats6166();
  const { signals, narrative } = narrativeFor(stats);
  if (narrative.blocks.length === 0) return; // engine always emits blocks for this fixture
  const blocks = narrative.blocks.map((b, i) => (i === 0 ? { ...b, whatNotToAssume: "" } : b));
  const violations = auditCopyViolations({ ...narrative, blocks }, stats, signals);
  assert.ok(violations.some((v) => /missing one of the six/i.test(v)));
});

// --- schema ----------------------------------------------------------------

test("generatedCopySchema: accepts well-formed copy and rejects junk", () => {
  const { narrative } = narrativeFor(stats6166());
  const good = {
    snapshot: narrative.snapshot,
    dataQuality: narrative.dataQuality,
    blocks: narrative.blocks,
    usefulActions: narrative.usefulActions,
    limitations: narrative.limitations,
  };
  assert.equal(generatedCopySchema.safeParse(good).success, true);
  assert.equal(generatedCopySchema.safeParse({}).success, false);
});

// --- signature -------------------------------------------------------------

test("computeAuditSignature: stable for same input, changes when data changes", () => {
  const a = stats6166();
  const sigA = computeAuditSignature({ label: "6166", stats: a, signals: computeAuditSignals(a) });
  const sigA2 = computeAuditSignature({ label: "6166", stats: stats6166(), signals: computeAuditSignals(stats6166()) });
  assert.equal(sigA, sigA2);

  const b = makeStats({ ...stats6166(), totals: { detected: 24, active: 3, inactive: 21, activeRate: 3 / 24 } });
  const sigB = computeAuditSignature({ label: "6166", stats: b, signals: computeAuditSignals(b) });
  assert.notEqual(sigA, sigB);

  const sigLabel = computeAuditSignature({ label: "Fremantle", stats: a, signals: computeAuditSignals(a) });
  assert.notEqual(sigA, sigLabel);
});

// --- toAuditNarrative ------------------------------------------------------

test("toAuditNarrative: clamps block confidence to the overall signal confidence", () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const { narrative } = narrativeFor(stats);
  const copy = {
    snapshot: narrative.snapshot,
    dataQuality: narrative.dataQuality,
    blocks: narrative.blocks.map((b) => ({ ...b, confidence: "high" as const })),
    usefulActions: narrative.usefulActions,
    limitations: narrative.limitations,
  };
  const out = toAuditNarrative(copy, { label: "6166", stats, signals });
  const rank = { low: 0, medium: 1, high: 2 } as const;
  for (const block of out.blocks) {
    assert.ok(rank[block.confidence] <= rank[signals.signalConfidence]);
  }
});

// --- generateReviewedNarrative (injected model) ----------------------------

function copyFrom(narrative: ReturnType<typeof buildAuditNarrative>) {
  return {
    snapshot: narrative.snapshot,
    dataQuality: narrative.dataQuality,
    blocks: narrative.blocks,
    usefulActions: narrative.usefulActions,
    limitations: narrative.limitations,
  };
}

test("generateReviewedNarrative: returns reviewed copy when gate + critic pass", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const good = copyFrom(buildAuditNarrative({ label: "6166", stats, signals }));
  const modelCall: ModelCall = async ({ profileKey }) =>
    profileKey === "structured_json"
      ? { json: good, model: "gen-test" }
      : { json: approvingVerdict(), model: "critic-test" };

  const result = await generateReviewedNarrative({ label: "6166", stats, signals }, { modelCall });
  assert.ok(result, "expected a reviewed narrative");
  assert.equal(result?.review.approved, true);
  assert.equal(result?.narrative.snapshot.length, good.snapshot.length);
});

test("generateReviewedNarrative: rewrites after a gate violation, then succeeds", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const good = copyFrom(buildAuditNarrative({ label: "6166", stats, signals }));
  const bad = { ...good, snapshot: ["Launch a campaign immediately."] };

  let genCalls = 0;
  const modelCall: ModelCall = async ({ profileKey }) => {
    if (profileKey === "structured_json") {
      genCalls += 1;
      return { json: genCalls === 1 ? bad : good, model: "gen-test" };
    }
    return { json: approvingVerdict(), model: "critic-test" };
  };

  const result = await generateReviewedNarrative({ label: "6166", stats, signals }, { modelCall });
  assert.ok(result, "expected success on the second attempt");
  assert.equal(genCalls, 2);
});

test("generateReviewedNarrative: returns null when the critic never approves", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const good = copyFrom(buildAuditNarrative({ label: "6166", stats, signals }));
  const modelCall: ModelCall = async ({ profileKey }) =>
    profileKey === "structured_json"
      ? { json: good, model: "gen-test" }
      : {
          json: { ...approvingVerdict(), approved: false, sales_language: ["too salesy"] },
          model: "critic-test",
        };

  const result = await generateReviewedNarrative({ label: "6166", stats, signals }, { modelCall });
  assert.equal(result, null);
});

test("generateReviewedNarrative: returns null when the model throws", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const modelCall: ModelCall = async () => {
    throw new Error("provider unavailable");
  };
  const result = await generateReviewedNarrative({ label: "6166", stats, signals }, { modelCall });
  assert.equal(result, null);
});

// --- resolveAuditNarrative -------------------------------------------------

test("resolveAuditNarrative: deterministic when no Supabase client", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const resolved = await resolveAuditNarrative({ label: "6166", stats, signals }, { supabase: null });
  assert.equal(resolved.source, "deterministic");
  assert.ok(resolved.narrative.snapshot.length > 0);
});

test("resolveAuditNarrative: serves cached copy on a cache hit", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const cached = buildAuditNarrative({ label: "6166", stats, signals });
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: { narrative: cached, expires_at: null }, error: null }),
      };
    },
  };
  const resolved = await resolveAuditNarrative(
    { label: "6166", stats, signals },
    { supabase: supabase as never, env: env({}) },
  );
  assert.equal(resolved.source, "cache");
});

test("resolveAuditNarrative: schedules a background warm on a cache miss", async () => {
  const stats = stats6166();
  const signals = computeAuditSignals(stats);
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
      };
    },
  };
  const scheduled: Array<() => Promise<void>> = [];
  const resolved = await resolveAuditNarrative(
    { label: "6166", stats, signals },
    {
      supabase: supabase as never,
      env: env({ OPENAI_API_KEY: "test-key" }),
      scheduleBackground: (task) => scheduled.push(task),
    },
  );
  assert.equal(resolved.source, "deterministic");
  assert.equal(scheduled.length, 1);
});

// --- auditCopyEnabled ------------------------------------------------------

test("auditCopyEnabled: gated on provider keys and the off switch", () => {
  assert.equal(auditCopyEnabled(env()), false);
  assert.equal(auditCopyEnabled(env({ OPENAI_API_KEY: "x", AUDIT_LLM_COPY: "" })), true);
  assert.equal(auditCopyEnabled(env({ OPENROUTER_API_KEY: "x", AUDIT_LLM_COPY: "" })), true);
  assert.equal(auditCopyEnabled(env({ OPENAI_API_KEY: "x", AUDIT_LLM_COPY: "off" })), false);
});
