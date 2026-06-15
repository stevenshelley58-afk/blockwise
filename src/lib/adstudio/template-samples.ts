import { CURATED_TEMPLATE_SAMPLE_STYLES, type CuratedSamplePersona } from "./template-sample-styles.generated.ts";

export const TEMPLATE_CARD_BUCKET = "template-cards";
export const TEMPLATE_SAMPLE_CARD_PREFIX = "adstudio-samples/v1";

export type TemplateSamplePropertyAge =
  | "older_affordable"
  | "new_build"
  | "renovated_character"
  | "apartment_townhouse"
  | "luxury_architectural"
  | "development_render";

export type TemplateSamplePriceFeel =
  | "affordable_entry"
  | "mid_market_family"
  | "premium_coastal"
  | "luxury_architectural"
  | "investor_rental"
  | "cheap_and_cheerful";

export type TemplateSampleVisualStyle =
  | "organic_agent_post"
  | "super_premium_polished"
  | "property_photo_first"
  | "data_card"
  | "guide_or_report_mockup"
  | "polished_meta_ad";

export type TemplateSamplePeople =
  | "none"
  | "agent_portrait"
  | "agent_in_scene"
  | "owner_lifestyle"
  | "buyer_activity";

export type TemplateSampleCopyDensity =
  | "minimal_no_overlay"
  | "small_badge"
  | "headline_overlay"
  | "stat_heavy"
  | "full_sales_poster";

export type TemplateSampleTone =
  | "practical_local"
  | "simple_super_premium"
  | "urgent_listing"
  | "over_the_top_direct_response"
  | "soft_organic"
  | "quiet_editorial";

export type AdStudioTemplateSampleStyle = {
  version: "template-samples-v1";
  propertyAge: TemplateSamplePropertyAge;
  priceFeel: TemplateSamplePriceFeel;
  visualStyle: TemplateSampleVisualStyle;
  people: TemplateSamplePeople;
  copyDensity: TemplateSampleCopyDensity;
  tone: TemplateSampleTone;
  sampleSuburb: string;
  sampleState: "WA";
  agencyName: string;
  agentName: string;
  address: string;
  propertyDetail: string;
  resultDetail: string;
  sampleCardImagePath: string;
  persona?: CuratedSamplePersona;
};

export type AdStudioTemplateSampleCopy = {
  headline: string;
  primaryText: string;
  description: string;
  cta: string;
};

export type TemplateSampleSource = {
  template_key?: string | null;
  templateKey?: string | null;
  id?: string | null;
  category?: string | null;
  image_brief_id?: string | null;
  imageBriefId?: string | null;
  offer_id?: string | null;
  offerId?: string | null;
  goal?: string | null;
  headline?: string | null;
  primary_text?: string | null;
  primaryText?: string | null;
  description?: string | null;
  cta?: string | null;
};

const PROPERTY_AGE_ROTATION: TemplateSamplePropertyAge[] = [
  "older_affordable",
  "new_build",
  "renovated_character",
  "apartment_townhouse",
  "luxury_architectural",
  "development_render",
];

const PRICE_FEEL_ROTATION: TemplateSamplePriceFeel[] = [
  "affordable_entry",
  "mid_market_family",
  "premium_coastal",
  "luxury_architectural",
  "investor_rental",
  "cheap_and_cheerful",
];

const VISUAL_STYLE_ROTATION: TemplateSampleVisualStyle[] = [
  "organic_agent_post",
  "super_premium_polished",
  "property_photo_first",
  "data_card",
  "guide_or_report_mockup",
  "polished_meta_ad",
];

const PEOPLE_ROTATION: TemplateSamplePeople[] = [
  "none",
  "agent_portrait",
  "none",
  "agent_in_scene",
  "owner_lifestyle",
  "buyer_activity",
];

const COPY_DENSITY_ROTATION: TemplateSampleCopyDensity[] = [
  "minimal_no_overlay",
  "small_badge",
  "headline_overlay",
  "stat_heavy",
  "full_sales_poster",
];

const TONE_ROTATION: TemplateSampleTone[] = [
  "practical_local",
  "simple_super_premium",
  "urgent_listing",
  "over_the_top_direct_response",
  "soft_organic",
  "quiet_editorial",
];

const SUBURBS = ["Scarborough", "Bicton", "Maylands", "Cottesloe", "Victoria Park", "Fremantle"];
const AGENCIES = ["Coastal & Co Realty", "Harbour Lane Property", "Maison West", "Northbank Realty", "Civic Estate Agents", "Jarrah Property"];
const AGENTS = ["Sarah Chen", "Elliot Marsh", "Mia Hart", "Daniel Price", "Priya Nair", "Tom Walker"];
const ADDRESSES = ["18 Tallow Lane", "42 Beach Street", "7 Station Road", "3 Jacaranda Avenue", "29 View Terrace", "11 Market Lane"];
const PROPERTY_DETAILS = [
  "3 bed character home",
  "brand-new townhouse",
  "renovated family home",
  "low-maintenance apartment",
  "architect-designed coastal home",
  "boutique off-the-plan release",
];
const RESULT_DETAILS = [
  "local price guide",
  "fresh campaign launch",
  "recent nearby sales",
  "Saturday 10:30am",
  "sold in 18 days",
  "Q2 market snapshot",
];

const VARIABLE_VALUES = {
  bedrooms: "3",
  beds: "3",
  baths: "2",
  cars: "2",
  land: "512 m2",
  time: "10:30am",
  day: "Saturday",
  date: "Sat 21 June",
  period: "Q2 2026",
  metric: "median days on market",
  median_value: "$892k",
  active_buyers: "42",
  bidders: "5",
  growth: "6.4%",
  growth_12m: "6.4%",
  growth_5y: "31%",
  rent_before: "$620/wk",
  rent_after: "$1,520/wk",
  project_name: "The Grove",
  project_or_address: "The Grove",
  deposit_pct: "5%",
  price: "$690k",
  landmark: "the river",
  property_desc: "renovated family home",
  sale_result: "sold in 18 days",
  buyer_type: "family buyers",
  property_type: "house",
  quote: "They made the whole sale feel calm and clear",
  client_name: "Alex",
  suburb_list: "Scarborough, Trigg and Wembley Downs",
  launch_timing: "next week",
  local_area: "your street",
  timeline: "next 90 days",
};

export function sampleCardImagePath(templateKey: string): string {
  const slug = slugifyTemplateKey(templateKey);
  return `${TEMPLATE_SAMPLE_CARD_PREFIX}/${slug}.png`;
}

export function isSafeTemplateCardImagePath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const path = value.trim();
  if (!path || path.includes("..") || path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/iu.test(path)) return false;
  return /^[-a-z0-9_/]+\.png$/iu.test(path);
}

export function templateCardPublicUrl(pathValue: unknown): string | undefined {
  if (!isSafeTemplateCardImagePath(pathValue)) return undefined;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/u, "");
  if (!base) return undefined;
  return `${base}/storage/v1/object/public/${TEMPLATE_CARD_BUCKET}/${pathValue
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

export function deriveTemplateSampleStyle(
  template: TemplateSampleSource,
  index = stableIndex(templateKeyForSample(template)),
): AdStudioTemplateSampleStyle {
  const key = templateKeyForSample(template);
  const category = stringValue(template.category).toLowerCase();
  const imageBriefId = stringValue(template.image_brief_id ?? template.imageBriefId).toUpperCase();
  const baseIndex = Number.isFinite(index) ? Math.abs(Math.trunc(index)) : stableIndex(key);

  let propertyAge = pick(PROPERTY_AGE_ROTATION, baseIndex);
  let priceFeel = pick(PRICE_FEEL_ROTATION, baseIndex + 1);
  let visualStyle = pick(VISUAL_STYLE_ROTATION, baseIndex + 2);
  let people = pick(PEOPLE_ROTATION, baseIndex + 3);
  let copyDensity = pick(COPY_DENSITY_ROTATION, baseIndex + 4);
  let tone = pick(TONE_ROTATION, baseIndex + 5);

  if (/DEV|DEVELOP|OFF-THE-PLAN|DOWNSIZER/u.test(`${imageBriefId} ${category}`)) {
    propertyAge = "development_render";
    priceFeel = /DOWNSIZER/u.test(imageBriefId) ? "premium_coastal" : "luxury_architectural";
    visualStyle = "super_premium_polished";
  } else if (/AGENT|BRAND/u.test(`${imageBriefId} ${category}`)) {
    people = baseIndex % 2 === 0 ? "agent_portrait" : "agent_in_scene";
    visualStyle = baseIndex % 3 === 0 ? "organic_agent_post" : visualStyle;
  } else if (/STAT|MARKET|BUYER|INVESTOR/u.test(`${imageBriefId} ${category}`)) {
    copyDensity = baseIndex % 2 === 0 ? "stat_heavy" : copyDensity;
    visualStyle = baseIndex % 3 === 0 ? "data_card" : visualStyle;
  } else if (/GUIDE|REPORT|TESTIMONIAL/u.test(`${imageBriefId} ${category}`)) {
    visualStyle = /TESTIMONIAL/u.test(imageBriefId) ? "organic_agent_post" : "guide_or_report_mockup";
  }

  if (/JUST LISTED|OPEN HOME|AUCTION/u.test(category.toUpperCase())) {
    tone = "urgent_listing";
  }
  if (/HOME VALUE|APPRAISAL/u.test(category.toUpperCase()) && baseIndex % 4 === 0) {
    tone = "over_the_top_direct_response";
    copyDensity = "full_sales_poster";
  }
  if (baseIndex % 5 === 0) {
    people = "none";
    visualStyle = "property_photo_first";
    copyDensity = "minimal_no_overlay";
  }

  const curated = CURATED_TEMPLATE_SAMPLE_STYLES[key];
  if (curated) {
    propertyAge = curated.propertyAge as TemplateSamplePropertyAge;
    priceFeel = curated.priceFeel as TemplateSamplePriceFeel;
    visualStyle = curated.visualStyle as TemplateSampleVisualStyle;
    people = curated.people as TemplateSamplePeople;
    copyDensity = curated.copyDensity as TemplateSampleCopyDensity;
    tone = curated.tone as TemplateSampleTone;
  }

  return {
    version: "template-samples-v1",
    propertyAge,
    priceFeel,
    visualStyle,
    people,
    copyDensity,
    tone,
    sampleSuburb: curated?.sampleSuburb ?? pick(SUBURBS, baseIndex),
    sampleState: "WA",
    agencyName: curated?.agencyName ?? pick(AGENCIES, baseIndex + 1),
    agentName: curated?.agentName ?? pick(AGENTS, baseIndex + 2),
    address: curated?.address ?? pick(ADDRESSES, baseIndex + 3),
    propertyDetail: pick(PROPERTY_DETAILS, baseIndex + 4),
    resultDetail: pick(RESULT_DETAILS, baseIndex + 5),
    sampleCardImagePath: sampleCardImagePath(key),
    persona: curated?.persona,
  };
}

export function sampleCopyForTemplate(
  template: TemplateSampleSource,
  style = deriveTemplateSampleStyle(template),
): AdStudioTemplateSampleCopy | undefined {
  const headline = substituteSampleVariables(template.headline, style);
  const primaryText = substituteSampleVariables(template.primary_text ?? template.primaryText, style);
  const description = substituteSampleVariables(template.description, style);
  const cta = substituteSampleVariables(template.cta, style);

  if (!headline && !primaryText && !description && !cta) return undefined;
  return {
    headline: headline || "Sample real estate ad",
    primaryText: primaryText || "A local, housing-safe sample ad written for this template.",
    description: description || "Sample campaign preview",
    cta: cta || "Learn more",
  };
}

export function substituteSampleVariables(value: unknown, style: AdStudioTemplateSampleStyle): string {
  if (typeof value !== "string") return "";
  const persona = style.persona;
  const stats = persona?.stats;
  const replacements: Record<string, string> = {
    ...VARIABLE_VALUES,
    suburb: persona?.suburb ?? style.sampleSuburb,
    state: persona?.state ?? style.sampleState,
    business_name: persona?.agency ?? style.agencyName,
    agent_name: persona?.agent ?? style.agentName,
    address: persona?.address ?? style.address,
    property_type: style.propertyDetail,
    suburb_list: persona?.regionList ?? VARIABLE_VALUES.suburb_list,
    local_area: persona?.suburb ?? VARIABLE_VALUES.local_area,
    project_name: persona?.project ?? VARIABLE_VALUES.project_name,
    project_or_address: persona?.project ?? VARIABLE_VALUES.project_or_address,
    median_value: stats?.median ?? VARIABLE_VALUES.median_value,
    active_buyers: stats?.buyers ?? VARIABLE_VALUES.active_buyers,
    growth: stats?.growth_12m ?? VARIABLE_VALUES.growth,
    growth_12m: stats?.growth_12m ?? VARIABLE_VALUES.growth_12m,
    growth_5y: stats?.growth_5y ?? VARIABLE_VALUES.growth_5y,
    rent_before: stats?.rent_before ?? VARIABLE_VALUES.rent_before,
    rent_after: stats?.rent_after ?? VARIABLE_VALUES.rent_after,
  };

  return value
    .replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/giu, (_match, rawKey: string) => replacements[rawKey.toLowerCase()] ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function sampleVarianceSummary(templates: TemplateSampleSource[]): Record<string, number> {
  const styles = templates.map((template, index) => deriveTemplateSampleStyle(template, index));
  return {
    total: styles.length,
    noPerson: styles.filter((style) => style.people === "none").length,
    agentLed: styles.filter((style) => style.people === "agent_portrait" || style.people === "agent_in_scene").length,
    propertyOnly: styles.filter((style) => style.people === "none" && style.visualStyle === "property_photo_first").length,
    minimalCopy: styles.filter((style) => style.copyDensity === "minimal_no_overlay").length,
    textHeavy: styles.filter((style) => style.copyDensity === "stat_heavy" || style.copyDensity === "full_sales_poster").length,
    organic: styles.filter((style) => style.visualStyle === "organic_agent_post").length,
    superPremium: styles.filter((style) => style.visualStyle === "super_premium_polished").length,
    olderAffordable: styles.filter((style) => style.propertyAge === "older_affordable" || style.priceFeel === "affordable_entry" || style.priceFeel === "cheap_and_cheerful").length,
    newLuxury: styles.filter((style) => style.propertyAge === "new_build" || style.propertyAge === "luxury_architectural" || style.propertyAge === "development_render").length,
  };
}

export function sampleVarianceErrors(templates: TemplateSampleSource[]): string[] {
  const summary = sampleVarianceSummary(templates);
  const total = summary.total || 1;
  const min20 = Math.ceil(total * 0.2);
  const min15 = Math.ceil(total * 0.15);
  const checks: Array<[keyof typeof summary, number, string]> = [
    ["noPerson", min20, "no-person samples"],
    ["agentLed", min20, "agent-led samples"],
    ["propertyOnly", min20, "property-only samples"],
    ["minimalCopy", min20, "minimal/no-overlay text samples"],
    ["textHeavy", min20, "text-heavy/stat-heavy samples"],
    ["organic", min15, "organic-looking samples"],
    ["superPremium", min15, "super-premium samples"],
    ["olderAffordable", min15, "older/affordable samples"],
    ["newLuxury", min15, "new/luxury samples"],
  ];

  return checks.flatMap(([key, minimum, label]) => {
    const actual = summary[key];
    return actual >= minimum ? [] : [`Expected at least ${minimum} ${label}, found ${actual}.`];
  });
}

function templateKeyForSample(template: TemplateSampleSource): string {
  return stringValue(template.template_key ?? template.templateKey ?? template.id) || "sample-template";
}

function pick<T>(values: T[], index: number): T {
  return values[Math.abs(index) % values.length] as T;
}

function stableIndex(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function slugifyTemplateKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "") || "sample-template";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
