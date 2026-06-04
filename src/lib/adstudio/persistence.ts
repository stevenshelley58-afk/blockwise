import type { createSupabaseServerClient } from "@/lib/supabase/server";

import type {
  AdStudioBrandKit,
  AdStudioCampaign,
  AdStudioCampaignPack,
  AdStudioCampaignVariant,
  AdStudioComplianceReport,
  AdStudioCreative,
  AdStudioPlatformCopyPack,
} from "./types.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function persistAdStudioBrandKit(
  supabase: SupabaseServerClient,
  brandKit: AdStudioBrandKit,
  userId: string,
) {
  return supabase.from("adstudio_brand_kits").upsert(
    {
      id: brandKit.brandKitId,
      workspace_id: brandKit.workspaceId,
      source_type: brandKit.source.type,
      source_url: brandKit.source.url,
      business_name: brandKit.identity.businessName,
      market_country: brandKit.identity.marketCountry,
      market_region: brandKit.identity.marketRegion,
      identity_json: brandKit.identity,
      logos_json: brandKit.logos,
      colours_json: brandKit.colours,
      typography_json: brandKit.typography,
      tone_json: brandKit.tone,
      visual_style_json: brandKit.visualStyle,
      compliance_json: brandKit.compliance,
      contact_json: brandKit.contact,
      review_status: brandKit.reviewStatus,
      locked_fields_json: brandKit.lockedFields,
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

export async function persistAdStudioCampaignPack(
  supabase: SupabaseServerClient,
  pack: AdStudioCampaignPack,
  userId: string,
) {
  const brandKitResult = await persistAdStudioBrandKit(supabase, pack.brandKit, userId);

  if (brandKitResult.error) {
    return brandKitResult;
  }

  const campaignResult = await supabase.from("adstudio_campaigns").upsert(
    {
      id: pack.campaign.campaignId,
      workspace_id: pack.campaign.workspaceId,
      brand_kit_id: pack.campaign.brandKitId,
      name: pack.campaign.name,
      goal: pack.campaign.goal,
      market_json: pack.campaign.market,
      audience_intent: pack.campaign.audienceIntent,
      offer_id: pack.campaign.offerId,
      platforms_json: pack.campaign.platforms,
      creative_formats_json: pack.campaign.creativeFormats,
      status: pack.campaign.status,
      created_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (campaignResult.error) {
    return campaignResult;
  }

  const variantResult = await supabase.from("adstudio_campaign_variants").upsert(
    pack.variants.map((variant) => ({
      id: variant.variantId,
      workspace_id: pack.campaign.workspaceId,
      campaign_id: pack.campaign.campaignId,
      angle: variant.angle,
      headline: variant.headline,
      offer: variant.offer,
      cta: variant.cta,
      score_json: variant.score,
      status: variant.status,
      locked_fields_json: variant.lockedFields,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "id" },
  );

  if (variantResult.error) {
    return variantResult;
  }

  const creativeResult = await supabase.from("adstudio_creatives").upsert(
    pack.creatives.map((creative) => ({
      id: creative.creativeId,
      workspace_id: pack.campaign.workspaceId,
      campaign_id: creative.campaignId,
      variant_id: creative.variantId,
      format: creative.format,
      width: creative.canvas.width,
      height: creative.canvas.height,
      canvas_json: creative.canvas,
      render_status: "rendered",
      preview_svg: creative.previewSvg,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "id" },
  );

  if (creativeResult.error) {
    return creativeResult;
  }

  const copyResult = await supabase.from("adstudio_platform_copy").upsert(
    pack.copyPacks.map((copyPack) => ({
      id: copyPack.copyPackId,
      workspace_id: pack.campaign.workspaceId,
      campaign_id: copyPack.campaignId,
      variant_id: copyPack.variantId,
      meta_json: copyPack.meta,
      google_search_json: copyPack.googleSearch,
      google_pmax_json: copyPack.googlePmax,
      google_demand_gen_json: copyPack.googleDemandGen,
      landing_page_json: copyPack.landingPage,
      followup_json: copyPack.followUp,
      locked_fields_json: copyPack.lockedFields,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "id" },
  );

  if (copyResult.error) {
    return copyResult;
  }

  return supabase.from("adstudio_compliance_reports").upsert(
    {
      id: pack.compliance.reportId,
      workspace_id: pack.campaign.workspaceId,
      campaign_id: pack.campaign.campaignId,
      status: pack.compliance.status,
      issues_json: pack.compliance.issues,
      checked_at: pack.compliance.checkedAt,
    },
    { onConflict: "id" },
  );
}

export function rowToBrandKit(row: Record<string, unknown>): AdStudioBrandKit {
  return {
    brandKitId: String(row.id),
    workspaceId: String(row.workspace_id),
    source: {
      type: row.source_type === "manual" ? "manual" : "website",
      url: String(row.source_url ?? ""),
      lastExtractedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
      pagesScanned: [],
    },
    identity: row.identity_json as AdStudioBrandKit["identity"],
    logos: row.logos_json as AdStudioBrandKit["logos"],
    colours: row.colours_json as AdStudioBrandKit["colours"],
    typography: row.typography_json as AdStudioBrandKit["typography"],
    tone: row.tone_json as AdStudioBrandKit["tone"],
    visualStyle: row.visual_style_json as AdStudioBrandKit["visualStyle"],
    assets: {
      headshots: [],
      officeImages: [],
      listingImages: [],
      socialProofImages: [],
    },
    contact: row.contact_json as AdStudioBrandKit["contact"],
    compliance: row.compliance_json as AdStudioBrandKit["compliance"],
    reviewStatus:
      row.review_status === "approved" || row.review_status === "needs_changes"
        ? row.review_status
        : "pending_user_review",
    lockedFields: Array.isArray(row.locked_fields_json) ? (row.locked_fields_json as string[]) : [],
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function rowToVariant(row: Record<string, unknown>): AdStudioCampaignVariant {
  return {
    variantId: String(row.id),
    campaignId: String(row.campaign_id),
    angle: String(row.angle ?? ""),
    headline: String(row.headline ?? ""),
    offer: String(row.offer ?? ""),
    cta: String(row.cta ?? ""),
    score: row.score_json as AdStudioCampaignVariant["score"],
    status: row.status === "approved" ? "approved" : "draft",
    lockedFields: asStringArray(row.locked_fields_json),
  };
}

function rowToCreative(row: Record<string, unknown>): AdStudioCreative {
  const canvas = (row.canvas_json as AdStudioCreative["canvas"] | null) ?? {
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    backgroundAssetId: null,
    objects: [],
  };

  return {
    creativeId: String(row.id),
    campaignId: String(row.campaign_id),
    variantId: String(row.variant_id),
    format: row.format as AdStudioCreative["format"],
    canvas,
    safeZones: {
      metaStory: canvas.height >= canvas.width,
      googleDemandGen: true,
    },
    previewSvg: String(row.preview_svg ?? ""),
  };
}

function rowToCopyPack(row: Record<string, unknown>): AdStudioPlatformCopyPack {
  return {
    copyPackId: String(row.id),
    campaignId: String(row.campaign_id),
    variantId: String(row.variant_id),
    meta: row.meta_json as AdStudioPlatformCopyPack["meta"],
    googleSearch: row.google_search_json as AdStudioPlatformCopyPack["googleSearch"],
    googlePmax: row.google_pmax_json as AdStudioPlatformCopyPack["googlePmax"],
    googleDemandGen: row.google_demand_gen_json as AdStudioPlatformCopyPack["googleDemandGen"],
    landingPage: row.landing_page_json as AdStudioPlatformCopyPack["landingPage"],
    followUp: row.followup_json as AdStudioPlatformCopyPack["followUp"],
    lockedFields: asStringArray(row.locked_fields_json),
  };
}

function rowToCompliance(row: Record<string, unknown> | null, campaignId: string): AdStudioComplianceReport {
  if (!row) {
    return {
      reportId: `compliance_${campaignId}`,
      campaignId,
      status: "needs_review",
      issues: [],
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    reportId: String(row.id),
    campaignId: String(row.campaign_id ?? campaignId),
    status:
      row.status === "approved" || row.status === "blocked" ? row.status : "needs_review",
    issues: Array.isArray(row.issues_json)
      ? (row.issues_json as AdStudioComplianceReport["issues"])
      : [],
    checkedAt: String(row.checked_at ?? new Date().toISOString()),
  };
}

/**
 * Reconstruct a full, typed campaign pack from persisted Supabase rows so the
 * studio can resume real saved work instead of demo data.
 */
export function rowToCampaignPack(input: {
  brandKit: AdStudioBrandKit;
  campaign: Record<string, unknown>;
  variants: Array<Record<string, unknown>>;
  creatives: Array<Record<string, unknown>>;
  copy: Array<Record<string, unknown>>;
  compliance: Record<string, unknown> | null;
}): AdStudioCampaignPack {
  const campaignId = String(input.campaign.id);
  const campaign: AdStudioCampaign = {
    campaignId,
    workspaceId: String(input.campaign.workspace_id),
    brandKitId: String(input.campaign.brand_kit_id),
    name: String(input.campaign.name ?? "Campaign"),
    goal: input.campaign.goal as AdStudioCampaign["goal"],
    market: input.campaign.market_json as AdStudioCampaign["market"],
    audienceIntent: String(input.campaign.audience_intent ?? ""),
    offerId: String(input.campaign.offer_id ?? ""),
    platforms: (input.campaign.platforms_json as AdStudioCampaign["platforms"]) ?? [],
    creativeFormats: (input.campaign.creative_formats_json as AdStudioCampaign["creativeFormats"]) ?? [],
    status: (input.campaign.status as AdStudioCampaign["status"]) ?? "ready",
  };

  return {
    brandKit: input.brandKit,
    campaign,
    variants: input.variants.map(rowToVariant),
    creatives: input.creatives.map(rowToCreative),
    copyPacks: input.copy.map(rowToCopyPack),
    compliance: rowToCompliance(input.compliance, campaignId),
  };
}
