import { AdStudioCustomerFlow } from "@/components/adstudio/ad-studio-customer-flow";
import { createEmptyAdStudioCampaignPack, listOfferTemplates, type AdStudioBrandKit } from "@/lib/adstudio";
import {
  ADSTUDIO_EMBEDDED_ASSET_LIMIT,
  applyBrandAssetRows,
  loadAdStudioBrandAssetRows,
} from "@/lib/adstudio/assets";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { isExampleBrandKitSourceUrl, persistAdStudioBrandKit, rowToBrandKit } from "@/lib/adstudio/persistence";
import { buildAdStudioFallbackBrandKit } from "@/lib/adstudio/trial-brand-kit";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function stringParam(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AdStudioPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const requestedCampaignId = stringParam(params.campaignId);
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId, requestedCampaignId);

  // Softened gate: an extracted-but-unapproved kit lets the user straight into the
  // customer flow as a draft brand (publish stays blocked until approval).
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
  const bundle = liveBundle ?? draftBundle ?? starterBundle;
  if (!bundle) throw new Error("Ad Studio could not prepare an empty workspace.");

  return (
    <AdStudioCustomerFlow
      brandKit={bundle.brandKit}
      campaignPack={bundle.campaignPack}
      offers={bundle.offers}
    />
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

/**
 * B2 (simplification): when the workspace only has an *unapproved* extracted brand
 * kit, seed a starter pack from it instead of hard-gating on approval. The kit is
 * returned with its real draft review status so the create flow remains usable
 * while the publish step stays blocked.
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
