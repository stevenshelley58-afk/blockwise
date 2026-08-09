import type { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  ADSTUDIO_EMBEDDED_ASSET_LIMIT,
  applyBrandAssetRows,
  loadAdStudioBrandAssetRows,
} from "./assets.ts";
import { normalizeCloneQa } from "./types.ts";
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
type PersistenceResult = { data: unknown; error: { message: string } | null };

export function isExampleBrandKitSourceUrl(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    return host === "example" || host.endsWith(".example");
  } catch {
    return /(^|[/:.])example(?:[/?#:]|$)/i.test(trimmed);
  }
}

export function isExampleBrandKit(brandKit: Pick<AdStudioBrandKit, "source">): boolean {
  return isExampleBrandKitSourceUrl(brandKit.source.url);
}

function persistenceError(message: string): PersistenceResult {
  return { data: null, error: { message } };
}

export async function persistAdStudioBrandKit(
  supabase: SupabaseServerClient,
  brandKit: AdStudioBrandKit,
  userId: string,
): Promise<PersistenceResult> {
  if (isExampleBrandKit(brandKit)) {
    return persistenceError("Demo brand kits cannot be saved to a workspace.");
  }

  const result = await supabase.from("adstudio_brand_kits").upsert(
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

  return result;
}

export async function persistAdStudioCampaignPack(
  supabase: SupabaseServerClient,
  pack: AdStudioCampaignPack,
  userId: string,
): Promise<PersistenceResult> {
  if (isExampleBrandKit(pack.brandKit)) {
    return persistenceError("Demo brand kits cannot be used for saved campaigns.");
  }

  const now = new Date().toISOString();
  const compactCreatives = compactCreativesForPersistence(pack.creatives);

  // One transactional RPC (adstudio_persist_campaign_pack, SECURITY INVOKER so
  // RLS still applies): a failure in any table rolls back the whole pack —
  // partially written campaigns are impossible.
  const result = await supabase.rpc("adstudio_persist_campaign_pack", {
    brand_kit: {
      id: pack.brandKit.brandKitId,
      workspace_id: pack.brandKit.workspaceId,
      source_type: pack.brandKit.source.type,
      source_url: pack.brandKit.source.url,
      business_name: pack.brandKit.identity.businessName,
      market_country: pack.brandKit.identity.marketCountry,
      market_region: pack.brandKit.identity.marketRegion,
      identity_json: pack.brandKit.identity,
      logos_json: pack.brandKit.logos,
      colours_json: pack.brandKit.colours,
      typography_json: pack.brandKit.typography,
      tone_json: pack.brandKit.tone,
      visual_style_json: pack.brandKit.visualStyle,
      compliance_json: pack.brandKit.compliance,
      contact_json: pack.brandKit.contact,
      review_status: pack.brandKit.reviewStatus,
      locked_fields_json: pack.brandKit.lockedFields,
      created_by: userId,
      updated_at: now,
    },
    campaign: {
      id: pack.campaign.campaignId,
      workspace_id: pack.campaign.workspaceId,
      brand_kit_id: pack.campaign.brandKitId,
      name: pack.campaign.name,
      goal: pack.campaign.goal,
      market_json: pack.campaign.market,
      audience_intent: pack.campaign.audienceIntent,
      offer_id: pack.campaign.offerId,
      template_key: pack.campaign.templateKey ?? null,
      template_source: pack.campaign.templateSource ?? null,
      source_observed_ad_id: pack.campaign.sourceObservedAdId ?? null,
      template_snapshot_json: pack.campaign.templateSnapshot ?? {},
      platforms_json: pack.campaign.platforms,
      creative_formats_json: pack.campaign.creativeFormats,
      status: pack.campaign.status,
      created_by: userId,
      updated_at: now,
    },
    variants: pack.variants.map((variant) => ({
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
      updated_at: now,
    })),
    creatives: compactCreatives.map((creative) => ({
      id: creative.creativeId,
      workspace_id: pack.campaign.workspaceId,
      campaign_id: creative.campaignId,
      variant_id: creative.variantId,
      format: creative.format,
      width: creative.canvas.width,
      height: creative.canvas.height,
      canvas_json: creative.canvas,
      render_status: "rendered",
      preview_svg: null,
      updated_at: now,
    })),
    copy_packs: pack.copyPacks.map((copyPack) => ({
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
      updated_at: now,
    })),
    compliance: {
      id: pack.compliance.reportId,
      workspace_id: pack.campaign.workspaceId,
      campaign_id: pack.campaign.campaignId,
      status: pack.compliance.status,
      issues_json: pack.compliance.issues,
      checked_at: pack.compliance.checkedAt,
    },
  });

  if (!result.error && compactCreatives.length > 0) {
    const revisions = await supabase
      .from("adstudio_creatives")
      .select("id, active_revision_id")
      .eq("workspace_id", pack.campaign.workspaceId)
      .in("id", compactCreatives.map((creative) => creative.creativeId));
    if (!revisions.error) {
      const activeByCreative = new Map(
        (revisions.data ?? []).flatMap((row) =>
          typeof row.active_revision_id === "string" ? [[String(row.id), row.active_revision_id] as const] : [],
        ),
      );
      for (const creative of pack.creatives) {
        creative.activeRevisionId = activeByCreative.get(creative.creativeId) ?? creative.activeRevisionId;
      }
    }
  }

  return { data: result.data, error: result.error ? { message: result.error.message } : null };
}

export function compactAdStudioCampaignPackForTransport(pack: AdStudioCampaignPack): AdStudioCampaignPack {
  return {
    ...pack,
    creatives: compactCreativesForPersistence(pack.creatives).map((creative) => ({
      ...creative,
      previewSvg: "",
    })),
  };
}

function compactCreativesForPersistence(creatives: AdStudioCreative[]): AdStudioCreative[] {
  const keptImageByVariantAndSource = new Set<string>();

  return creatives.map((creative) => {
    const primaryImage = primaryImageSource(creative);
    const imageKey = primaryImage ? `${creative.variantId}:${primaryImage}` : "";
    const keepPrimaryImage = Boolean(primaryImage) && !keptImageByVariantAndSource.has(imageKey);

    if (keepPrimaryImage) keptImageByVariantAndSource.add(imageKey);

    return {
      ...creative,
      canvas: compactCreativeCanvas(creative.canvas, keepPrimaryImage),
      previewSvg: "",
    };
  });
}

function compactCreativeCanvas(
  creativeCanvas: AdStudioCreative["canvas"],
  keepPrimaryImage: boolean,
): AdStudioCreative["canvas"] {
  return {
    ...creativeCanvas,
    objects: creativeCanvas.objects.map((object) => {
      if (object.role !== "primary_image" || keepPrimaryImage) return object;
      return { ...object, content: undefined };
    }),
  };
}

function primaryImageSource(creative: AdStudioCreative): string | undefined {
  const image = creative.canvas.objects.find((object) => object.role === "primary_image");
  return image?.content || image?.assetId;
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

export function rowToCreative(row: Record<string, unknown>): AdStudioCreative {
  const rawCanvas = (row.canvas_json as AdStudioCreative["canvas"] | null) ?? {
    width: Number(row.width ?? 0),
    height: Number(row.height ?? 0),
    backgroundAssetId: null,
    objects: [],
  };
  // Legacy rows carry verdict-era { copyChecks, passed… } blobs under cloneQa;
  // normalize to the lean { regions, copyValues } editor map on read.
  const cloneQa = normalizeCloneQa(rawCanvas.cloneQa);
  const canvas = cloneQa ? { ...rawCanvas, cloneQa } : rawCanvas;

  return {
    creativeId: String(row.id),
    activeRevisionId: typeof row.active_revision_id === "string" ? row.active_revision_id : undefined,
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
    templateKey: optionalString(input.campaign.template_key),
    templateSource: templateSource(input.campaign.template_source),
    sourceObservedAdId: optionalString(input.campaign.source_observed_ad_id),
    templateSnapshot: isRecord(input.campaign.template_snapshot_json) ? input.campaign.template_snapshot_json : null,
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

export async function loadAdStudioCampaignPack(
  supabase: SupabaseServerClient,
  workspaceId: string,
  campaignId: string,
): Promise<AdStudioCampaignPack | null> {
  const { data: campaign, error: campaignError } = await supabase
    .from("adstudio_campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", campaignId)
    .maybeSingle();

  if (campaignError) throw new Error(campaignError.message);
  if (!campaign) return null;

  const [brandKitRow, variants, creatives, copy, compliance] = await Promise.all([
    supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", String(campaign.brand_kit_id))
      .maybeSingle(),
    supabase.from("adstudio_campaign_variants").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId),
    supabase.from("adstudio_creatives").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId),
    supabase.from("adstudio_platform_copy").select("*").eq("workspace_id", workspaceId).eq("campaign_id", campaignId),
    supabase
      .from("adstudio_compliance_reports")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("campaign_id", campaignId)
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (brandKitRow.error) throw new Error(brandKitRow.error.message);
  if (variants.error) throw new Error(variants.error.message);
  if (creatives.error) throw new Error(creatives.error.message);
  if (copy.error) throw new Error(copy.error.message);
  if (compliance.error) throw new Error(compliance.error.message);
  if (!brandKitRow.data) return null;

  const brandKit = applyBrandAssetRows(
    rowToBrandKit(brandKitRow.data),
    await loadAdStudioBrandAssetRows(
      supabase,
      workspaceId,
      String(campaign.brand_kit_id),
      ADSTUDIO_EMBEDDED_ASSET_LIMIT,
    ),
  );
  const currentCreatives = filterCreativeRowsToDeclaredFormats(
    campaign,
    creatives.data ?? [],
  );

  return rowToCampaignPack({
    brandKit,
    campaign,
    variants: variants.data ?? [],
    creatives: currentCreatives,
    copy: copy.data ?? [],
    compliance: compliance.data ?? null,
  });
}

/**
 * Campaign persistence is an upsert, so campaigns created before the current
 * two-format contract can retain obsolete creative rows. The campaign's
 * declared formats are the authoritative child set; stale rows stay
 * quarantined instead of leaking back into the editor or export package.
 */
export function filterCreativeRowsToDeclaredFormats(
  campaign: Record<string, unknown>,
  creatives: Record<string, unknown>[],
): Record<string, unknown>[] {
  const declaredFormats = asStringArray(campaign.creative_formats_json);
  if (declaredFormats.length === 0) return creatives;
  const allowed = new Set(declaredFormats);
  return creatives.filter((creative) => typeof creative.format === "string" && allowed.has(creative.format));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function templateSource(value: unknown): AdStudioCampaign["templateSource"] {
  if (value === "builtin" || value === "operator" || value === "radar" || value === "ad_radar") return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
