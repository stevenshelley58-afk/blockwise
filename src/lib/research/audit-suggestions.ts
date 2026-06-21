import { z } from "zod";

import type { AdAuditResult, AdAuditStats } from "./ad-audit.ts";

/**
 * AI marketing suggestions for the Local Ad Market Audit. Uses OpenAI when
 * OPENAI_API_KEY is set, and always falls back to deterministic, data-grounded
 * advice so the audit renders even when the model is unavailable.
 */

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";
const REQUEST_TIMEOUT_MS = 22_000;
const MAX_OUTPUT_TOKENS = 1100;

export type AuditAngle = { title: string; why: string; example: string };

export type AuditSuggestions = {
  summary: string;
  whatsWorking: string[];
  gaps: string[];
  recommendedAngles: AuditAngle[];
  quickWins: string[];
};

export type AuditSuggestionResult = {
  suggestions: AuditSuggestions;
  source: "ai" | "fallback";
};

const angleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  why: z.string().trim().min(1).max(400),
  example: z.string().trim().min(1).max(400),
});

const suggestionsSchema = z.object({
  summary: z.string().trim().min(1).max(900),
  whatsWorking: z.array(z.string().trim().min(1).max(320)).min(1).max(6),
  gaps: z.array(z.string().trim().min(1).max(320)).min(1).max(6),
  recommendedAngles: z.array(angleSchema).min(1).max(5),
  quickWins: z.array(z.string().trim().min(1).max(320)).min(1).max(6),
});

export async function generateAuditSuggestions(
  result: AdAuditResult,
  options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<AuditSuggestionResult> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey || result.stats.totals.detected === 0) {
    return { suggestions: fallbackAuditSuggestions(result), source: "fallback" };
  }

  try {
    const suggestions = await requestOpenAiSuggestions(result, apiKey, env, options.signal);
    return { suggestions, source: "ai" };
  } catch (error) {
    console.error("audit suggestions: AI generation failed, using fallback", error);
    return { suggestions: fallbackAuditSuggestions(result), source: "fallback" };
  }
}

async function requestOpenAiSuggestions(
  result: AdAuditResult,
  apiKey: string,
  env: NodeJS.ProcessEnv,
  externalSignal?: AbortSignal,
): Promise<AuditSuggestions> {
  const model = env.BLOCKWISE_AUDIT_MODEL?.trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (externalSignal) {
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        max_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(result.location.label) },
          { role: "user", content: userPrompt(result) },
        ],
      }),
    });

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `OpenAI request failed with status ${response.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("OpenAI returned an empty completion.");

    return suggestionsSchema.parse(JSON.parse(content));
  } finally {
    clearTimeout(timeout);
  }
}

function systemPrompt(area: string): string {
  return [
    `You are a senior real estate Meta (Facebook & Instagram) ads strategist preparing a local ad market audit for an agent advertising in ${area}, Australia.`,
    "Write specific, practical, no-fluff advice grounded ONLY in the supplied data.",
    "Never invent statistics, agency names, or numbers that are not in the data.",
    "Long-running ads are the strongest signal that an angle is converting — weight them heavily.",
    "Australian spelling. Speak directly to the agent ('you').",
    "Respond with STRICT JSON only, matching this shape:",
    '{"summary": string, "whatsWorking": string[], "gaps": string[], "recommendedAngles": [{"title": string, "why": string, "example": string}], "quickWins": string[]}',
    "summary: 2-3 sentences. whatsWorking/gaps/quickWins: 3-5 short items each. recommendedAngles: 3-4 items with a concrete example headline.",
  ].join(" ");
}

function userPrompt(result: AdAuditResult): string {
  const { stats } = result;
  const payload = {
    area: result.location.label,
    generatedAt: result.generatedAt,
    totals: {
      adsDetected: stats.totals.detected,
      activeNow: stats.totals.active,
      activeSharePct: Math.round(stats.totals.activeRate * 100),
      advertisers: stats.advertiserCount,
      newAdsLast30Days: stats.newLast30Days,
      longestRunningDays: stats.longestRunningDays,
      medianDaysRunning: stats.medianDaysRunning,
    },
    topAdvertisers: stats.topAdvertisers.map((a) => ({
      name: a.name,
      ads: a.ads,
      activeAds: a.active,
      longestRunningDays: a.longestRunningDays,
    })),
    longestRunningAds: stats.longestRunning.map((ad) => ({
      advertiser: ad.pageName,
      headline: ad.headline,
      daysRunning: ad.daysRunning,
      status: ad.status,
      angle: ad.adType,
      cta: ad.cta,
    })),
    formats: stats.formats,
    platforms: stats.platforms,
    angles: stats.adTypes,
    topCallsToAction: stats.topCtas,
    commonHooks: stats.commonHooks,
  };

  return [
    "Here is the audit data for the area. Analyse it and return the JSON described in the system message.",
    JSON.stringify(payload),
  ].join("\n\n");
}

export function fallbackAuditSuggestions(result: AdAuditResult): AuditSuggestions {
  const { stats } = result;
  const area = result.location.label;

  if (stats.totals.detected === 0) {
    return {
      summary: `We didn't find active Meta ads for ${area} yet — coverage in this pocket is still expanding. That's also an opportunity: few or no competitors are advertising here right now.`,
      whatsWorking: [
        "No dominant competitor has locked up the local feed, so a consistent presence can stand out fast.",
      ],
      gaps: [
        "The area looks under-advertised — being one of the only agents running ads here builds top-of-mind recall cheaply.",
      ],
      recommendedAngles: [
        {
          title: "Free property appraisal",
          why: "Appraisal offers are the most reliable seller-lead generator in residential real estate.",
          example: `What's your ${area} home worth in today's market? Free, no-obligation appraisal.`,
        },
        {
          title: "Just listed / just sold",
          why: "Local result ads prove activity and attract nearby owners thinking of selling.",
          example: `Just listed in ${area} — book a private inspection this weekend.`,
        },
      ],
      quickWins: [
        "Start with one always-on appraisal campaign to build a baseline of seller leads.",
        "Reuse your best-performing listing photos as ad creative to launch quickly.",
      ],
    };
  }

  const topAdvertiser = stats.topAdvertisers[0];
  const longest = stats.longestRunning[0];
  const topFormat = stats.formats[0];
  const videoShare = shareOf(stats.formats, ["video", "mixed"]);
  const topCta = stats.topCtas[0];
  const activePct = Math.round(stats.totals.activeRate * 100);

  const whatsWorking: string[] = [];
  if (longest) {
    whatsWorking.push(
      `${longest.pageName}'s ad "${truncate(longest.headline ?? longest.cta ?? "their top creative", 80)}" has run ${longest.daysRunning} days${longest.status === "active" ? " and is still live" : ""}. Ads that run this long are almost always converting — study its hook, offer and CTA.`,
    );
  }
  if (topAdvertiser) {
    whatsWorking.push(
      `${topAdvertiser.name} is the most active advertiser with ${topAdvertiser.ads} ad${topAdvertiser.ads === 1 ? "" : "s"} detected (${topAdvertiser.active} live) — they treat Meta as an always-on channel, not a one-off boost.`,
    );
  }
  if (topFormat) {
    whatsWorking.push(`${topFormat.label} is the most common format locally (${topFormat.count} ads) — it's the proven baseline to match before you experiment.`);
  }
  if (topCta) {
    whatsWorking.push(`"${topCta.label}" is the most-used call to action in the area — a safe default that local buyers and sellers already respond to.`);
  }

  const gaps: string[] = [];
  if (videoShare < 25) {
    gaps.push(`Only about ${videoShare}% of local ads use video. Video typically lifts reach and watch-time — a short walkthrough or piece-to-camera is an easy way to stand out.`);
  }
  if (topAdvertiser && topAdvertiser.activeRate < 0.5) {
    gaps.push("Even the busiest advertiser keeps less than half their ads live — most local campaigns are short-lived, so a disciplined always-on presence will out-last competitors.");
  }
  if (stats.newLast30Days < Math.max(3, Math.round(stats.totals.detected * 0.1))) {
    gaps.push(`Few new ads launched in the last 30 days (${stats.newLast30Days}). Fresh creative is scarce right now — launching now means less competition for attention.`);
  }
  if (gaps.length === 0) {
    gaps.push("The market is competitive and active — differentiate on offer and creative quality rather than just showing up.");
  }

  const usedAngles = new Set(stats.adTypes.map((type) => type.label.toLowerCase()));
  const recommendedAngles = candidateAngles(area).filter((angle) => !usedAngles.has(angle.title.toLowerCase())).slice(0, 3);
  if (recommendedAngles.length < 2) {
    recommendedAngles.push(...candidateAngles(area).slice(0, 3 - recommendedAngles.length));
  }

  const quickWins: string[] = [
    longest
      ? `Model your next ad on the longest-running local creative: match its angle (${longest.adType ?? "core offer"}), then improve the image and first line.`
      : "Build one strong always-on appraisal ad and let it run — consistency beats bursts.",
    videoShare < 25
      ? "Add one short video ad (15-30s) to a market most competitors are running as static images."
      : "Refresh creative every 2-3 weeks to avoid fatigue in an active market.",
    `Keep at least one campaign live at all times — ${activePct}% of detected ads are active, so gaps in your presence are visible to local owners.`,
  ];

  const summary = `We detected ${stats.totals.detected} property ads across ${area}, with ${stats.totals.active} still live (${activePct}%) from ${stats.advertiserCount} advertiser${stats.advertiserCount === 1 ? "" : "s"}. ${topAdvertiser ? `${topAdvertiser.name} is setting the pace` : "Activity is spread across several agencies"}${longest ? `, and the longest-running ad has been live ${longest.daysRunning} days` : ""}. The patterns below show what's already working and where the gaps are.`;

  return { summary, whatsWorking: whatsWorking.slice(0, 4), gaps: gaps.slice(0, 4), recommendedAngles, quickWins: quickWins.slice(0, 4) };
}

function candidateAngles(area: string): AuditAngle[] {
  return [
    { title: "Free Appraisal", why: "The most dependable seller-lead offer — low friction and high intent.", example: `Curious what your ${area} home is worth? Get a free, no-obligation appraisal this week.` },
    { title: "Just Sold", why: "Social proof that you achieve results attracts nearby owners weighing a sale.", example: `Another ${area} home SOLD — wondering what yours could achieve? Let's talk.` },
    { title: "Market Update", why: "Positions you as the local expert and warms up sellers who aren't ready yet.", example: `${area} market update: what buyers are paying right now (and what it means for sellers).` },
    { title: "Buyer Demand", why: "Scarcity and demand framing nudges hesitant owners to list.", example: `Buyers are waiting for homes in ${area}. Find out how much yours is in demand.` },
  ];
}

function shareOf(counts: { label: string; count: number }[], labels: string[]): number {
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) return 0;
  const wanted = new Set(labels.map((label) => label.toLowerCase()));
  const matched = counts.filter((item) => wanted.has(item.label.toLowerCase())).reduce((sum, item) => sum + item.count, 0);
  return Math.round((matched / total) * 100);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

export type { AdAuditStats };
