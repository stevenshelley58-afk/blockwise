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

/**
 * Angles inside real estate. When an area is almost entirely real estate the
 * cross-category breakdown says nothing useful to an agent reading the report,
 * so the same analysis runs one level down: which selling angle is crowded and
 * which is missing.
 */
export const REPORT_ANGLES = [
  "appraisal or valuation",
  "just sold or results",
  "seller guide or market update",
  "single listing",
  "open home",
  "agent or agency brand",
] as const;

export type ReportAngle = (typeof REPORT_ANGLES)[number];

export type ReportInsight = {
  kind: "dominance" | "gap" | "longevity";
  title: string;
  body: string;
};

export type GapConcept = {
  /** Unique render key; several concepts can share a category. */
  key: string;
  category: ReportCategory;
  label: string;
  headline: string;
  body: string;
  cta: string;
  rationale: string;
};

export type ChartRow = { label: string; count: number };

export type SuburbReportInsights = {
  categoryCounts: Record<ReportCategory, number>;
  angleCounts: Record<ReportAngle, number>;
  /** True when the observed set is dominated by real estate advertisers. */
  isRealEstateArea: boolean;
  chartTitle: string;
  chartRows: ChartRow[];
  gapNote: string;
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

const CONCEPTS: Record<ReportCategory, Omit<GapConcept, "category" | "rationale" | "key">> = {
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

const ANGLE_CONCEPTS: Record<ReportAngle, Omit<GapConcept, "category" | "rationale" | "key">> = {
  "appraisal or valuation": {
    label: "Appraisal angle",
    headline: "What is your {suburb} home worth today?",
    body: "A dated local appraisal from an agent who sells here, not an automated estimate.",
    cta: "Get the number",
  },
  "just sold or results": {
    label: "Results angle",
    headline: "What {suburb} homes actually sold for",
    body: "Recent local sales with the real numbers, not the asking prices.",
    cta: "See the results",
  },
  "seller guide or market update": {
    label: "Seller guide angle",
    headline: "Thinking of selling in {suburb}?",
    body: "The things that move the price around here, in one short page.",
    cta: "Read the guide",
  },
  "open home": {
    label: "Open home angle",
    headline: "Every {suburb} home open this Saturday",
    body: "One list, updated Friday night, so nobody drives around guessing.",
    cta: "See the list",
  },
  "single listing": {
    label: "Listing angle",
    headline: "Just listed in {suburb}",
    body: "One property, the full story, before it reaches the portals.",
    cta: "See the property",
  },
  "agent or agency brand": {
    label: "Local presence angle",
    headline: "The agent who actually lives in {suburb}",
    body: "Local, contactable, and not a call centre in another postcode.",
    cta: "Meet the agent",
  },
};

/** Seller-lead angles first: those are the ones an agent can act on this week. */
const ANGLE_PREFERENCE: ReportAngle[] = [
  "appraisal or valuation",
  "just sold or results",
  "seller guide or market update",
  "open home",
  "single listing",
  "agent or agency brand",
];

const ANGLE_TITLES: Record<ReportAngle, string> = {
  "appraisal or valuation": "Appraisal and valuation offers",
  "just sold or results": "Just sold and results posts",
  "seller guide or market update": "Seller guides and market updates",
  "single listing": "Single property listings",
  "open home": "Open home promotion",
  "agent or agency brand": "Agent and agency brand ads",
};

const REAL_ESTATE_AREA_THRESHOLD = 0.6;

export function buildSuburbReportInsights(
  ads: PublicAdRadarCard[],
  suburb: string,
  now = Date.now(),
): SuburbReportInsights {
  const categoryCounts = Object.fromEntries(REPORT_CATEGORIES.map((category) => [category, 0])) as Record<ReportCategory, number>;
  for (const ad of ads) categoryCounts[classifyAd(ad)] += 1;

  const angleCounts = Object.fromEntries(REPORT_ANGLES.map((angle) => [angle, 0])) as Record<ReportAngle, number>;
  for (const ad of ads) if (classifyAd(ad) === "real estate") angleCounts[classifyRealEstateAngle(ad)] += 1;

  const ranked = [...REPORT_CATEGORIES].sort((a, b) => categoryCounts[b] - categoryCounts[a]);
  const topCategory = ranked[0];
  const topCategoryShare = ads.length === 0 ? 0 : Math.round((categoryCounts[topCategory] / ads.length) * 100);
  const longestRunningAd = [...ads].sort((a, b) => runningDays(b, now) - runningDays(a, now))[0] ?? null;
  const longestRunningDays = longestRunningAd ? runningDays(longestRunningAd, now) : 0;
  const distinctAdvertiserCount = new Set(ads.map((ad) => ad.pageName.trim().toLowerCase()).filter(Boolean)).size;

  const realEstateCount = categoryCounts["real estate"];
  const isRealEstateArea = ads.length > 0 && realEstateCount / ads.length >= REAL_ESTATE_AREA_THRESHOLD;

  const longevityInsight: ReportInsight = longestRunningDays >= 60
    ? {
        kind: "longevity",
        title: `${longestRunningDays} days and still running`,
        body: `${longestRunningAd?.pageName ?? "The longest-running advertiser"} has kept one ad live for at least ${longestRunningDays} days. Ads that stop producing enquiries usually get switched off, so a long run is a strong sign this one is still bringing in leads. It is a signal, not a guarantee.`,
      }
    : {
        kind: "longevity",
        title: "The local ad mix is changing quickly",
        body: "No observed ad has reached 60 days, so long-running creative is not yet a strong local signal.",
      };

  if (isRealEstateArea) {
    const rankedAngles = [...REPORT_ANGLES].sort(
      (a, b) => angleCounts[b] - angleCounts[a] || ANGLE_PREFERENCE.indexOf(a) - ANGLE_PREFERENCE.indexOf(b),
    );
    const topAngle = rankedAngles[0];
    const topAngleShare = Math.round((angleCounts[topAngle] / realEstateCount) * 100);
    const quietAngles = [...REPORT_ANGLES].sort(
      (a, b) => angleCounts[a] - angleCounts[b] || ANGLE_PREFERENCE.indexOf(a) - ANGLE_PREFERENCE.indexOf(b),
    );
    const gapAngle = quietAngles[0];

    return {
      categoryCounts,
      angleCounts,
      isRealEstateArea,
      chartTitle: "Live ads by angle",
      chartRows: REPORT_ANGLES.map((angle) => ({ label: angle, count: angleCounts[angle] })),
      gapNote: `Three angles that almost nobody is running in ${suburb} right now`,
      distinctAdvertiserCount,
      gapConcepts: quietAngles.slice(0, 3).map((angle) => ({
        key: angle,
        category: "real estate" as const,
        ...ANGLE_CONCEPTS[angle],
        headline: ANGLE_CONCEPTS[angle].headline.replaceAll("{suburb}", suburb),
        rationale: `${angleCounts[angle]} of ${realEstateCount} observed real estate ads use this angle. Treat it as a starting hypothesis and check it against your own results.`,
      })),
      insights: [
        {
          kind: "dominance",
          title: `${ANGLE_TITLES[topAngle]} dominate here`,
          body: `${angleCounts[topAngle]} of ${realEstateCount} observed real estate ads (${topAngleShare}%) run this angle. Another one of these competes on budget, not on message.`,
        },
        {
          kind: "gap",
          title: angleCounts[gapAngle] === 0
            ? `Nobody is running ${ANGLE_TITLES[gapAngle].toLowerCase()}`
            : `${ANGLE_TITLES[gapAngle]} are barely used`,
          body: `${angleCounts[gapAngle]} of ${realEstateCount} observed real estate ads use this angle. That is an opening in the local message mix, not a promise of cheaper leads.`,
        },
        longevityInsight,
      ],
      longestRunningAd,
      longestRunningDays,
      topCategory,
      topCategoryShare,
    };
  }

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
    longevityInsight,
  ];

  const gapConcepts = ranked
    .slice()
    .reverse()
    .slice(0, 3)
    .map((category) => {
      const template = CONCEPTS[category];
      const count = categoryCounts[category];
      return {
        key: category,
        category,
        ...template,
        headline: template.headline.replaceAll("{suburb}", suburb),
        rationale: `${count} of ${ads.length} observed ads map to ${category}. Use this as a starting hypothesis and validate the offer with your own results.`,
      };
    });

  return {
    categoryCounts,
    angleCounts,
    isRealEstateArea,
    chartTitle: "Live ads by category",
    chartRows: REPORT_CATEGORIES.map((category) => ({ label: category, count: categoryCounts[category] })),
    gapNote: `Three concepts based on categories with lighter representation in ${suburb}`,
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

/** The recorded ad type wins; free text only decides what the type left open. */
export function classifyRealEstateAngle(ad: PublicAdRadarCard): ReportAngle {
  const type = (ad.adType ?? "").toLowerCase().replaceAll("_", " ").trim();
  if (type.includes("appraisal") || type.includes("valuation")) return "appraisal or valuation";
  if (type.includes("sold") || type.includes("result")) return "just sold or results";
  if (type.includes("guide") || type.includes("market update") || type.includes("report")) return "seller guide or market update";
  if (type.includes("open home") || type.includes("home open") || type.includes("inspection")) return "open home";
  if (type.includes("listing") || type.includes("for sale") || type.includes("auction")) return "single listing";
  if (type.includes("brand") || type.includes("agent") || type.includes("agency")) return "agent or agency brand";

  const text = [ad.headline, ad.body, ad.description, ad.cta].filter(Boolean).join(" ").toLowerCase();
  if (/\b(appraisal|appraise|valuation|what.{0,20}worth|property report)\b/u.test(text)) return "appraisal or valuation";
  if (/\b(just sold|sold in|record price|we sold|sales result)\b/u.test(text)) return "just sold or results";
  if (/\b(guide|market update|thinking (of|about) selling|tips|checklist|ebook)\b/u.test(text)) return "seller guide or market update";
  if (/\b(home open|open home|inspection|viewing)\b/u.test(text)) return "open home";
  if (/\b(just listed|for sale|coming soon|auction|bedrooms?|bathrooms?|all offers)\b/u.test(text)) return "single listing";
  return "agent or agency brand";
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
