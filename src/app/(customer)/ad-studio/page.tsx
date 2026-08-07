import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { createEmptyAdStudioCampaignPack, listOfferTemplates, type AdStudioBrandKit } from "@/lib/adstudio";
import { adstudioTemplatesV2Enabled } from "@/lib/adstudio/v2/flags";
import { v2ReadyTemplatesAsV1 } from "@/lib/adstudio/v2/gallery-adapter";
import {
  ADSTUDIO_EMBEDDED_ASSET_LIMIT,
  applyBrandAssetRows,
  loadAdStudioBrandAssetRows,
} from "@/lib/adstudio/assets";
import { loadAdStudioLibraryPage, type LibraryAssetModel } from "@/lib/adstudio/library-read-model";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { isExampleBrandKitSourceUrl, persistAdStudioBrandKit, rowToBrandKit } from "@/lib/adstudio/persistence";
import { buildAdStudioFallbackBrandKit } from "@/lib/adstudio/trial-brand-kit";
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
  const [liveBundle, assetsPage] = await Promise.all([
    loadLiveAdStudioBundle(supabase, access.workspaceId, requestedCampaignId),
    loadAdStudioLibraryPage({
      supabase,
      workspaceId: access.workspaceId,
      kind: "assets",
      limit: 24,
    }),
  ]);

  // Softened gate: an extracted-but-unapproved kit lets the user straight into the
  // workbench as a "Draft brand" (publish stays blocked until approval).
  const draftBundle = !liveBundle ? await buildDraftBrandBundle(supabase, access.workspaceId) : null;

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
  const bundle = liveBundle ?? draftBundle ?? starterBundle;
  if (!bundle) throw new Error("Ad Studio could not prepare an empty workspace.");
  const showBrandSetupPrompt = !isSample && isStarterFallbackBrandKit(bundle.brandKit);
  const initialMediaAssets = (assetsPage.items as LibraryAssetModel[]).map((asset) => ({
    ...asset,
    ratio: "Image" as const,
  }));

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
        initialMediaAssets={initialMediaAssets}
        initialMediaCursor={assetsPage.nextCursor}
        useV2Frames={adstudioTemplatesV2Enabled()}
        v2Templates={adstudioTemplatesV2Enabled() ? v2ReadyTemplatesAsV1(process.cwd()) : []}
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
  const starterBrandKit = buildAdStudioFallbackBrandKit({
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    region: input.region,
  });
  // Asset uploads are attached to a real brand-kit row. Persist the first-run
  // kit before rendering the upload UI so a new workspace can complete its
  // first clone without a separate Brand Studio round trip.
  const persisted = await persistAdStudioBrandKit(input.supabase, starterBrandKit, input.userId);
  if (persisted.error) {
    throw new Error(`Ad Studio could not prepare the starter brand: ${persisted.error.message}`);
  }
  const offers = listOfferTemplates();
  const campaignPack = createEmptyAdStudioCampaignPack({ workspaceId: input.workspaceId, brandKit: starterBrandKit });
  return {
    brandKit: starterBrandKit,
    campaignPack,
    offers,
    performance: EMPTY_PERFORMANCE,
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
      await loadAdStudioBrandAssetRows(
        supabase,
        workspaceId,
        String(row.id),
        ADSTUDIO_EMBEDDED_ASSET_LIMIT,
      ),
    );
    // Approved kits are already handled by loadLiveAdStudioBundle.
    if (brandKit.reviewStatus === "approved") return null;

    const offers = listOfferTemplates();
    const campaignPack = createEmptyAdStudioCampaignPack({ workspaceId, brandKit });

    return {
      brandKit,
      campaignPack,
      offers,
      performance: EMPTY_PERFORMANCE,
      isLive: true,
    };
  } catch {
    return null;
  }
}

const EMPTY_PERFORMANCE = {
  leads: 0,
  costPerLeadAud: 0,
  bookedAppraisals: 0,
  bestFormat: "4:5",
  recommendations: ["Choose a sample to create your first ad."],
};
