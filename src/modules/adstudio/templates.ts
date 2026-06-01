import type { AdStudioFormat, AdStudioGoal } from "./types.ts";

export type AdStudioTemplateVersion = {
  templateId: string;
  vertical: "real_estate";
  goal: AdStudioGoal;
  offerType: string;
  formats: AdStudioFormat[];
  layoutStyle: "premium_editorial" | "clean_local" | "authority_report";
  requiredAssets: string[];
  optionalAssets: string[];
  objects: unknown[];
  safeZones: Record<string, unknown>;
  complianceConstraints: string[];
};

export const ADSTUDIO_TEMPLATE_VERSIONS: AdStudioTemplateVersion[] = [
  {
    templateId: "seller_checklist_premium_01",
    vertical: "real_estate",
    goal: "seller_leads",
    offerType: "seller_checklist",
    formats: ["1:1", "4:5", "9:16", "1.91:1"],
    layoutStyle: "premium_editorial",
    requiredAssets: ["logo", "headline", "cta"],
    optionalAssets: ["agent_headshot", "background_image"],
    objects: [],
    safeZones: {
      meta_story: true,
      google_demand_gen: true,
    },
    complianceConstraints: ["no_ai_rendered_text", "meta_housing_category"],
  },
  {
    templateId: "market_update_clean_01",
    vertical: "real_estate",
    goal: "market_update_leads",
    offerType: "suburb_report",
    formats: ["1:1", "4:5", "1.91:1"],
    layoutStyle: "clean_local",
    requiredAssets: ["logo", "headline", "market_stat"],
    optionalAssets: ["agent_headshot"],
    objects: [],
    safeZones: {
      google_demand_gen: true,
    },
    complianceConstraints: ["source_required_for_market_stat"],
  },
];
