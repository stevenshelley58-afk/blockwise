import { buildArchetypeCreative } from "./layout-archetypes.ts";
import type { AdStudioTemplate } from "./templates.ts";
import type { AdStudioBrandKit, AdStudioCampaign, AdStudioCampaignVariant, AdStudioFormat } from "./types.ts";

// Presentation copy shown on the gallery preview only. The real ad's copy is
// generated per customer/suburb at build time; this just illustrates the layout.
const PREVIEW_COPY: Record<string, { headline: string; cta: string }> = {
  just_listed: { headline: "Just listed in your suburb", cta: "See the home" },
  coming_soon: { headline: "Something special is coming soon", cta: "Get first look" },
  new_to_market: { headline: "Fresh activity on your street", cta: "See recent sales" },
  open_home: { headline: "Open this Saturday — save your spot", cta: "Plan your visit" },
  just_sold: { headline: "Sold — a strong local result", cta: "See what yours could get" },
  price_update: { headline: "What's your home worth now?", cta: "Get a price update" },
  market_update: { headline: "What sold near you this quarter", cta: "Get the report" },
  free_appraisal: { headline: "What's your home worth in 2026?", cta: "Book free appraisal" },
  buyer_demand: { headline: "Buyers are searching your suburb", cta: "Check buyer demand" },
  seller_checklist: { headline: "10 things to fix before you list", cta: "Download checklist" },
};

function previewCopy(template: AdStudioTemplate): { headline: string; cta: string } {
  return PREVIEW_COPY[template.id] ?? { headline: template.name, cta: "Learn more" };
}

function previewCampaign(template: AdStudioTemplate, brandKit: AdStudioBrandKit, format: AdStudioFormat): AdStudioCampaign {
  return {
    campaignId: `preview_${template.id}`,
    workspaceId: brandKit.workspaceId,
    brandKitId: brandKit.brandKitId,
    name: template.name,
    goal: template.goal,
    market: { country: "AU", state: brandKit.identity.marketRegion ?? "WA", city: "", suburb: "your suburb" },
    audienceIntent: "",
    offerId: template.offerId,
    platforms: ["meta"],
    creativeFormats: [format],
    status: "draft",
  };
}

function previewVariant(template: AdStudioTemplate): AdStudioCampaignVariant {
  const copy = previewCopy(template);
  return {
    variantId: `preview_${template.id}`,
    campaignId: `preview_${template.id}`,
    angle: template.name,
    headline: copy.headline,
    offer: template.name,
    cta: copy.cta,
    score: {
      score: 0,
      notes: [],
      warnings: [],
      dimensions: { offerClarity: 0, localRelevance: 0, leadIntentStrength: 0, brandFit: 0, complianceSafety: 0, visualHierarchy: 0 },
    },
    status: "draft",
    lockedFields: [],
  };
}

/**
 * A branded SVG preview of the template's actual layout — the customer's brand
 * colours/fonts/logo around a photo placeholder ("your listing photo here"),
 * with sample copy. This is what their ad will look like once they add a photo,
 * so the gallery shows a real range of layouts, personalised per customer.
 */
export function templatePreviewSvg(template: AdStudioTemplate, brandKit: AdStudioBrandKit, format: AdStudioFormat = "4:5"): string {
  const creative = buildArchetypeCreative({
    campaign: previewCampaign(template, brandKit, format),
    variant: previewVariant(template),
    brandKit,
    format,
    // No sourceImageDataUrl on purpose — the renderer draws a photo placeholder.
    templateId: template.id,
    templateName: template.name,
  });
  return creative.previewSvg;
}

export function templatePreviewDataUrl(template: AdStudioTemplate, brandKit: AdStudioBrandKit, format: AdStudioFormat = "4:5"): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(templatePreviewSvg(template, brandKit, format))}`;
}
