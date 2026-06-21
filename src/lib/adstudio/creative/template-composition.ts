// Maps an AdStudio template to one of the distinct compositions and produces
// the sample copy shown on the picker preview. The real ad's copy is generated
// per customer/suburb at build time; this only illustrates the template.

import type { AdStudioTemplate } from "../templates.ts";
import type { CompositionCopy, CompositionId } from "./compositions.ts";
import { COMPOSITION_IDS } from "./compositions.ts";

// Explicit, hand-tuned structure per current extracted template key.
const KEY_TO_COMPOSITION: Record<string, CompositionId> = {
  meta_002: "splitHorizon",
  meta_021: "gridFour",
  meta_040: "magazineCover",
  meta_044: "eventCard",
  meta_055: "ribbonSold",
  meta_094: "bannerArch",
  meta_142: "ribbonSold",
  meta_245: "splitHorizon",
  meta_259: "gridFour",
  meta_317: "eventCard",
};

// Fallback by offer id for mined/radar templates.
const OFFER_TO_COMPOSITION: Record<string, CompositionId> = {
  seller_prep_checklist: "typeLed",
  home_value_update: "valueForm",
  seller_mistakes_guide: "checklist",
  suburb_market_report: "marketStat",
  auction_vs_private_treaty: "magazineCover",
  renovate_or_sell: "split",
  downsizer_guide: "bannerArch",
  buyer_inspection_checklist: "checklist",
  investor_suburb_snapshot: "statTriple",
  recent_sales_report: "gridFour",
  prelisting_timeline: "splitHorizon",
  open_home_followup: "eventCard",
};

const GOAL_TO_COMPOSITION: Record<string, CompositionId> = {
  seller_leads: "split",
  market_update_leads: "marketStat",
  investor_leads: "magazineCover",
  appraisal_bookings: "appraisalSeal",
  listing_nurture: "bannerArch",
  open_home_followup: "eventCard",
};

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function compositionForTemplate(template: Pick<AdStudioTemplate, "id" | "templateKey" | "goal" | "offerId">): CompositionId {
  const key = (template.templateKey ?? template.id ?? "").toLowerCase();
  if (KEY_TO_COMPOSITION[key]) return KEY_TO_COMPOSITION[key];
  if (template.offerId && OFFER_TO_COMPOSITION[template.offerId]) return OFFER_TO_COMPOSITION[template.offerId];
  if (template.goal && GOAL_TO_COMPOSITION[template.goal]) return GOAL_TO_COMPOSITION[template.goal];
  // Deterministic spread so distinct mined templates get distinct structures.
  return COMPOSITION_IDS[hashString(key || template.id || "x") % COMPOSITION_IDS.length];
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

export function sampleCopyForTemplate(
  template: Pick<AdStudioTemplate, "id" | "templateKey" | "name" | "promptHint" | "goal" | "offerId" | "sampleCopy">,
  brandName: string,
): CompositionCopy {
  const key = (template.templateKey ?? template.id ?? "").toLowerCase();
  const mined = template.sampleCopy;
  const name = (template.name || "Template").trim();
  const hint = (template.promptHint || name).trim();
  const eyebrow = name;
  const headline = mined?.headline ? clip(mined.headline, 60) : clip(hint, 60);
  const subhead = mined?.description ?? "Written for your suburb - a clear next step for local owners.";
  const cta = mined?.cta ?? "Learn more";
  return {
    brand: brandName,
    eyebrow,
    headline,
    subhead,
    cta,
    stat: "+12.4%",
    statLabel: "median price growth, last 12 months",
    features: ["Declutter & depersonalise", "Fix the small stuff buyers notice", "Get a pre-list price guide", "Style the entrance & street view"],
  };
}
