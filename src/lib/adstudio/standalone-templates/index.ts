// Registry for standalone, per-template renderers. Each entry is its own
// self-contained mini-project that emits its own bespoke SVG (no shared engine).
import type { AdStudioBrandKit, AdStudioCreative, AdStudioFormat } from "../types.ts";
import type { AdStudioTemplate } from "../templates.ts";
import {
  modernHouseForSaleTemplate,
  renderModernHouseForSaleCreative,
} from "./modern-house-for-sale.ts";

export type StandaloneRenderContext = {
  format: AdStudioFormat;
  brandKit: AdStudioBrandKit;
  headline: string;
  subheadline?: string;
  offer?: string;
  cta?: string;
  photoDataUrl?: string;
  stripPhotos?: string[];
  creativeId: string;
  campaignId: string;
  variantId: string;
};

export type StandaloneRenderer = (ctx: StandaloneRenderContext) => AdStudioCreative;

// Templates that resolve via their own render fn instead of renderDesign.
export const STANDALONE_AD_STUDIO_TEMPLATES: AdStudioTemplate[] = [
  modernHouseForSaleTemplate,
];

const STANDALONE_RENDERERS: Record<string, StandaloneRenderer> = {
  [modernHouseForSaleTemplate.id]: renderModernHouseForSaleCreative,
};

export function getStandaloneRenderer(
  template: { id?: string; templateKey?: string } | null | undefined,
): StandaloneRenderer | null {
  if (!template) return null;
  const byId = template.id ? STANDALONE_RENDERERS[template.id] : undefined;
  const byKey = template.templateKey ? STANDALONE_RENDERERS[template.templateKey] : undefined;
  return byId ?? byKey ?? null;
}
