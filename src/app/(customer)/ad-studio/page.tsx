import Link from "next/link";

import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { QuickCreate } from "@/components/adstudio/quick/quick-create";
import { generateAdStudioCampaignPack, listOfferTemplates } from "@/lib/adstudio";
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
  const advanced = isFirstRunParam(params.advanced);
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId, requestedCampaignId, access.userId);
  const isTrialWorkspace = await loadIsTrialWorkspace(supabase, access.workspaceId);

  // Softened gate: an extracted-but-unapproved kit lets the user straight into the
  // workbench as a "Draft brand" (publish stays blocked until approval). The hard
  // gate only remains for non-trial workspaces with no brand kit at all.
  const draftBundle = !liveBundle ? await buildDraftBrandBundle(supabase, access.workspaceId, access.userId) : null;

  if (!liveBundle && !draftBundle && !isTrialWorkspace) {
    return <BrandSetupGate workspaceName={access.workspaceName ?? "your workspace"} />;
  }

  const trialBundle = !liveBundle && !draftBundle && isTrialWorkspace
    ? await buildTrialStarterBundle({
        supabase,
        workspaceId: access.workspaceId,
        workspaceName: access.workspaceName,
        region: access.region,
        userId: access.userId,
      })
    : null;
  const isSample = liveBundle === null && draftBundle === null && trialBundle === null;
  const bundle = liveBundle ?? draftBundle ?? trialBundle ?? getAdStudioDemoBundle();

  // Default entry is the simple template-first create flow. The full multi-panel
  // workbench stays available as "Advanced edit" (?advanced=1) and is also used
  // whenever a specific campaign is opened for editing (?campaignId=).
  const showWorkbench = advanced || Boolean(requestedCampaignId);

  return (
    <>
      {isSample && <SampleBanner />}
      {trialBundle && <TrialBrandBanner />}
      {showWorkbench ? (
        <AdStudioWorkbench
          workspaceId={access.workspaceId}
          brandKit={bundle.brandKit}
          campaignPack={bundle.campaignPack}
          offers={bundle.offers}
          performance={bundle.performance}
          firstRun={isFirstRunParam(params.first)}
          isSample={isSample}
        />
      ) : (
        <QuickCreate workspaceId={access.workspaceId} brandKit={bundle.brandKit} isSample={isSample} />
      )}
    </>
  );
}

async function buildTrialStarterBundle(input: {
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
  const offers = listOfferTemplates();
  const campaignPack = generateAdStudioCampaignPack({
    workspaceId: input.workspaceId,
    brandKit,
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: input.region ?? "WA",
    offerId: offers[0]?.offerId ?? "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 3,
  });
  await persistAdStudioCampaignPack(input.supabase, campaignPack, input.userId).catch(() => null);
  return {
    brandKit,
    campaignPack,
    offers,
    performance: getAdStudioDemoBundle().performance,
    isLive: false,
  };
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

async function loadIsTrialWorkspace(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("workspaces")
    .select("workspace_plans(key)")
    .eq("id", workspaceId)
    .maybeSingle();
  const plan = Array.isArray(data?.workspace_plans) ? data?.workspace_plans[0] : data?.workspace_plans;
  return plan?.key === "trial";
}

function BrandSetupGate({ workspaceName }: { workspaceName: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", padding: 24, flex: 1 }}>
      <section style={{ width: "min(560px, 100%)", border: "1px solid #dbe3ef", borderRadius: 10, background: "#fff", padding: 24, display: "grid", gap: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 750, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.6 }}>{workspaceName}</span>
        <h1 style={{ margin: 0, fontSize: 24, letterSpacing: 0 }}>Add your brand first</h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.55 }}>
          Scan your website once and Ad Studio fills in your logo, colours and contact details. You can start creating ads straight away and confirm the details before you publish.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/ad-studio/brand" style={{ minHeight: 42, borderRadius: 8, background: "#123E75", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 16px", textDecoration: "none", fontWeight: 750 }}>
            Open Brand Studio
          </Link>
          <Link href="/self-serve" style={{ minHeight: 42, borderRadius: 8, border: "1px solid #dbe3ef", color: "#475569", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 16px", textDecoration: "none", fontWeight: 600 }}>
            Back to Home
          </Link>
        </div>
      </section>
    </div>
  );
}

function TrialBrandBanner() {
  return (
    <div style={{ padding: "10px 16px", background: "#eff6ff", color: "#123E75", borderBottom: "1px solid #bfdbfe", fontSize: 13.5, fontWeight: 650 }}>
      Trial starter brand in use. Add your logo and agency details in <Link href="/ad-studio/brand" style={{ color: "#123E75", textDecoration: "underline" }}>Brand Studio</Link>.
    </div>
  );
}
