import type { PublicAdRadarCard } from "./public-ad-radar.ts";

export const REPORT_CATEGORIES = [
  "real estate",
  "health",
  "fitness",
  "hospitality",
  "home services",
  "retail & other",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportInsight = {
  kind: "dominance" | "gap" | "longevity";
  title: string;
  body: string;
};

export type GapConcept = {
  category: ReportCategory;
  label: string;
  headline: string;
  body: string;
  cta: string;
  rationale: string;
};

export type SuburbReportInsights = {
  categoryCounts: Record<ReportCategory, number>;
  distinctAdvertiserCount: number;
  gapConcepts: GapConcept[];
  insights: ReportInsight[];
  longestRunningAd: PublicAdRadarCard | null;
  longestRunningDays: number;
  topCategory: ReportCategory;
  topCategoryShare: number;
};

const CATEGORY_TERMS: Record<Exclude<ReportCategory, "retail & other">, string[]> = {
  "real estate": ["real estate", "property", "realtor", "home appraisal", "listing", "open home", "sold"],
  health: ["health", "medical", "dental", "dentist", "clinic", "physio", "chiro", "therapy"],
  fitness: ["fitness", "gym", "pilates", "yoga", "training", "workout", "crossfit"],
  hospitality: ["restaurant", "cafe", "coffee", "pizza", "bar", "brew", "hotel", "dining", "book a table"],
  "home services": ["plumb", "electric", "solar", "clean", "roof", "landscap", "trade", "renovation", "pest"],
};

const CONCEPTS: Record<ReportCategory, Omit<GapConcept, "category" | "rationale">> = {
  "home services": {
    label: "Home services opportunity",
    headline: "The 60-minute plumber in {suburb}",
    body: "Blocked drain or burst pipe? Local, licensed, and ready to answer.",
    cta: "Call now",
  },
  "real estate": {
    label: "Real estate angle",
    headline: "Know what your {suburb} home could be worth",
    body: "Request a local appraisal with no lock-in and no letterbox spam.",
    cta: "Get appraisal",
  },
  hospitality: {
    label: "Midweek hospitality angle",
    headline: "Tuesday is the new Friday in {suburb}",
    body: "Give locals a specific reason to book on your quietest night.",
    cta: "Book a table",
  },
  health: {
    label: "Health opportunity",
    headline: "Appointments available this week in {suburb}",
    body: "Make the next step clear for locals who have been putting it off.",
    cta: "Book now",
  },
  fitness: {
    label: "Fitness opportunity",
    headline: "Start close to home in {suburb}",
    body: "A practical local offer for people ready to restart their routine.",
    cta: "Try a class",
  },
  "retail & other": {
    label: "Local retail opportunity",
    headline: "A local-only offer for {suburb}",
    body: "Turn a clear product benefit into a reason to visit this week.",
    cta: "See the offer",
  },
};

export function buildSuburbReportInsights(
  ads: PublicAdRadarCard[],
  suburb: string,
  now = Date.now(),
): SuburbReportInsights {
  const categoryCounts = Object.fromEntries(REPORT_CATEGORIES.map((category) => [category, 0])) as Record<ReportCategory, number>;
  for (const ad of ads) categoryCounts[classifyAd(ad)] += 1;

  const ranked = [...REPORT_CATEGORIES].sort((a, b) => categoryCounts[b] - categoryCounts[a]);
  const topCategory = ranked[0];
  const topCategoryShare = ads.length === 0 ? 0 : Math.round((categoryCounts[topCategory] / ads.length) * 100);
  const longestRunningAd = [...ads].sort((a, b) => runningDays(b, now) - runningDays(a, now))[0] ?? null;
  const longestRunningDays = longestRunningAd ? runningDays(longestRunningAd, now) : 0;
  const distinctAdvertiserCount = new Set(ads.map((ad) => ad.pageName.trim().toLowerCase()).filter(Boolean)).size;

  const gapCategory = ranked
    .slice()
    .reverse()
    .find((category) => ads.length > 0 && categoryCounts[category] / ads.length <= 0.1) ?? ranked[ranked.length - 1];

  const insights: ReportInsight[] = [
    topCategoryShare >= 30
      ? {
          kind: "dominance",
          title: `${titleCase(topCategory)} is the most visible category`,
          body: `${categoryCounts[topCategory]} of ${ads.length} observed ads (${topCategoryShare}%) sit in this category. A new ad needs a distinct offer, not just more presence.`,
        }
      : {
          kind: "dominance",
          title: "Attention is spread across categories",
          body: `No single category accounts for 30% of the ${ads.length} ads observed in this report.`,
        },
    ads.length > 0 && categoryCounts[gapCategory] / ads.length <= 0.1
      ? {
          kind: "gap",
          title: `${titleCase(gapCategory)} is lightly represented`,
          body: `${categoryCounts[gapCategory]} of ${ads.length} observed ads map to this category. That is a visibility gap worth testing, not a guarantee of lower costs.`,
        }
      : {
          kind: "gap",
          title: "No obvious category gap",
          body: "Every known category has a visible presence. The clearer opportunity may be a sharper offer or creative angle.",
        },
    longestRunningDays >= 60
      ? {
          kind: "longevity",
          title: `${longestRunningDays} days and still observed`,
          body: `${longestRunningAd?.pageName ?? "The longest-running advertiser"} has kept one ad visible for at least ${longestRunningDays} days. Longevity is a useful signal, but it does not prove performance.`,
        }
      : {
          kind: "longevity",
          title: "The local ad mix is changing quickly",
          body: "No observed ad has reached 60 days, so long-running creative is not yet a strong local signal.",
        },
  ];

  const gapConcepts = ranked
    .slice()
    .reverse()
    .slice(0, 3)
    .map((category) => {
      const template = CONCEPTS[category];
      const count = categoryCounts[category];
      return {
        category,
        ...template,
        headline: template.headline.replaceAll("{suburb}", suburb),
        rationale: `${count} of ${ads.length} observed ads map to ${category}. Use this as a starting hypothesis and validate the offer with your own results.`,
      };
    });

  return {
    categoryCounts,
    distinctAdvertiserCount,
    gapConcepts,
    insights,
    longestRunningAd,
    longestRunningDays,
    topCategory,
    topCategoryShare,
  };
}

export function classifyAd(ad: PublicAdRadarCard): ReportCategory {
  const text = [ad.adType, ad.pageName, ad.headline, ad.body, ad.description, ad.cta]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const category of REPORT_CATEGORIES) {
    if (category === "retail & other") continue;
    if (CATEGORY_TERMS[category].some((term) => text.includes(term))) return category;
  }
  return "retail & other";
}

function runningDays(ad: PublicAdRadarCard, now: number): number {
  const start = ad.startedAt ? new Date(ad.startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(start)) return 0;
  const end = ad.stoppedAt ? new Date(ad.stoppedAt).getTime() : now;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}
