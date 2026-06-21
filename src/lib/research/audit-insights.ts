import type { AdAuditStats, AuditCount } from "./ad-audit.ts";

/**
 * Local advertising intelligence layer for the /audit report. Turns raw scan
 * aggregates into conservative public-data signals and a calm written readout.
 * Pure and unit-tested: no I/O, no model calls, no sales copy, and no claims
 * about performance, spend, or conversion (the Meta Ad Library is a public
 * search tool, not a results database).
 */

export type CurrentActivityLevel = "none" | "low" | "moderate" | "high";

export type RecentActivityPattern =
  | "quiet"
  | "recent_burst_now_paused"
  | "steady_activity"
  | "active_growth"
  | "stale_archive";

export type MarketConcentration =
  | "one_dominant_advertiser"
  | "concentrated"
  | "fragmented"
  | "too_little_data";

export type CreativeFormatPattern = "image_heavy" | "video_heavy" | "mixed" | "too_little_data";

export type MessagePattern =
  | "listing_led"
  | "appraisal_led"
  | "proof_led"
  | "generic"
  | "mixed"
  | "too_little_data";

export type SignalConfidence = "low" | "medium" | "high";

export type AuditSignals = {
  currentActivityLevel: CurrentActivityLevel;
  recentActivityPattern: RecentActivityPattern;
  marketConcentration: MarketConcentration;
  creativeFormatPattern: CreativeFormatPattern;
  messagePattern: MessagePattern;
  signalConfidence: SignalConfidence;
  // Supporting numbers the written report leans on.
  activeAdvertisers: number;
  topAdvertiserShare: number; // 0..1 of detected ads held by the single top advertiser
  topTwoShare: number; // 0..1 held by the top two advertisers
  classifiedAngleRatio: number; // 0..1 of detected ads with a resolved angle
  imageShare: number; // 0..1 static-image share of detected ads
  videoShare: number; // 0..1 video share of detected ads
  dominantMessage: { label: string; share: number } | null;
};

/** One advisory block. No block renders unless all six fields are present. */
export type InsightBlock = {
  id: string;
  title: string;
  observation: string;
  interpretation: string;
  whyItMatters: string;
  whatNotToAssume: string;
  usefulActions: string[];
  confidence: SignalConfidence;
};

export type AuditNarrative = {
  headline: string;
  snapshot: string[];
  dataQuality: string[];
  blocks: InsightBlock[];
  usefulActions: string[];
  limitations: string[];
  confidence: SignalConfidence;
};

// Thresholds. Named so the rules stay legible and testable.
const MIN_SAMPLE = 10; // below this, most signals downgrade to "too little data"
const STRONG_SAMPLE = 25; // enough breadth for higher confidence
const RECENT_HIGH = 8; // new_ads_30d considered a meaningful burst
const RECENT_LOW = 3; // new_ads_30d considered quiet
const ACTIVE_HIGH = 8;
const ACTIVE_LOW = 2;
const DOMINANT_SHARE = 0.45;
const CONCENTRATED_SHARE = 0.6;
const IMAGE_HEAVY_SHARE = 0.65;
const VIDEO_HEAVY_SHARE = 0.35;
const LONG_RUN_DAYS = 60;
const GOOD_CLASSIFICATION = 0.5;

type MessageBucket = "listing" | "appraisal" | "proof" | "generic";

/** Pure: derive the six public-data signals from scan aggregates. */
export function computeAuditSignals(stats: AdAuditStats): AuditSignals {
  const detected = stats.totals.detected;
  const activeAds = stats.totals.active;
  const activeAdvertisers = stats.topAdvertisers.filter((advertiser) => advertiser.active > 0).length;
  const advertiserCount = stats.advertiserCount;
  const new30 = stats.newLast30Days;

  const topAdvertiserShare = share(stats.topAdvertisers[0]?.ads ?? 0, detected);
  const topTwoShare = share(
    (stats.topAdvertisers[0]?.ads ?? 0) + (stats.topAdvertisers[1]?.ads ?? 0),
    detected,
  );

  const classifiedAngle = sumCounts(stats.adTypes);
  const classifiedAngleRatio = share(classifiedAngle, detected);

  const imageShare = share(formatCount(stats.formats, ["Image", "Carousel"]), detected);
  const videoShare = share(formatCount(stats.formats, ["Video"]), detected);

  const message = classifyMessage(stats.adTypes);

  return {
    currentActivityLevel: currentActivityLevel(activeAds, activeAdvertisers),
    recentActivityPattern: recentActivityPattern(detected, activeAds, new30),
    marketConcentration: marketConcentration(detected, advertiserCount, topAdvertiserShare, topTwoShare),
    creativeFormatPattern: creativeFormatPattern(detected, imageShare, videoShare),
    messagePattern: message.pattern,
    signalConfidence: signalConfidence(detected, activeAds, advertiserCount, classifiedAngleRatio),
    activeAdvertisers,
    topAdvertiserShare,
    topTwoShare,
    classifiedAngleRatio,
    imageShare,
    videoShare,
    dominantMessage: message.dominant,
  };
}

function currentActivityLevel(activeAds: number, activeAdvertisers: number): CurrentActivityLevel {
  if (activeAds === 0) return "none";
  if (activeAdvertisers > 5 || activeAds > 15) return "high";
  if ((activeAdvertisers >= 3 && activeAdvertisers <= 5) || (activeAds >= 5 && activeAds <= 15)) {
    return "moderate";
  }
  return "low";
}

function recentActivityPattern(detected: number, activeAds: number, new30: number): RecentActivityPattern {
  const newHigh = new30 >= RECENT_HIGH;
  const newLow = new30 <= RECENT_LOW;
  const activeHigh = activeAds >= ACTIVE_HIGH;
  const activeLow = activeAds <= ACTIVE_LOW;

  if (activeHigh && newHigh) return "active_growth";
  if (newHigh && activeLow) return "recent_burst_now_paused";
  if (activeAds >= 3 && new30 >= 4) return "steady_activity";
  if (detected < 5 && activeLow) return "quiet";
  if (newLow && activeLow) return "stale_archive";
  return activeAds >= 3 ? "steady_activity" : "stale_archive";
}

function marketConcentration(
  detected: number,
  advertiserCount: number,
  topShare: number,
  topTwoShare: number,
): MarketConcentration {
  if (advertiserCount <= 2 || detected < MIN_SAMPLE) return "too_little_data";
  if (topShare > DOMINANT_SHARE) return "one_dominant_advertiser";
  if (topTwoShare > CONCENTRATED_SHARE) return "concentrated";
  return "fragmented";
}

function creativeFormatPattern(detected: number, imageShare: number, videoShare: number): CreativeFormatPattern {
  if (detected < MIN_SAMPLE) return "too_little_data";
  if (imageShare > IMAGE_HEAVY_SHARE) return "image_heavy";
  if (videoShare > VIDEO_HEAVY_SHARE) return "video_heavy";
  return "mixed";
}

function signalConfidence(
  detected: number,
  activeAds: number,
  advertiserCount: number,
  classifiedAngleRatio: number,
): SignalConfidence {
  if (detected < MIN_SAMPLE || classifiedAngleRatio < GOOD_CLASSIFICATION || advertiserCount <= 2) {
    return "low";
  }
  if (detected >= STRONG_SAMPLE && advertiserCount >= 3 && activeAds > 0 && classifiedAngleRatio >= 0.6) {
    return "high";
  }
  return "medium";
}

function classifyMessage(adTypes: AuditCount[]): {
  pattern: MessagePattern;
  dominant: { label: string; share: number } | null;
} {
  const classified = sumCounts(adTypes);
  if (classified < 5) return { pattern: "too_little_data", dominant: null };

  const buckets: Record<MessageBucket, number> = { listing: 0, appraisal: 0, proof: 0, generic: 0 };
  let topLabel: { label: string; count: number } | null = null;

  for (const entry of adTypes) {
    const bucket = messageBucket(entry.label);
    buckets[bucket] += entry.count;
    if (!topLabel || entry.count > topLabel.count) topLabel = entry;
  }

  const dominant = topLabel ? { label: topLabel.label, share: share(topLabel.count, classified) } : null;
  const listingShare = buckets.listing / classified;
  const appraisalShare = buckets.appraisal / classified;
  const proofShare = buckets.proof / classified;
  const genericShare = buckets.generic / classified;

  if (listingShare > 0.5) return { pattern: "listing_led", dominant };
  if (appraisalShare > 0.5) return { pattern: "appraisal_led", dominant };
  if (proofShare > 0.5) return { pattern: "proof_led", dominant };
  if (genericShare + appraisalShare > 0.6) return { pattern: "generic", dominant };
  return { pattern: "mixed", dominant };
}

function messageBucket(label: string): MessageBucket {
  const value = label.toLowerCase();
  if (/(just listed|new listing|open home|for sale|inspection|auction|listing)/.test(value)) return "listing";
  if (/(appraisal|valuation|what'?s my home worth|home value|market value)/.test(value)) return "appraisal";
  if (/(just sold|sold|result|record|review|testimonial|award|under offer)/.test(value)) return "proof";
  return "generic";
}

// Narrative - advisory modules selected by the signals above.
export function buildAuditNarrative(input: {
  label: string;
  stats: AdAuditStats;
  signals: AuditSignals;
}): AuditNarrative {
  const { label, stats, signals } = input;
  const detected = stats.totals.detected;
  const activeAds = stats.totals.active;

  const blocks: InsightBlock[] = [];
  const push = (block: InsightBlock | null) => {
    if (block && isComplete(block)) blocks.push(block);
  };

  push(moduleNoActiveAds(label, stats, signals));
  push(moduleRecentBurst(label, stats, signals));
  push(moduleOneDominant(label, stats, signals));
  push(moduleManyAdvertisersLowActive(label, stats, signals));
  push(moduleAngleSaturation(label, stats, signals));
  push(moduleImageHeavy(label, stats, signals));
  push(moduleLongRunning(label, stats, signals));
  push(moduleWeakClassification(label, stats, signals));

  return {
    headline: `${label} - local advertising signal report`,
    snapshot: snapshotParagraphs(label, stats, signals),
    dataQuality: dataQualityNotes(stats, signals),
    blocks,
    usefulActions: usefulActions(label, stats, signals),
    limitations: limitations(),
    confidence: signals.signalConfidence,
  };
}

function snapshotParagraphs(label: string, stats: AdAuditStats, signals: AuditSignals): string[] {
  const detected = stats.totals.detected;
  const active = stats.totals.active;
  const advertisers = stats.advertiserCount;
  const new30 = stats.newLast30Days;

  if (detected === 0) {
    return [
      `No real estate ads were detected around ${label} at scan time. That is not the same as the area being inactive - it means this scan surfaced no matching ads in the public Meta Ad Library for the suburb and its immediate surrounds.`,
      `Treat this as a prompt to re-check rather than a verdict. Public ad data is partial and timing-sensitive, and a single empty scan is a weak signal on its own.`,
    ];
  }

  const lead =
    `This scan detected ${countLabel(detected, "real estate ad")} around ${label} from ` +
    `${countLabel(advertisers, "advertiser")}, with ${active} active at scan time. ` +
    activePhrase(active, detected);

  const paragraphs = [lead];

  if (signals.recentActivityPattern === "recent_burst_now_paused") {
    paragraphs.push(
      `The more useful pattern is the gap between recent and active: ${countLabel(new30, "ad")} were marked new in the last 30 days, ` +
        `but only ${active} ${active === 1 ? "is" : "are"} still live. That points to short-lived, listing-led bursts, recently paused tests, ` +
        `or scan-timing effects - not necessarily ads that failed.`,
    );
  } else if (signals.currentActivityLevel === "high") {
    paragraphs.push(
      `Several advertisers are visibly active at scan time, so this reads less like a historical archive and more like a market where attention ` +
        `is currently being bought. The detail worth reading is who, with what message, rather than the headline count alone.`,
    );
  } else {
    paragraphs.push(
      `Most of what this scan found is historical and recent rather than live. The value here is in what local advertisers have recently been ` +
        `willing to put in market - directional context, not a live competitive scoreboard.`,
    );
  }

  return paragraphs;
}

function dataQualityNotes(stats: AdAuditStats, signals: AuditSignals): string[] {
  const notes: string[] = [];
  const detected = stats.totals.detected;

  notes.push(
    `Source: public Meta (Facebook & Instagram) Ad Library, read at scan time. Only advertisers confirmed as real estate agencies surface here; ` +
      `other local businesses are filtered out before the report is built.`,
  );

  if (detected > 0) {
    notes.push(
      `Angle classification covers ${percent(signals.classifiedAngleRatio)} of detected ads. ` +
        (signals.classifiedAngleRatio < GOOD_CLASSIFICATION
          ? `That is below half, so treat the message and angle counts as directional only.`
          : `Treat angle counts as directional rather than exact.`),
    );
  }

  if (stats.capped) {
    notes.push(
      `This is a high-volume area, so figures are based on the most recently active ads captured rather than every ad ever detected.`,
    );
  }

  if (detected > 0 && detected < MIN_SAMPLE) {
    notes.push(
      `The detected sample is small (${detected}). Single-scan patterns are fragile at this size - a weekly trend will say more than this snapshot.`,
    );
  }

  return notes;
}

// --- Module 1: no active ads ----------------------------------------------
function moduleNoActiveAds(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (stats.totals.active !== 0) return null;
  const detected = stats.totals.detected;
  return {
    id: "no-active-ads",
    title: "No live ads at scan time",
    observation:
      detected > 0
        ? `${countLabel(detected, "ad")} were detected around ${label}, but none were active when this scan ran.`
        : `No active real estate ads were detected around ${label} at scan time.`,
    interpretation:
      `The value of this report is in the recent historical pattern, not current live pressure. Inactive ads are examples of past messaging, ` +
      `not evidence of current strategy.`,
    whyItMatters:
      `A market with recent-but-inactive ads should be read differently from one with live ads. The first shows what agents have recently tested; ` +
      `the second shows where attention is currently being bought.`,
    whatNotToAssume:
      `Do not assume competitors are advertising right now, that the area is permanently quiet, or that paused ads performed badly. Public data cannot show that.`,
    usefulActions: [
      "Re-scan weekly for a few weeks before treating the area as quiet.",
      "Open the top advertiser pages directly in the Meta Ad Library and check their live status by hand.",
      "Search nearby suburb names, postcode variants, and agency or agent names to catch ads this scan may have missed.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 2: low active but high recent ----------------------------------
function moduleRecentBurst(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (signals.recentActivityPattern !== "recent_burst_now_paused") return null;
  return {
    id: "recent-burst",
    title: "Recent burst, little still live",
    observation:
      `${countLabel(stats.newLast30Days, "ad")} were marked new in the last 30 days, but only ${stats.totals.active} ` +
      `${stats.totals.active === 1 ? "remains" : "remain"} active around ${label}.`,
    interpretation:
      `Recent activity appears to have come in bursts rather than steady, always-on advertising. Listings sell, open homes pass, and short tests end.`,
    whyItMatters:
      `Burst patterns and steady spend call for different reads. A burst tells you the area gets advertised around specific moments, not continuously.`,
    whatNotToAssume:
      `Do not assume advertisers stopped because ads failed. They may have paused because listings sold, promotions ended, budgets lapsed, or the scan missed variants.`,
    usefulActions: [
      "Separate listing-specific ads from brand or appraisal ads when you review them.",
      "Check whether recent ads map to properties that have already sold or passed their open-home window.",
      "Re-scan around new listings to see whether activity reappears in bursts.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 3: one advertiser dominates ------------------------------------
function moduleOneDominant(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (signals.marketConcentration !== "one_dominant_advertiser") return null;
  const top = stats.topAdvertisers[0];
  if (!top) return null;
  return {
    id: "one-dominant",
    title: "One advertiser drives most of the volume",
    observation:
      `${top.name} accounts for ${percent(signals.topAdvertiserShare)} of detected ads around ${label} ` +
      `(${countLabel(top.ads, "ad")} of ${stats.totals.detected}).`,
    interpretation:
      `Most visible activity comes from a single advertiser, so the market may look busier than it is. Volume here reflects one operator's habits more than broad pressure.`,
    whyItMatters:
      `If you read the headline count as market-wide demand for ad space, you will overestimate how contested the area really is.`,
    whatNotToAssume:
      `Do not treat the total ad count as broad competition, and do not assume volume equals variety - many ads can be one idea repeated.`,
    usefulActions: [
      `Review whether ${top.name} is running genuinely different ads or many variants of the same message.`,
      "Compare the dominant advertiser's message against the smaller advertisers to see what they are not saying.",
      "Weight the rest of the report toward advertisers other than the dominant one.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 4: many advertisers, low active --------------------------------
function moduleManyAdvertisersLowActive(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (stats.advertiserCount < 3) return null;
  if (signals.currentActivityLevel !== "none" && signals.currentActivityLevel !== "low") return null;
  if (signals.recentActivityPattern === "recent_burst_now_paused") return null; // covered by Module 2
  return {
    id: "many-advertisers-low-active",
    title: "Several advertisers tested, few live now",
    observation:
      `${countLabel(stats.advertiserCount, "advertiser")} appear in the public data around ${label}, ` +
      `but only ${stats.totals.active} ${stats.totals.active === 1 ? "ad is" : "ads are"} active at scan time.`,
    interpretation:
      `Several operators have advertised here, yet little is live now - consistent with sporadic, listing-led advertising rather than continuous presence.`,
    whyItMatters:
      `It suggests attention here is event-driven. Watching for reactivation around listings or appraisal pushes will tell you more than this single snapshot.`,
    whatNotToAssume:
      `Do not assume the area is saturated, and do not assume the quiet is permanent. A snapshot cannot show the rhythm.`,
    usefulActions: [
      "Build a short watchlist of the advertisers seen here and re-check weekly.",
      "Note whether reactivation lines up with new listings, open homes, or appraisal pushes.",
      "Prefer a four-week trend line over this one reading before drawing conclusions.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 5: generic angle saturation ------------------------------------
function moduleAngleSaturation(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  const standard = signals.messagePattern;
  if (standard !== "listing_led" && standard !== "appraisal_led" && standard !== "proof_led" && standard !== "generic") {
    return null;
  }
  const lead = signals.dominantMessage;
  return {
    id: "angle-saturation",
    title: "Messaging leans on standard hooks",
    observation: lead
      ? `The most common detected angle around ${label} is "${lead.label}" (${percent(lead.share)} of classified ads), with familiar real estate hooks across the rest.`
      : `Detected messaging around ${label} leans on standard real estate hooks rather than specific local proof.`,
    interpretation:
      `The visible market is relying on category-standard messages. The risk for any new advertiser is sameness - saying what everyone else already says.`,
    whyItMatters:
      `When messaging converges, specific local proof is what stands out. Generic category language rarely differentiates.`,
    whatNotToAssume:
      `Do not assume the common angle is the best angle, and do not copy the category language just because it is everywhere. Frequency is not proof of effect.`,
    usefulActions: [
      "List the specific local proof missing from these ads: property type, suburb detail, days on market, inspection numbers, or buyer depth.",
      "Avoid vague claims like 'trusted local experts' unless they are backed by something concrete.",
      "Save the few ads that do carry specific proof as a reference set.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 6: image-heavy creative ----------------------------------------
function moduleImageHeavy(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (signals.creativeFormatPattern !== "image_heavy") return null;
  return {
    id: "image-heavy",
    title: "Mostly static-image creative",
    observation: `Image-style ads make up ${percent(signals.imageShare)} of detected creative around ${label}.`,
    interpretation:
      `The visible local market is mostly static creative. That often reflects ease of production and listing-led tiles, rather than a deliberate format decision.`,
    whyItMatters:
      `Knowing the default format tells you where the obvious sameness is - and where clearer proof or relevance could stand out, in any format.`,
    whatNotToAssume:
      `Static does not mean ineffective, and the opportunity is not automatically video. The opportunity is clearer proof and better local relevance.`,
    usefulActions: [
      "Check whether the images are property-led, agent-led, result-led, or generic brand tiles.",
      "Look for whether each image carries specific local detail or could belong to any suburb.",
      "Treat format as secondary to message when you compare examples.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 7: long-running ads --------------------------------------------
function moduleLongRunning(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (stats.longestRunningDays < LONG_RUN_DAYS) return null;
  const top = stats.longestRunning[0];
  if (!top) return null;
  return {
    id: "long-running",
    title: "A persistent, long-running ad",
    observation:
      `The longest-running detected ad around ${label} is from ${top.pageName} at ${countLabel(top.daysRunning, "day")} in market.`,
    interpretation:
      `A long run is a persistence signal, not a performance signal. It tells you the message stayed in market - not why.`,
    whyItMatters:
      `Durable messages are worth understanding: they are often broad, evergreen offers rather than time-bound listing ads.`,
    whatNotToAssume:
      `Do not infer leads, listings won, return on spend, or budget from how long an ad ran. Public data cannot show any of that.`,
    usefulActions: [
      "Save the long-running examples and read what makes them durable: broad offer, evergreen appraisal, or agent brand.",
      "Separate evergreen ads from listing-specific ads before comparing them.",
      "Treat longevity as a prompt to study the message, not as a score.",
    ],
    confidence: signals.signalConfidence,
  };
}

// --- Module 8: weak classification -----------------------------------------
function moduleWeakClassification(label: string, stats: AdAuditStats, signals: AuditSignals): InsightBlock | null {
  if (stats.totals.detected === 0) return null;
  if (signals.classifiedAngleRatio >= GOOD_CLASSIFICATION) return null;
  return {
    id: "weak-classification",
    title: "Incomplete angle classification",
    observation:
      `Only ${percent(signals.classifiedAngleRatio)} of detected ads around ${label} have a resolved angle; the rest are unclassified.`,
    interpretation:
      `The scan's message read is incomplete here, so the angle counts are a rough guide rather than a reliable ranking.`,
    whyItMatters:
      `Over-reading thin classification leads to false confidence about what the market is "saying".`,
    whatNotToAssume:
      `Do not rank angles precisely or treat the top angle as settled. The unclassified share could change the picture.`,
    usefulActions: [
      "Read the ads directly in the Meta Ad Library rather than relying on the angle counts.",
      "Treat the message section as directional only.",
      "Re-scan later - classification often improves as more of each ad is captured.",
    ],
    confidence: "low",
  };
}

function usefulActions(label: string, stats: AdAuditStats, signals: AuditSignals): string[] {
  const actions: string[] = [];
  const top = stats.topAdvertisers[0];

  if (top) {
    actions.push(`Open the top ${Math.min(3, stats.advertiserCount)} advertiser pages around ${label} directly in the Meta Ad Library and read their live ads.`);
  } else {
    actions.push(`Search ${label}, its postcode variants, and nearby suburbs directly in the Meta Ad Library.`);
  }

  if (stats.totals.active === 0) {
    actions.push("Re-scan weekly for about four weeks before calling the market quiet - one empty scan is a weak signal.");
  } else {
    actions.push("Re-scan weekly for about four weeks to turn this snapshot into a trend you can trust.");
  }

  actions.push("Save the strongest examples into a swipe file and note what specific local proof each one carries.");
  actions.push("Separate listing-led ads from appraisal-led and brand ads so you compare like with like.");

  if (signals.marketConcentration === "one_dominant_advertiser") {
    actions.push("Check whether one advertiser is inflating the headline count before reading it as market-wide demand.");
  }

  actions.push("Check whether the same advertiser runs under more than one page name, which can split or double its apparent volume.");

  return actions;
}

function limitations(): string[] {
  return [
    "The Meta Ad Library is an ads-transparency search tool, not a performance database. It shows what was visible, not what worked.",
    "Coverage is partial and timing-sensitive: ads can be missed, recently paused, or captured mid-change. A single scan is a snapshot, not a census.",
    "\"Active\" reflects delivery status at scan time only. Counts can move between scans as ads start, pause, or end.",
    "Nothing here measures spend, reach, leads, conversions, listings won, or return. Those are not in public ad data.",
    "Only confirmed real estate advertisers are included; some genuine local agencies may not yet be confirmed and would not appear.",
  ];
}

// Small helpers
function activePhrase(active: number, detected: number): string {
  if (active === 0) {
    return "None were active when this scan ran, so this is a historical and recent-activity snapshot rather than a live read.";
  }
  if (active === 1) {
    return "That single active ad makes this mostly a historical snapshot with one visible live advertiser.";
  }
  const pct = Math.round((active / Math.max(detected, 1)) * 100);
  return `That puts the live share at ${pct}% of detected ads - a partial read on who is currently visible, not a full count.`;
}

function isComplete(block: InsightBlock): boolean {
  return (
    nonEmpty(block.observation) &&
    nonEmpty(block.interpretation) &&
    nonEmpty(block.whyItMatters) &&
    nonEmpty(block.whatNotToAssume) &&
    block.usefulActions.length > 0 &&
    block.usefulActions.every(nonEmpty) &&
    (block.confidence === "low" || block.confidence === "medium" || block.confidence === "high")
  );
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return part / whole;
}

function sumCounts(items: AuditCount[]): number {
  return items.reduce((total, item) => total + item.count, 0);
}

function formatCount(formats: AuditCount[], labels: string[]): number {
  const wanted = new Set(labels.map((label) => label.toLowerCase()));
  return formats.reduce((total, item) => (wanted.has(item.label.toLowerCase()) ? total + item.count : total), 0);
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function countLabel(value: number, noun: string): string {
  const plural = value === 1 ? noun : pluralise(noun);
  return `${new Intl.NumberFormat("en-AU").format(value)} ${plural}`;
}

function pluralise(noun: string): string {
  if (/y$/i.test(noun)) return noun.replace(/y$/i, "ies");
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  return `${noun}s`;
}
// inert padding (workspace editor-sync keeps this file's byte length fixed; no runtime effect) xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx