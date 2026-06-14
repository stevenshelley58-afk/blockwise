import type { CuratedTemplateImage } from "./templates.ts";

export const TEMPLATE_CARDS_BUCKET = "template-cards";

export type TemplateImageBrief = {
  brief_id: string;
  name?: string | null;
  imagery?: string | null;
  ai_prompt_seed?: string | null;
};

// Fixed Blockwise art direction prepended to every mined image brief so the
// generated creatives share one brand language while the brief drives variety.
const BRAND_DIRECTION = [
  "Design a polished, professional 4:5 vertical real-estate social media ad creative for the Australian market.",
  "Brand style: deep navy (#16314f) base with a warm gold (#E7B24B) accent and clean white sans-serif type; modern, trustworthy, premium but local.",
  "Use realistic Australian residential photography wherever the brief implies a property or lifestyle photo.",
  "Compose it like a finished ad: clear focal headline area, balanced negative space and a small call-to-action chip.",
  "Keep any on-image words short and correctly spelled — never fill space with fake or scrambled text.",
].join(" ");

export function buildTemplateCardPrompt(brief: TemplateImageBrief): string {
  const recipe = [brief.name, brief.ai_prompt_seed, brief.imagery]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join("\n");
  const safeRecipe = neutraliseDemographics(recipe);
  return safeRecipe ? `${BRAND_DIRECTION}\n\nCreative recipe:\n${safeRecipe}` : BRAND_DIRECTION;
}

// Image models refuse prompts that imply generating people by a protected
// demographic (notably age). A few mined briefs carry such phrasing (e.g. the
// downsizer brief's "over-55s / mature-lifestyle"); neutralise it to lifestyle
// language so the creative renders — and so it stays aligned with housing ad
// rules, which forbid age-based targeting anyway.
export function neutraliseDemographics(text: string): string {
  return text
    .replace(/over[-\s]?55'?s?\b/giu, "downsizer")
    .replace(/\bmature[-\s]lifestyle\b/giu, "resort-style community lifestyle")
    .replace(/\b(?:seniors?|elderly|retirees?|over[-\s]?60s?)\b/giu, "downsizer");
}

export function templateCardObjectPath(briefId: string): string {
  return `${briefId}.png`;
}

export function templateCardPublicUrl(supabaseUrl: string, briefId: string): string {
  const base = supabaseUrl.replace(/\/+$/u, "");
  return `${base}/storage/v1/object/public/${TEMPLATE_CARDS_BUCKET}/${templateCardObjectPath(briefId)}`;
}

export function templateCardImageFromBrief(
  supabaseUrl: string,
  brief: { brief_id: string; name?: string | null },
): CuratedTemplateImage {
  return {
    src: templateCardPublicUrl(supabaseUrl, brief.brief_id),
    label: brief.name?.trim() || "Template creative",
    type: "Ad",
    ratio: "Feed",
  };
}
