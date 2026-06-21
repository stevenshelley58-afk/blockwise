import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createTextProviderForCandidate } from "../adstudio/ai-providers.ts";
import {
  modelCandidateAttempts,
  resolveRuntimeModelProfile,
} from "../operator/prompts/model-profile-runtime.ts";
import { createSupabaseServiceClient } from "../supabase/service.ts";
import type { AdAuditStats } from "./ad-audit.ts";
import {
  buildAuditNarrative,
  type AuditNarrative,
  type AuditSignals,
  type InsightBlock,
  type SignalConfidence,
} from "./audit-insights.ts";

/**
 * LLM copy pipeline for the /audit local advertising intelligence report.
 *
 * The page renders an `AuditNarrative`. Two engines can produce one:
 *   1. The pure, deterministic `buildAuditNarrative` (audit-insights.ts) — always
 *      safe, used as the guaranteed fallback and the first cold render.
 *   2. This module's LLM pipeline — generates per-suburb prose, runs it through a
 *      deterministic sentence gate, then a frontier-AI critic (the compliance_review
 *      profile) that must approve it. Approved copy is cached in public.audit_report_copy
 *      keyed by a hash of the scan inputs, so repeat views are instant.
 *
 * Design rules (mirroring the report's own standards):
 *   - Never publish unreviewed LLM copy. Gate + critic both must pass.
 *   - Never block the page. resolveAuditNarrative returns cached-or-deterministic
 *     synchronously and lets the caller warm the cache in the background.
 *   - Stay testable: no Next.js runtime imports here; model + scheduling are injected.
 */

export const AUDIT_COPY_TABLE = "audit_report_copy";
const MAX_ATTEMPTS = 3;
const GEN_TIMEOUT_MS = 22_000;
const REVIEW_TIMEOUT_MS = 16_000;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const COPY_VERSION = "plain-suburb-read-v2";

export type AuditNarrativeInput = {
  label: string;
  stats: AdAuditStats;
  signals: AuditSignals;
};

// --- Schemas ---------------------------------------------------------------

const confidenceSchema = z.enum(["low", "medium", "high"]);

const insightBlockSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(120),
  observation: z.string().min(1).max(600),
  interpretation: z.string().min(1).max(600),
  whyItMatters: z.string().min(1).max(600),
  whatNotToAssume: z.string().min(1).max(600),
  usefulActions: z.array(z.string().min(1).max(280)).min(1).max(4),
  confidence: confidenceSchema,
});

/** Shape the generation model must return (maps onto AuditNarrative). */
export const generatedCopySchema = z.object({
  snapshot: z.array(z.string().min(1).max(700)).min(1).max(4),
  dataQuality: z.array(z.string().min(1).max(500)).min(1).max(6),
  blocks: z.array(insightBlockSchema).max(8),
  usefulActions: z.array(z.string().min(1).max(280)).min(2).max(8),
  limitations: z.array(z.string().min(1).max(400)).min(3).max(7),
});

export type GeneratedCopy = z.infer<typeof generatedCopySchema>;

/** Full AuditNarrative shape — used to validate what we read back from cache. */
export const narrativeShapeSchema = z.object({
  headline: z.string().min(1),
  snapshot: z.array(z.string().min(1)).min(1),
  dataQuality: z.array(z.string().min(1)).min(1),
  blocks: z.array(insightBlockSchema),
  usefulActions: z.array(z.string().min(1)).min(1),
  limitations: z.array(z.string().min(1)).min(1),
  confidence: confidenceSchema,
});

/** Frontier-AI reviewer verdict. */
export const reviewSchema = z.object({
  approved: z.boolean(),
  unsupported_claims: z.array(z.string()).default([]),
  generic_advice: z.array(z.string()).default([]),
  sales_language: z.array(z.string()).default([]),
  data_contradictions: z.array(z.string()).default([]),
  missing_caveats: z.array(z.string()).default([]),
  recommended_rewrites: z.array(z.string()).default([]),
});

export type ReviewVerdict = z.infer<typeof reviewSchema>;

// --- Deterministic sentence gate ------------------------------------------

// Phrases that must never appear in the public report, in any activity context.
// Kept deliberately narrow: words that legitimately appear in caveats (e.g.
// "leads", "conversions", "performance", "spend", "return") are NOT banned here,
// only affirmative sales / performance claims that never belong in a caveat.
const ALWAYS_BANNED: RegExp[] = [
  /\bcampaigns?\b/i,
  /\btrials?\b/i,
  /\bad[-\s]?packs?\b/i,
  /\blead machine\b/i,
  /\bno card required\b/i,
  /\bbook a call\b/i,
  /\bstart free\b/i,
  /\bbuild my campaign\b/i,
  /\bapprove before export\b/i,
  /\blaunch\b/i,
  /\bcrushing\b/i,
  /\bdominating\b/i,
  /\bunlock\b/i,
  /\bproven\b/i,
  /\bwinning\b/i,
  /\bbest[-\s]?performing\b/i,
  /\bguarantee/i,
  /\broas\b/i,
  /\b(is|are|was|were)\s+working\b/i,
  /competitors? are (currently )?(advertising|spending|buying)/i,
  /buying (local )?attention/i,
  /launch before (they|them|competitors)/i,
  /recommended campaign/i,
  /already working/i,
  /\bconfidence (score|level|rating)\b/i,
  /\bdata quality\b/i,
  /\bmethodology\b/i,
  /\bpractical interpretation\b/i,
];

// Affirmative current-pressure claims that are only acceptable when the market
// actually has meaningful live activity. Flagged when active ads are low/zero.
const LOW_ACTIVITY_BANNED: RegExp[] = [
  /attention is (currently |now )?being bought/i,
  /\bmarket is (busy|active|hot|contested|highly competitive)\b/i,
  /competitors are (active|live|here)/i,
  /the market is (currently )?competitive/i,
];

// Useful actions must be doable today without buying anything.
const ACTION_BANNED: RegExp[] = [
  /\blaunch\b/i,
  /\bstart a trial\b/i,
  /\bbuild (an|your) ad\b/i,
  /\bcreate a lead form\b/i,
  /\bbook a (call|demo)\b/i,
  /\bsign up\b/i,
  /\bbroad targeting\b/i,
];

const GENERIC_WHITELIST_NUMBERS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 24, 30, 60, 90, 100,
  2023, 2024, 2025, 2026, 2027, 2028,
]);

function addBareIntegersFromText(text: string, counts: Set<number>): void {
  for (const match of text.matchAll(/(?<![\d.,%$-])(\d{1,4})(?![\d.,%])/g)) {
    counts.add(Number(match[1]));
  }
}

function round(value: number): number {
  return Math.round(value);
}

function collectAllowedCounts(stats: AdAuditStats, signals: AuditSignals): Set<number> {
  const counts = new Set<number>();
  const add = (n: number | undefined | null) => {
    if (typeof n === "number" && Number.isFinite(n)) counts.add(Math.round(n));
  };
  add(stats.totals.detected);
  add(stats.totals.active);
  add(stats.totals.inactive);
  add(stats.advertiserCount);
  add(stats.activeAdvertiserCount);
  add(signals.activeAdvertisers);
  add(stats.newLast30Days);
  add(stats.longestRunningDays);
  add(stats.medianDaysRunning);
  add(stats.sampleSize);
  for (const advertiser of stats.topAdvertisers) {
    add(advertiser.ads);
    add(advertiser.active);
    add(advertiser.longestRunningDays);
  }
  for (const list of [stats.formats, stats.platforms, stats.adTypes, stats.topCtas, stats.commonHooks]) {
    for (const item of list) add(item.count);
  }
  for (const ad of stats.longestRunning) add(ad.daysRunning);
  return counts;
}

function collectAllowedPercents(stats: AdAuditStats, signals: AuditSignals): Set<number> {
  const percents = new Set<number>();
  const add = (ratio: number | undefined | null) => {
    if (typeof ratio === "number" && Number.isFinite(ratio)) percents.add(round(ratio * 100));
  };
  add(stats.totals.activeRate);
  add(signals.topAdvertiserShare);
  add(signals.topTwoShare);
  add(signals.classifiedAngleRatio);
  add(signals.imageShare);
  add(signals.videoShare);
  if (signals.dominantMessage) add(signals.dominantMessage.share);
  const detected = stats.totals.detected;
  if (detected > 0) {
    for (const advertiser of stats.topAdvertisers) add(advertiser.ads / detected);
    for (const list of [stats.formats, stats.platforms, stats.adTypes]) {
      for (const item of list) add(item.count / detected);
    }
  }
  return percents;
}

function ungroundedNumbers(text: string, allowedCounts: Set<number>, allowedPercents: Set<number>): string[] {
  const flagged: string[] = [];
  // Percentages first.
  for (const match of text.matchAll(/(\d{1,3})\s*%/g)) {
    const value = Number(match[1]);
    const near = [...allowedPercents].some((allowed) => Math.abs(allowed - value) <= 1);
    if (!near) flagged.push(`${value}%`);
  }
  // Bare integers not attached to %, $, decimals, or other digits.
  for (const match of text.matchAll(/(?<![\d.,%$-])(\d{1,4})(?![\d.,%])/g)) {
    const value = Number(match[1]);
    if (allowedCounts.has(value)) continue;
    if (GENERIC_WHITELIST_NUMBERS.has(value)) continue;
    flagged.push(match[1]);
  }
  return flagged;
}

function blockComplete(block: InsightBlock): boolean {
  return (
    nonEmpty(block.observation) &&
    nonEmpty(block.interpretation) &&
    nonEmpty(block.whyItMatters) &&
    nonEmpty(block.whatNotToAssume) &&
    block.usefulActions.length > 0 &&
    block.usefulActions.every(nonEmpty) &&
    (["low", "medium", "high"] as SignalConfidence[]).includes(block.confidence)
  );
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Deterministic backstop run on every LLM draft before the critic. Returns a list
 * of human-readable violations; empty means the draft cleared the gate. This can
 * never replace the critic, but it cheaply blocks the obvious failure modes the
 * spec calls out: sales language, current-pressure claims that contradict the
 * data, ungrounded numbers, banned actions, and incomplete insight blocks.
 */
export function auditCopyViolations(
  narrative: AuditNarrative,
  stats: AdAuditStats,
  signals: AuditSignals,
): string[] {
  const violations: string[] = [];
  const lowActivity =
    stats.totals.active === 0 ||
    signals.currentActivityLevel === "none" ||
    signals.currentActivityLevel === "low";

  const allowedCounts = collectAllowedCounts(stats, signals);
  const allowedPercents = collectAllowedPercents(stats, signals);
  addBareIntegersFromText(narrative.headline, allowedCounts);

  const proseFields: Array<{ where: string; text: string }> = [];
  narrative.snapshot.forEach((text, index) => proseFields.push({ where: `snapshot[${index}]`, text }));
  narrative.dataQuality.forEach((text, index) => proseFields.push({ where: `dataQuality[${index}]`, text }));
  narrative.limitations.forEach((text, index) => proseFields.push({ where: `limitations[${index}]`, text }));
  for (const block of narrative.blocks) {
    proseFields.push({ where: `${block.id}.observation`, text: block.observation });
    proseFields.push({ where: `${block.id}.interpretation`, text: block.interpretation });
    proseFields.push({ where: `${block.id}.whyItMatters`, text: block.whyItMatters });
    proseFields.push({ where: `${block.id}.whatNotToAssume`, text: block.whatNotToAssume });
  }

  // Banned vocabulary / claims across all prose.
  for (const { where, text } of proseFields) {
    for (const pattern of ALWAYS_BANNED) {
      if (pattern.test(text)) violations.push(`Banned phrasing in ${where}: matches ${pattern}`);
    }
    if (lowActivity) {
      for (const pattern of LOW_ACTIVITY_BANNED) {
        if (pattern.test(text)) {
          violations.push(`Overstated current activity in ${where} (active ads are low/zero): matches ${pattern}`);
        }
      }
    }
  }

  // Number grounding on the fields that carry concrete figures.
  const numberFields = [
    ...narrative.snapshot.map((text, index) => ({ where: `snapshot[${index}]`, text })),
    ...narrative.blocks.map((block) => ({ where: `${block.id}.observation`, text: block.observation })),
    ...narrative.dataQuality.map((text, index) => ({ where: `dataQuality[${index}]`, text })),
  ];
  for (const { where, text } of numberFields) {
    const bad = ungroundedNumbers(text, allowedCounts, allowedPercents);
    if (bad.length > 0) violations.push(`Ungrounded number(s) in ${where}: ${bad.join(", ")}`);
  }

  // Useful actions (top-level + per block) must be free and non-sales.
  const allActions = [
    ...narrative.usefulActions.map((text, index) => ({ where: `usefulActions[${index}]`, text })),
    ...narrative.blocks.flatMap((block) =>
      block.usefulActions.map((text, index) => ({ where: `${block.id}.usefulActions[${index}]`, text })),
    ),
  ];
  for (const { where, text } of allActions) {
    for (const pattern of [...ALWAYS_BANNED, ...ACTION_BANNED]) {
      if (pattern.test(text)) violations.push(`Action a reader cannot take for free in ${where}: matches ${pattern}`);
    }
  }

  // Every insight block must carry all six fields.
  for (const block of narrative.blocks) {
    if (!blockComplete(block)) violations.push(`Insight block "${block.id}" is missing one of the six required fields`);
  }

  // Limitations must mention the Meta Ad Library caveat somewhere.
  const limitationsText = narrative.limitations.join(" ").toLowerCase();
  if (!/ad library/.test(limitationsText)) {
    violations.push("Limitations do not mention the public Meta Ad Library data limitation");
  }

  return violations;
}

// --- Prompts ---------------------------------------------------------------

const GENERATION_SYSTEM = [
  "You are a calm, skeptical local-advertising analyst. You write a free, data-grounded intelligence report about the real estate ads visible for one suburb in the PUBLIC Meta (Facebook & Instagram) Ad Library.",
  "",
  "This is NOT a landing page, sales page, campaign generator, or trial signup. You never sell anything and never recommend Blockwise.",
  "Write like a sharp local operator giving a useful read, not like an academic report or internal scoring system.",
  "",
  "Hard rules:",
  "- Every sentence must be one of: a data observation, a cautious interpretation tied to the provided data, a limitation, or a useful action the reader can take TODAY without buying anything.",
  "- Use ONLY the numbers in DATA. Never invent or estimate figures. Never cite a number that is not in DATA.",
  "- The Meta Ad Library is an ads-transparency/search tool, not a performance database. Never claim anything is working, proven, converting, winning, or worth launching. Frame everything as a public-data signal ('detected', 'visible', 'at scan time', 'may suggest', 'directional', 'do not assume').",
  "- Active-ad language MUST match the data. If active ads are 0 or low, do NOT imply competitors are advertising now, that attention is currently being bought, or that the market is currently active/contested. Say plainly that this is a historical/recent snapshot, not live pressure.",
  "- Forbidden words/phrases anywhere: campaign, ad pack, trial, no card required, approve before export, build my campaign, launch, proven, working, winning, crushing, dominating, unlock, ROAS, lead machine, book a call, 'competitors are buying attention', 'recommended campaign'.",
  "- Do not put internal/reporting labels in prose: confidence score, confidence level, data quality, methodology, practical interpretation.",
  "- Do NOT write generic copy that could apply unchanged to any suburb. Anchor each point in this suburb's specific numbers and advertisers.",
  "",
  "Each insight block MUST include all six fields: observation, interpretation, whyItMatters, whatNotToAssume, usefulActions (1-4 free actions), confidence ('low'|'medium'|'high'). Omit a block entirely rather than ship one missing a field.",
  "",
  "Good useful actions: open the top advertiser pages by hand in the Meta Ad Library; save strong examples to a swipe file; compare inactive ads to recent listings/sold results; re-scan weekly for four weeks before calling the market quiet or active; separate listing-led from appraisal-led ads; identify missing local proof. Bad useful actions: launch a campaign, build an ad, start a trial, create a lead form, book a call, use broad targeting.",
  "",
  "Return ONLY a JSON object with this exact shape:",
  '{ "snapshot": string[1..3], "dataQuality": string[1..4], "blocks": Array<{ "id": string, "title": string, "observation": string, "interpretation": string, "whyItMatters": string, "whatNotToAssume": string, "usefulActions": string[1..4], "confidence": "low"|"medium"|"high" }> (0..8), "usefulActions": string[3..8], "limitations": string[3..6] }',
  "At least one limitation must state that the Meta Ad Library shows what was visible, not what worked.",
].join("\n");

const REVIEW_SYSTEM = [
  "You are a skeptical senior marketing analyst and fact-checker. You review a generated public report BEFORE it is published, against the underlying scan data. You do not rewrite it; you judge it.",
  "",
  "Return ONLY JSON: { \"approved\": boolean, \"unsupported_claims\": string[], \"generic_advice\": string[], \"sales_language\": string[], \"data_contradictions\": string[], \"missing_caveats\": string[], \"recommended_rewrites\": string[] }.",
  "",
  "Flagging rules — populate the arrays with the offending sentences/phrases:",
  "1. Flag any claim implying performance, conversion, ROAS, lead quality, spend, or listings won.",
  "2. Flag any claim implying active advertising/current pressure when active ads are low or zero.",
  "3. Flag advice that could apply unchanged to any suburb (generic_advice).",
  "4. Flag any sales language (sales_language): campaign, ad pack, trial, no card required, approve before export, build my campaign, launch, proven, already working, book a call.",
  "4a. Flag internal/reporting labels in public prose: confidence score, confidence level, data quality, methodology, practical interpretation.",
  "5. Flag recommendations not traceable to the data.",
  "6. Flag unsupported certainty (claims stated as fact that the public data cannot support).",
  "7. Flag missing limitations about Meta Ad Library data (missing_caveats).",
  "8. Flag any number or table claim that contradicts the headline stats (data_contradictions).",
  "9. Flag references to non-real-estate advertisers as if they were real estate.",
  "",
  "Set approved=true ONLY if there are no sales_language items, no data_contradictions, and no unsupported performance/activity claims. Otherwise approved=false. Be strict but fair; a calm, correctly-caveated analyst report should pass.",
].join("\n");

function dataPayload(input: AuditNarrativeInput): Record<string, unknown> {
  const { label, stats, signals } = input;
  return {
    location: label,
    scan: {
      detected: stats.totals.detected,
      active: stats.totals.active,
      inactive: stats.totals.inactive,
      activeRatePct: round(stats.totals.activeRate * 100),
      newLast30Days: stats.newLast30Days,
      longestRunningDays: stats.longestRunningDays,
      medianDaysRunning: stats.medianDaysRunning,
      advertiserCount: stats.advertiserCount,
      activeAdvertisers: signals.activeAdvertisers,
      capped: stats.capped,
    },
    signals: {
      currentActivityLevel: signals.currentActivityLevel,
      recentActivityPattern: signals.recentActivityPattern,
      marketConcentration: signals.marketConcentration,
      creativeFormatPattern: signals.creativeFormatPattern,
      messagePattern: signals.messagePattern,
      signalConfidence: signals.signalConfidence,
      topAdvertiserSharePct: round(signals.topAdvertiserShare * 100),
      topTwoSharePct: round(signals.topTwoShare * 100),
      classifiedAnglePct: round(signals.classifiedAngleRatio * 100),
      imageSharePct: round(signals.imageShare * 100),
      videoSharePct: round(signals.videoShare * 100),
      dominantMessage: signals.dominantMessage,
    },
    topAdvertisers: stats.topAdvertisers.map((advertiser) => ({
      name: advertiser.name,
      ads: advertiser.ads,
      active: advertiser.active,
      longestRunningDays: advertiser.longestRunningDays,
    })),
    formats: stats.formats,
    platforms: stats.platforms,
    angles: stats.adTypes,
    ctas: stats.topCtas,
    longestRunning: stats.longestRunning.slice(0, 5).map((ad) => ({
      advertiser: ad.pageName,
      daysRunning: ad.daysRunning,
      status: ad.status,
      adType: ad.adType,
    })),
  };
}

function generationUserPrompt(input: AuditNarrativeInput, feedback: string[]): string {
  const parts = [
    "DATA (the only facts you may use):",
    JSON.stringify(dataPayload(input), null, 2),
    "",
    `Write the report for ${input.label}. Tailor every point to these numbers. Return only the JSON object described in the system message.`,
  ];
  if (feedback.length > 0) {
    parts.push(
      "",
      "A previous draft was rejected. Fix exactly these issues and keep everything else faithful to the data:",
      ...feedback.map((item) => `- ${item}`),
    );
  }
  return parts.join("\n");
}

function reviewUserPrompt(input: AuditNarrativeInput, narrative: AuditNarrative): string {
  return [
    "DATA:",
    JSON.stringify(dataPayload(input), null, 2),
    "",
    "GENERATED REPORT COPY:",
    JSON.stringify(
      {
        snapshot: narrative.snapshot,
        dataQuality: narrative.dataQuality,
        blocks: narrative.blocks,
        usefulActions: narrative.usefulActions,
        limitations: narrative.limitations,
      },
      null,
      2,
    ),
    "",
    "Review the copy against the data and return only the verdict JSON.",
  ].join("\n");
}

// --- Model plumbing --------------------------------------------------------

export type ModelCall = (args: {
  profileKey: "structured_json" | "compliance_review";
  system: string;
  user: string;
  schemaName: "auditReport" | "auditReview";
  timeoutMs: number;
}) => Promise<{ json: unknown; model: string }>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`audit-copy model call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Default model call: resolve the profile, try primary then fallbacks. */
const defaultModelCall: ModelCall = async ({ profileKey, system, user, schemaName, timeoutMs }) => {
  const profile = await resolveRuntimeModelProfile(profileKey);
  const candidates = modelCandidateAttempts(profile);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const provider = createTextProviderForCandidate(candidate);
      const output = await withTimeout(
        provider.generate({ system, schemaName, messages: [{ role: "user", content: user }] }),
        timeoutMs,
      );
      return { json: output.json, model: String(output.providerMetadata?.model ?? candidate.model) };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`No model candidates available for ${profileKey}.`);
};

export function auditCopyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.AUDIT_LLM_COPY === "off") return false;
  return Boolean(
    env.OPENAI_API_KEY ||
      env.OPENROUTER_API_KEY ||
      (env.AZURE_OPENAI_API_KEY && (env.AZURE_OPENAI_ENDPOINT || env.AZURE_OPENAI_CHAT_COMPLETIONS_URL)),
  );
}

function clampConfidence(block: SignalConfidence, ceiling: SignalConfidence): SignalConfidence {
  const rank: Record<SignalConfidence, number> = { low: 0, medium: 1, high: 2 };
  return rank[block] <= rank[ceiling] ? block : ceiling;
}

export function toAuditNarrative(copy: GeneratedCopy, input: AuditNarrativeInput): AuditNarrative {
  return {
    headline: `${input.label} - local advertising signal report`,
    snapshot: copy.snapshot,
    dataQuality: copy.dataQuality,
    blocks: copy.blocks.map((block) => ({
      ...block,
      confidence: clampConfidence(block.confidence, input.signals.signalConfidence),
    })),
    usefulActions: copy.usefulActions,
    limitations: copy.limitations,
    confidence: input.signals.signalConfidence,
  };
}

function reviewFeedback(verdict: ReviewVerdict): string[] {
  return [
    ...verdict.sales_language.map((item) => `Remove sales language: ${item}`),
    ...verdict.unsupported_claims.map((item) => `Remove or caveat unsupported claim: ${item}`),
    ...verdict.data_contradictions.map((item) => `Fix data contradiction: ${item}`),
    ...verdict.generic_advice.map((item) => `Make this specific to the suburb: ${item}`),
    ...verdict.missing_caveats.map((item) => `Add missing caveat: ${item}`),
    ...verdict.recommended_rewrites.map((item) => `Rewrite: ${item}`),
  ];
}

function verdictBlocksPublish(verdict: ReviewVerdict): boolean {
  // Even a generous "approved:true" cannot ship with hard safety flags present.
  return (
    !verdict.approved ||
    verdict.sales_language.length > 0 ||
    verdict.data_contradictions.length > 0
  );
}

export type ReviewedNarrative = {
  narrative: AuditNarrative;
  review: ReviewVerdict;
  model: string;
  attempts: number;
};

/**
 * Generate -> deterministic gate -> frontier critic, with up to MAX_ATTEMPTS
 * rewrites driven by the gate violations and reviewer flags. Returns null when
 * the model is unavailable or no draft is approved within the budget, so the
 * caller falls back to the deterministic narrative.
 */
export async function generateReviewedNarrative(
  input: AuditNarrativeInput,
  deps: { modelCall?: ModelCall } = {},
): Promise<ReviewedNarrative | null> {
  const modelCall = deps.modelCall ?? defaultModelCall;
  let feedback: string[] = [];
  let model = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // 1. Generate (or rewrite with feedback).
    let narrative: AuditNarrative;
    try {
      const generated = await modelCall({
        profileKey: "structured_json",
        system: GENERATION_SYSTEM,
        user: generationUserPrompt(input, feedback),
        schemaName: "auditReport",
        timeoutMs: GEN_TIMEOUT_MS,
      });
      model = generated.model;
      const parsed = generatedCopySchema.safeParse(generated.json);
      if (!parsed.success) {
        feedback = [`The previous output did not match the required JSON shape (${summariseZodError(parsed.error)}). Return valid JSON only.`];
        continue;
      }
      narrative = toAuditNarrative(parsed.data, input);
    } catch {
      // Model/network failure: abandon the LLM path; caller uses deterministic.
      return null;
    }

    // 2. Deterministic gate.
    const violations = auditCopyViolations(narrative, input.stats, input.signals);
    if (violations.length > 0) {
      feedback = violations;
      continue;
    }

    // 3. Frontier-AI critic.
    let verdict: ReviewVerdict;
    try {
      const reviewed = await modelCall({
        profileKey: "compliance_review",
        system: REVIEW_SYSTEM,
        user: reviewUserPrompt(input, narrative),
        schemaName: "auditReview",
        timeoutMs: REVIEW_TIMEOUT_MS,
      });
      const parsed = reviewSchema.safeParse(reviewed.json);
      if (!parsed.success) {
        // Cannot trust an unparseable verdict; do not publish unreviewed copy.
        return null;
      }
      verdict = parsed.data;
    } catch {
      return null;
    }

    if (!verdictBlocksPublish(verdict)) {
      return { narrative, review: verdict, model, attempts: attempt };
    }
    feedback = reviewFeedback(verdict);
  }

  return null;
}

function summariseZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

// --- Signature + cache -----------------------------------------------------

/** Stable hash of the inputs that drive the copy. Any change -> new cache key. */
export function computeAuditSignature(input: AuditNarrativeInput): string {
  const { label, stats, signals } = input;
  const basis = {
    copyVersion: COPY_VERSION,
    label,
    detected: stats.totals.detected,
    active: stats.totals.active,
    inactive: stats.totals.inactive,
    advertiserCount: stats.advertiserCount,
    activeAdvertiserCount: stats.activeAdvertiserCount,
    newLast30Days: stats.newLast30Days,
    longestRunningDays: stats.longestRunningDays,
    medianDaysRunning: stats.medianDaysRunning,
    capped: stats.capped,
    topAdvertisers: stats.topAdvertisers.map((a) => [a.name, a.ads, a.active, a.longestRunningDays]),
    formats: stats.formats.map((f) => [f.label, f.count]),
    platforms: stats.platforms.map((p) => [p.label, p.count]),
    adTypes: stats.adTypes.map((a) => [a.label, a.count]),
    topCtas: stats.topCtas.map((c) => [c.label, c.count]),
    signals: {
      currentActivityLevel: signals.currentActivityLevel,
      recentActivityPattern: signals.recentActivityPattern,
      marketConcentration: signals.marketConcentration,
      creativeFormatPattern: signals.creativeFormatPattern,
      messagePattern: signals.messagePattern,
      signalConfidence: signals.signalConfidence,
    },
  };
  return createHash("sha256").update(JSON.stringify(basis)).digest("hex");
}

export async function readAuditNarrativeFromCache(
  supabase: SupabaseClient,
  signature: string,
  now: number = Date.now(),
): Promise<AuditNarrative | null> {
  const { data, error } = await supabase
    .from(AUDIT_COPY_TABLE)
    .select("narrative, expires_at")
    .eq("signature", signature)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { narrative: unknown; expires_at: string | null };
  if (row.expires_at) {
    const expiry = new Date(row.expires_at).getTime();
    if (Number.isFinite(expiry) && expiry < now) return null;
  }
  const parsed = narrativeShapeSchema.safeParse(row.narrative);
  return parsed.success ? parsed.data : null;
}

async function writeAuditNarrativeToCache(
  supabase: SupabaseClient,
  args: { signature: string; input: AuditNarrativeInput; reviewed: ReviewedNarrative; now?: number },
): Promise<void> {
  const now = args.now ?? Date.now();
  await supabase.from(AUDIT_COPY_TABLE).upsert(
    {
      signature: args.signature,
      location_label: args.input.label,
      narrative: args.reviewed.narrative,
      review: args.reviewed.review,
      model: args.reviewed.model,
      source: "llm",
      meta: {
        attempts: args.reviewed.attempts,
        signalConfidence: args.input.signals.signalConfidence,
        detected: args.input.stats.totals.detected,
        active: args.input.stats.totals.active,
      },
      updated_at: new Date(now).toISOString(),
      expires_at: new Date(now + CACHE_TTL_MS).toISOString(),
    },
    { onConflict: "signature" },
  );
}

/**
 * Background warm: generate + review, and cache on approval. Best-effort and
 * self-contained (swallows its own errors) so it is safe to fire-and-forget.
 * Returns true when fresh LLM copy was cached.
 */
export async function generateAndCacheAuditNarrative(
  supabase: SupabaseClient,
  input: AuditNarrativeInput,
  options: { signature?: string; modelCall?: ModelCall; now?: number } = {},
): Promise<boolean> {
  try {
    const signature = options.signature ?? computeAuditSignature(input);
    const reviewed = await generateReviewedNarrative(input, { modelCall: options.modelCall });
    if (!reviewed) return false;
    await writeAuditNarrativeToCache(supabase, { signature, input, reviewed, now: options.now });
    return true;
  } catch {
    return false;
  }
}

export type ResolvedAuditNarrative = {
  narrative: AuditNarrative;
  source: "cache" | "deterministic";
  signature: string;
};

function safeServiceClient(): SupabaseClient | null {
  try {
    return createSupabaseServiceClient();
  } catch {
    return null;
  }
}

/**
 * Page entrypoint. Returns cached LLM copy when available, otherwise the
 * deterministic narrative immediately, and schedules a background warm so the
 * next view of this exact scan shape gets the reviewed LLM copy. Never throws,
 * never blocks on the model.
 */
export async function resolveAuditNarrative(
  input: AuditNarrativeInput,
  options: {
    supabase?: SupabaseClient | null;
    scheduleBackground?: (task: () => Promise<void>) => void;
    env?: NodeJS.ProcessEnv;
    now?: number;
  } = {},
): Promise<ResolvedAuditNarrative> {
  const deterministic = buildAuditNarrative(input);
  const supabase = options.supabase ?? safeServiceClient();
  const signature = computeAuditSignature(input);

  if (!supabase) {
    return { narrative: deterministic, source: "deterministic", signature };
  }

  try {
    const cached = await readAuditNarrativeFromCache(supabase, signature, options.now ?? Date.now());
    if (cached) return { narrative: cached, source: "cache", signature };
  } catch {
    // Cache read failure is non-fatal; fall through to deterministic.
  }

  if (auditCopyEnabled(options.env ?? process.env) && options.scheduleBackground) {
    options.scheduleBackground(() =>
      generateAndCacheAuditNarrative(supabase, input, { signature }).then(() => undefined),
    );
  }

  return { narrative: deterministic, source: "deterministic", signature };
}
