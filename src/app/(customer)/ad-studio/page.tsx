import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { generateAdStudioCampaignPack, listOfferTemplates, type AdStudioBrandKit } from "@/lib/adstudio";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { isExampleBrandKitSourceUrl, persistAdStudioCampaignPack, rowToBrandKit } from "@/lib/adstudio/persistence";
import { buildTrialFallbackBrandKit } from "@/lib/adstudio/trial-brand-kit";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

import { SampleBanner } from "./sample-banner";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function isFirstRunParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.includes("1") : value === "1";
}

function stringParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AdStudioPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const requestedCampaignId = stringParam(params.campaignId);
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId, requestedCampaignId, access.userId);

  // Softened gate: an extracted-but-unapproved kit lets the user straight into the
  // workbench as a "Draft brand" (publish stays blocked until approval).
  const draftBundle = !liveBundle ? await buildDraftBrandBundle(supabase, access.workspaceId, access.userId) : null;

  const starterBundle = !liveBundle && !draftBundle
    ? await buildStarterBundle({
        supabase,
        workspaceId: access.workspaceId,
        workspaceName: access.workspaceName,
        region: access.region,
        userId: access.userId,
      })
    : null;
  const isSample = liveBundle === null && draftBundle === null && starterBundle === null;
  const bundle = liveBundle ?? draftBundle ?? starterBundle ?? getAdStudioDemoBundle();
  const showBrandSetupPrompt = !isSample && isStarterFallbackBrandKit(bundle.brandKit);

  return (
    <>
      {isSample && <SampleBanner />}
      <AdStudioWorkbench
        workspaceId={access.workspaceId}
        brandKit={bundle.brandKit}
        campaignPack={bundle.campaignPack}
        offers={bundle.offers}
        performance={bundle.performance}
        firstRun={isFirstRunParam(params.first)}
        isSample={isSample}
        showBrandSetupPrompt={showBrandSetupPrompt}
      />
    </>
  );
}

async function buildStarterBundle(input: {
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>;
  workspaceId: string;
  workspaceName?: string;
  region?: string;
  userId: string;
}) {
  const brandKit = buildTrialFallbackBrandKit({
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    region: input.region,
  });
  const starterBrandKit: AdStudioBrandKit = {
    ...brandKit,
    reviewStatus: "pending_user_review",
    lockedFields: Array.from(new Set([...brandKit.lockedFields, "starter_brand"])),
  };
  const offers = listOfferTemplates();
  const generatedCampaignPack = generateAdStudioCampaignPack({
    workspaceId: input.workspaceId,
    brandKit: { ...starterBrandKit, reviewStatus: "approved" },
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: input.region ?? "WA",
    offerId: offers[0]?.offerId ?? "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 3,
  });
  const campaignPack = { ...generatedCampaignPack, brandKit: starterBrandKit };
  await persistAdStudioCampaignPack(input.supabase, campaignPack, input.userId).catch(() => null);
  return {
    brandKit: starterBrandKit,
    campaignPack,
    offers,
    performance: getAdStudioDemoBundle().performance,
    isLive: false,
  };
}

function isStarterFallbackBrandKit(brandKit: AdStudioBrandKit): boolean {
  return brandKit.lockedFields.includes("starter_brand") || (brandKit.source.type === "manual" && !brandKit.source.url.trim());
}

/**
 * B2 (simplification): when the workspace only has an *unapproved* extracted brand
 * kit, seed a starter pack from it instead of hard-gating on approval. The kit is
 * returned with its real (draft) review status so the workbench shows the
 * "Draft brand" chip and the publish panel keeps publishing blocked.
 */
async function buildDraftBrandBundle(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
  userId: string,
) {
  try {
    const { data } = await supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(10);

    const nonDemoRows = (data ?? []).filter((row) => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
    const row = nonDemoRows.find((candidate) => String(candidate.source_url ?? "").trim()) ?? nonDemoRows[0];
    if (!row) return null;

    const brandKit = applyBrandAssetRows(
      rowToBrandKit(row),
      await loadAdStudioBrandAssetRows(supabase, workspaceId, String(row.id)),
    );
    // Approved kits are already handled by loadLiveAdStudioBundle.
    if (brandKit.reviewStatus === "approved") return null;

    const offers = listOfferTemplates();
    const generatedCampaignPack = generateAdStudioCampaignPack({
      workspaceId,
      // The generator requires an approved kit; seeding a preview pack from a
      // draft kit reuses the same pattern as loadLiveAdStudioBundle. The kit
      // shown in the UI keeps its real draft status.
      brandKit: { ...brandKit, reviewStatus: "approved" },
      goal: "seller_leads",
      suburb: "Scarborough",
      city: "Perth",
      state: brandKit.identity.marketRegion ?? "WA",
      offerId: offers[0]?.offerId ?? "seller_prep_checklist",
      platforms: ["meta"],
      variantCount: 3,
    });
    const campaignPack = { ...generatedCampaignPack, brandKit };
    await persistAdStudioCampaignPack(supabase, campaignPack, userId).catch(() => null);

    return {
      brandKit,
      campaignPack,
      offers,
      performance: getAdStudioDemoBundle().performance,
      isLive: true,
    };
  } catch {
    return null;
  }
}
