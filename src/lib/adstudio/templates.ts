import type { AdStudioGoal } from "./types.ts";
import { creativeSkeletonSchema, type CreativeSkeleton } from "../ad-template-library/skeleton.ts";
import {
  deriveTemplateSampleStyle,
  sampleCopyForTemplate,
  templateCardPublicUrl,
  type AdStudioTemplateSampleCopy,
  type AdStudioTemplateSampleStyle,
} from "./template-samples.ts";

export type AdStudioTemplate = {
  id: string;
  templateKey?: string;
  name: string;
  goal: AdStudioGoal;
  offerId: string;
  promptHint: string;
  source?: "builtin" | "operator" | "radar";
  status?: "approved" | "archived" | "draft";
  creativeSkeleton?: CreativeSkeleton;
  exemplars?: string[];
  imageBriefId?: string;
  sampleCopy?: AdStudioTemplateSampleCopy;
  sampleStyle?: AdStudioTemplateSampleStyle;
  sampleCardImageUrl?: string;
  evidenceScore?: number;
  winnerRationale?: string;
  complianceNote?: string;
  manualFirstPass?: boolean;
};

export type AdStudioLibraryTemplate = {
  template_key?: string | null;
  status?: string | null;
  category?: string | null;
  hook_style?: string | null;
  funnel_stage?: string | null;
  adstudio_template_id?: string | null;
  offer_id?: string | null;
  goal?: string | null;
  headline?: string | null;
  primary_text?: string | null;
  description?: string | null;
  cta?: string | null;
  image_brief_id?: string | null;
  sample_card_image_path?: string | null;
  sample_style?: unknown;
  ai_prompt_seed?: string | null;
  creative_skeleton?: unknown;
  exemplar_observed_ad_ids?: string[] | null;
  evidence_score?: number | string | null;
  winner_rationale?: string | null;
  compliance_note?: string | null;
};

export type AdStudioTemplateVersion = {
  templateId: string;
  vertical: "real_estate";
  goal: AdStudioGoal;
  offerType: string;
  active: boolean;
};

function firstPassSkeleton(input: {
  archetype: CreativeSkeleton["archetype"];
  shotType: string;
  focalPoint: string;
  horizon: CreativeSkeleton["composition"]["horizon"];
  zones: CreativeSkeleton["composition"]["copy_safe_zones"];
  palette: string[];
  badge: string;
  headlinePattern: string;
  cta: string;
  variables: string[];
}): CreativeSkeleton {
  return {
    version: 1,
    archetype: input.archetype,
    shot: {
      type: input.shotType,
      lighting: "natural Australian real-estate light with clean, realistic colour",
      mood: "premium, practical, local and trustworthy",
    },
    composition: {
      focal_point: input.focalPoint,
      horizon: input.horizon,
      copy_safe_zones: input.zones,
    },
    color: {
      palette: input.palette,
      overlay: "brand-colour overlay or dark scrim only where copy needs contrast",
      contrast: "high",
    },
    text_system: {
      headline_zone: "large headline in the primary copy-safe zone with clear whitespace around every line",
      badge: input.badge,
      cta_style: "solid brand CTA button aligned to the copy block",
    },
    copy: {
      hook_style: input.badge,
      headline_pattern: input.headlinePattern,
      cta: input.cta,
    },
    variables: input.variables,
    confidence: 58,
  };
}

const FIRST_PASS_TEMPLATE_SKELETONS: Record<string, CreativeSkeleton> = {
  just_listed: firstPassSkeleton({
    archetype: "listing_hero",
    shotType: "front exterior or hero listing image",
    focalPoint: "property facade in the upper or centre-right frame",
    horizon: "middle",
    zones: [
      { id: "headline_panel", x: 0.06, y: 0.58, width: 0.62, height: 0.25, priority: "primary" },
      { id: "cta_band", x: 0.06, y: 0.84, width: 0.44, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "warm neutral", "white"],
    badge: "Just Listed badge above headline",
    headlinePattern: "Just listed in {suburb}",
    cta: "See the home",
    variables: ["suburb", "property_type", "bedrooms", "street"],
  }),
  coming_soon: firstPassSkeleton({
    archetype: "coming_soon",
    shotType: "teaser crop of property detail, frontage, or lifestyle feature",
    focalPoint: "property detail in the lower-right or centre frame",
    horizon: "none",
    zones: [
      { id: "announcement_band", x: 0.08, y: 0.26, width: 0.72, height: 0.24, priority: "primary" },
      { id: "cta_band", x: 0.08, y: 0.54, width: 0.42, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "muted charcoal", "accent"],
    badge: "Coming Soon announcement band",
    headlinePattern: "Coming soon to {suburb}",
    cta: "Get first look",
    variables: ["suburb", "launch_timing", "property_type"],
  }),
  new_to_market: firstPassSkeleton({
    archetype: "listing_hero",
    shotType: "fresh listing hero image with strong street or interior feature",
    focalPoint: "home feature on the right half of frame",
    horizon: "middle",
    zones: [
      { id: "headline_panel", x: 0.07, y: 0.55, width: 0.6, height: 0.26, priority: "primary" },
      { id: "cta_band", x: 0.07, y: 0.83, width: 0.46, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "white", "fresh green"],
    badge: "New To Market label",
    headlinePattern: "New to market in {suburb}",
    cta: "See recent sales",
    variables: ["suburb", "local_area", "property_type"],
  }),
  open_home: firstPassSkeleton({
    archetype: "open_home",
    shotType: "inviting exterior, entry, kitchen, or living image",
    focalPoint: "main room or facade kept clear of the details panel",
    horizon: "middle",
    zones: [
      { id: "details_panel", x: 0.08, y: 0.42, width: 0.64, height: 0.3, priority: "primary" },
      { id: "cta_band", x: 0.08, y: 0.74, width: 0.42, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "white", "accent"],
    badge: "Open Home date/time badge",
    headlinePattern: "Open home {day} in {suburb}",
    cta: "Plan your visit",
    variables: ["suburb", "day", "time", "address"],
  }),
  just_sold: firstPassSkeleton({
    archetype: "just_sold",
    shotType: "sold property exterior or hero image",
    focalPoint: "property result visual away from the sold ribbon",
    horizon: "middle",
    zones: [
      { id: "sold_ribbon", x: 0.07, y: 0.18, width: 0.42, height: 0.09, priority: "secondary" },
      { id: "headline_panel", x: 0.07, y: 0.58, width: 0.64, height: 0.24, priority: "primary" },
      { id: "cta_band", x: 0.07, y: 0.84, width: 0.46, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "deep charcoal", "white"],
    badge: "Just Sold ribbon",
    headlinePattern: "Just sold in {suburb}",
    cta: "Get local context",
    variables: ["suburb", "sale_result", "property_type"],
  }),
  price_update: firstPassSkeleton({
    archetype: "appraisal",
    shotType: "clean owner-focused home image or calm property detail",
    focalPoint: "home detail on the left or centre with copy on the right",
    horizon: "middle",
    zones: [
      { id: "value_panel", x: 0.45, y: 0.42, width: 0.48, height: 0.3, priority: "primary" },
      { id: "cta_band", x: 0.45, y: 0.75, width: 0.38, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "soft neutral", "white"],
    badge: "Price Update value panel",
    headlinePattern: "What could your {suburb} home be worth?",
    cta: "Get a price update",
    variables: ["suburb", "property_type"],
  }),
  market_update: firstPassSkeleton({
    archetype: "market_stat",
    shotType: "suburb lifestyle, streetscape, or map-like local context image",
    focalPoint: "local area visual on the left, stats panel on the right",
    horizon: "high",
    zones: [
      { id: "market_panel", x: 0.48, y: 0.28, width: 0.44, height: 0.38, priority: "primary" },
      { id: "cta_band", x: 0.48, y: 0.7, width: 0.36, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "white", "data accent"],
    badge: "Market Update stat panel",
    headlinePattern: "{suburb} market update",
    cta: "Get the report",
    variables: ["suburb", "period", "metric"],
  }),
  free_appraisal: firstPassSkeleton({
    archetype: "appraisal",
    shotType: "approachable agent, home exterior, or owner-friendly property image",
    focalPoint: "agent or property image away from the right-side value panel",
    horizon: "middle",
    zones: [
      { id: "appraisal_panel", x: 0.47, y: 0.4, width: 0.45, height: 0.32, priority: "primary" },
      { id: "cta_band", x: 0.47, y: 0.75, width: 0.38, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "white", "accent"],
    badge: "Free Appraisal offer panel",
    headlinePattern: "Free appraisal for {suburb} owners",
    cta: "Book free appraisal",
    variables: ["suburb", "property_type"],
  }),
  buyer_demand: firstPassSkeleton({
    archetype: "social_proof",
    shotType: "buyer activity, open-home queue, or attractive local property image",
    focalPoint: "people or property activity visible outside the proof panel",
    horizon: "middle",
    zones: [
      { id: "proof_panel", x: 0.07, y: 0.5, width: 0.64, height: 0.28, priority: "primary" },
      { id: "cta_band", x: 0.07, y: 0.8, width: 0.42, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "white", "signal accent"],
    badge: "Buyer Demand proof badge",
    headlinePattern: "Buyer demand in {suburb}",
    cta: "Check buyer demand",
    variables: ["suburb", "buyer_type", "property_type"],
  }),
  seller_checklist: firstPassSkeleton({
    archetype: "seller_guide",
    shotType: "seller prep image, styled room, checklist, or ready-to-list home",
    focalPoint: "clean property or preparation visual above or beside the guide panel",
    horizon: "none",
    zones: [
      { id: "guide_panel", x: 0.08, y: 0.44, width: 0.66, height: 0.32, priority: "primary" },
      { id: "cta_band", x: 0.08, y: 0.79, width: 0.46, height: 0.08, priority: "cta" },
    ],
    palette: ["brand primary", "paper white", "accent"],
    badge: "Seller Checklist guide panel",
    headlinePattern: "Seller checklist for {suburb} owners",
    cta: "Download checklist",
    variables: ["suburb", "property_type", "timeline"],
  }),
};

function firstPassMetadata(templateKey: string, creativeSkeleton: CreativeSkeleton) {
  return {
    templateKey,
    source: "operator" as const,
    status: "approved" as const,
    creativeSkeleton,
    evidenceScore: creativeSkeleton.confidence,
    winnerRationale: "First-pass/manual operator-approved template skeleton for launch coverage; replace with mined winner-backed version when available.",
    complianceNote: "Housing-safe first-pass copy frame; avoids guaranteed price, buyer, or sale outcome claims.",
    manualFirstPass: true,
  };
}

export const AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  {
    id: "just_listed",
    ...firstPassMetadata("just_listed", FIRST_PASS_TEMPLATE_SKELETONS.just_listed),
    name: "Just listed",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Promote a newly listed property and invite local owners to compare their own home.",
  },
  {
    id: "coming_soon",
    ...firstPassMetadata("coming_soon", FIRST_PASS_TEMPLATE_SKELETONS.coming_soon),
    name: "Coming soon",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Tease an upcoming listing and create local interest before launch.",
  },
  {
    id: "new_to_market",
    ...firstPassMetadata("new_to_market", FIRST_PASS_TEMPLATE_SKELETONS.new_to_market),
    name: "New to market",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    promptHint: "Announce fresh local activity and prompt owners to check recent sales context.",
  },
  {
    id: "open_home",
    ...firstPassMetadata("open_home", FIRST_PASS_TEMPLATE_SKELETONS.open_home),
    name: "Open home",
    goal: "open_home_followup",
    offerId: "open_home_followup",
    promptHint: "Promote inspection interest with date, time, property details, and a simple enquiry path.",
  },
  {
    id: "just_sold",
    ...firstPassMetadata("just_sold", FIRST_PASS_TEMPLATE_SKELETONS.just_sold),
    name: "Just sold",
    goal: "seller_leads",
    offerId: "recent_sales_report",
    promptHint: "Use a recent sale as local proof and invite nearby owners to understand their position.",
  },
  {
    id: "price_update",
    ...firstPassMetadata("price_update", FIRST_PASS_TEMPLATE_SKELETONS.price_update),
    name: "Price update",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    promptHint: "Offer a practical home value update without making performance guarantees.",
  },
  {
    id: "market_update",
    ...firstPassMetadata("market_update", FIRST_PASS_TEMPLATE_SKELETONS.market_update),
    name: "Market update",
    goal: "market_update_leads",
    offerId: "suburb_market_report",
    promptHint: "Share useful suburb market context for homeowners considering their next move.",
  },
  {
    id: "free_appraisal",
    ...firstPassMetadata("free_appraisal", FIRST_PASS_TEMPLATE_SKELETONS.free_appraisal),
    name: "Free appraisal",
    goal: "appraisal_bookings",
    offerId: "home_value_update",
    promptHint: "Invite owners to request a no-pressure local price update.",
  },
  {
    id: "buyer_demand",
    ...firstPassMetadata("buyer_demand", FIRST_PASS_TEMPLATE_SKELETONS.buyer_demand),
    name: "Buyer demand",
    goal: "seller_leads",
    offerId: "home_value_update",
    promptHint: "Explain local buyer demand carefully without over-claiming results.",
  },
  {
    id: "seller_checklist",
    ...firstPassMetadata("seller_checklist", FIRST_PASS_TEMPLATE_SKELETONS.seller_checklist),
    name: "Seller checklist",
    goal: "seller_leads",
    offerId: "seller_prep_checklist",
    promptHint: "Offer a practical preparation checklist for owners thinking about selling.",
  },
];

export function resolveAdStudioTemplate(templateId: string | undefined): AdStudioTemplate {
  return AD_STUDIO_TEMPLATES.find((template) => template.id === templateId) ?? AD_STUDIO_TEMPLATES[0];
}

export function isBuiltInAdStudioTemplate(templateId: string | undefined): boolean {
  return AD_STUDIO_TEMPLATES.some((template) => template.id === templateId);
}

export function builtInAdStudioTemplates(): AdStudioTemplate[] {
  return AD_STUDIO_TEMPLATES.map((template) => ({
    ...template,
    templateKey: template.templateKey ?? template.id,
    source: template.source ?? "builtin",
    status: template.status ?? "approved",
  }));
}

export function mapAdStudioLibraryTemplate(row: AdStudioLibraryTemplate): AdStudioTemplate | null {
  if (row.status && row.status !== "approved") return null;

  const templateKey = stringValue(row.template_key);
  if (!templateKey) return null;

  const builtIn = AD_STUDIO_TEMPLATES.find((template) => template.id === stringValue(row.adstudio_template_id));
  const goal = stringValue(row.goal) || builtIn?.goal;
  const offerId = stringValue(row.offer_id) || builtIn?.offerId;
  if (!goal || !offerId) return null;

  const promptHint = safeLibraryPromptHint({
    builtIn,
    goal,
    offerId,
  });

  const creativeSkeleton = parseCreativeSkeleton(row.creative_skeleton);
  const sampleStyle = parseSampleStyle(row.sample_style) ?? deriveTemplateSampleStyle({ ...row, template_key: templateKey });
  const sampleCopy = sampleCopyForTemplate({ ...row, template_key: templateKey }, sampleStyle);
  const sampleCardImageUrl =
    templateCardPublicUrl(row.sample_card_image_path) ??
    (row.sample_card_image_path ? undefined : templateCardPublicUrl(sampleStyle.sampleCardImagePath));
  const exemplars = Array.isArray(row.exemplar_observed_ad_ids)
    ? row.exemplar_observed_ad_ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const manualFirstPass = /first-pass|manual|first pass/i.test(row.winner_rationale ?? "");

  return {
    id: templateKey,
    templateKey,
    name: safeLibraryTemplateName({ builtIn, goal, offerId }),
    goal: goal as AdStudioGoal,
    offerId,
    promptHint,
    source: manualFirstPass ? "operator" : "radar",
    status: "approved",
    ...(row.image_brief_id ? { imageBriefId: row.image_brief_id } : {}),
    ...(sampleCopy ? { sampleCopy } : {}),
    sampleStyle,
    ...(sampleCardImageUrl ? { sampleCardImageUrl } : {}),
    ...(numberValue(row.evidence_score) !== undefined ? { evidenceScore: numberValue(row.evidence_score) } : {}),
    ...(row.winner_rationale ? { winnerRationale: row.winner_rationale } : {}),
    ...(row.compliance_note ? { complianceNote: row.compliance_note } : {}),
    ...(manualFirstPass ? { manualFirstPass: true } : {}),
    ...(creativeSkeleton ? { creativeSkeleton } : {}),
    ...(exemplars.length > 0 ? { exemplars } : {}),
  };
}

export function mergeAdStudioTemplateLibrary(approved: AdStudioTemplate[]): AdStudioTemplate[] {
  if (approved.length === 0) return builtInAdStudioTemplates();
  const byId = new Map<string, AdStudioTemplate>();
  for (const template of approved) byId.set(template.id, template);
  for (const template of builtInAdStudioTemplates()) {
    if (!byId.has(template.id)) byId.set(template.id, template);
  }
  return [...byId.values()].sort(compareTemplateVisibility);
}

export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = AD_STUDIO_TEMPLATES.map((template) => ({
  templateId: template.id,
  vertical: "real_estate",
  goal: template.goal,
  offerType: template.offerId,
  active: true,
}));

function safeLibraryPromptHint(input: {
  builtIn?: AdStudioTemplate;
  goal: string;
  offerId: string;
}): string {
  if (input.builtIn?.promptHint) return input.builtIn.promptHint;

  const label = safeLibraryTemplateName(input);
  const goal = toTitleCase(input.goal.replace(/[-_]+/gu, " "));
  const offer = toTitleCase(input.offerId.replace(/[-_]+/gu, " "));
  return `${label} template for ${goal}: use customer media, local market context, compliant copy, and a direct call to action for ${offer}.`;
}

function safeLibraryTemplateName(input: { builtIn?: AdStudioTemplate; goal: string; offerId: string }): string {
  if (input.builtIn?.name) return input.builtIn.name;
  switch (input.offerId) {
    case "listing_inquiries":
      return "Listing campaign";
    case "home_value_update":
      return "Free appraisal";
    case "buyer_list":
      return "Buyer inquiry";
    case "market_report":
      return "Market update";
    case "download_guide":
      return "Seller guide";
    default:
      break;
  }
  switch (input.goal) {
    case "market_update_leads":
      return "Market update";
    case "appraisal_bookings":
      return "Free appraisal";
    case "open_home_followup":
      return "Open home follow-up";
    case "listing_nurture":
      return "Sold nurture";
    case "downsizer_leads":
      return "Downsizer inquiry";
    case "investor_leads":
      return "Investor inquiry";
    default:
      return "Ad template";
  }
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseCreativeSkeleton(value: unknown): CreativeSkeleton | undefined {
  const parsed = creativeSkeletonSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseSampleStyle(value: unknown): AdStudioTemplateSampleStyle | undefined {
  if (!isRecord(value)) return undefined;
  if (value.version !== "template-samples-v1") return undefined;
  if (typeof value.sampleCardImagePath !== "string") return undefined;
  return value as AdStudioTemplateSampleStyle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareTemplateVisibility(a: AdStudioTemplate, b: AdStudioTemplate): number {
  const priority = (template: AdStudioTemplate) => {
    if (template.creativeSkeleton) return 0;
    if (template.source === "radar") return 1;
    return 2;
  };

  const priorityDiff = priority(a) - priority(b);
  if (priorityDiff !== 0) return priorityDiff;

  const evidenceDiff = (b.evidenceScore ?? -1) - (a.evidenceScore ?? -1);
  if (evidenceDiff !== 0) return evidenceDiff;

  return a.name.localeCompare(b.name);
}
