import type { createSupabaseServerClient } from "@/lib/supabase/server";

import type { AdStudioBrandKit, AdStudioCampaignPack } from "./types.ts";

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
  await persistAdStudioBrandKit(supabase, pack.brandKit, userId);

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
