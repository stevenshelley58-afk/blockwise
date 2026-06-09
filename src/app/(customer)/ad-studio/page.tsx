import Link from "next/link";

import { AdStudioWorkbench } from "@/components/adstudio/ad-studio-workbench";
import { generateAdStudioCampaignPack, listOfferTemplates } from "@/lib/adstudio";
import { getAdStudioDemoBundle } from "@/lib/adstudio/demo-data";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { persistAdStudioBrandKit } from "@/lib/adstudio/persistence";
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
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId, requestedCampaignId);
  const isTrialWorkspace = await loadIsTrialWorkspace(supabase, access.workspaceId);

  if (!liveBundle && !isTrialWorkspace) {
    return <BrandSetupGate workspaceName={access.workspaceName ?? "your workspace"} />;
  }

  const trialBundle = !liveBundle && isTrialWorkspace
    ? await buildTrialStarterBundle({
        supabase,
        workspaceId: access.workspaceId,
        workspaceName: access.workspaceName,
        region: access.region,
        userId: access.userId,
      })
    : null;
  const isSample = liveBundle === null && trialBundle === null;
  const bundle = liveBundle ?? trialBundle ?? getAdStudioDemoBundle();

  return (
    <>
      {isSample && <SampleBanner />}
      {trialBundle && <TrialBrandBanner />}
      <AdStudioWorkbench
        workspaceId={access.workspaceId}
        brandKit={bundle.brandKit}
        campaignPack={bundle.campaignPack}
        offers={bundle.offers}
        performance={bundle.performance}
        firstRun={isFirstRunParam(params.first)}
        isSample={isSample}
      />
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
  await persistAdStudioBrandKit(input.supabase, brandKit, input.userId).catch(() => null);
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
  return {
    brandKit,
    campaignPack,
    offers,
    performance: getAdStudioDemoBundle().performance,
    isLive: false,
  };
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
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f8fafc", padding: 24 }}>
      <section style={{ width: "min(560px, 100%)", border: "1px solid #dbe3ef", borderRadius: 10, background: "#fff", padding: 24, display: "grid", gap: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 750, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.6 }}>{workspaceName}</span>
        <h1 style={{ margin: 0, fontSize: 24, letterSpacing: 0 }}>Approve your brand kit first</h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.55 }}>
          Ad Studio needs an approved agency brand before it can create live ads. Scan your site, check the logo, colours, contact details, and approve the kit.
        </p>
        <Link href="/ad-studio/brand" style={{ minHeight: 42, borderRadius: 8, background: "#123E75", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 16px", textDecoration: "none", fontWeight: 750 }}>
          Open Brand Studio
        </Link>
      </section>
    </main>
  );
}

function TrialBrandBanner() {
  return (
    <div style={{ padding: "10px 16px", background: "#eff6ff", color: "#123E75", borderBottom: "1px solid #bfdbfe", fontSize: 13.5, fontWeight: 650 }}>
      Trial starter brand in use. Add your logo and agency details in <Link href="/ad-studio/brand" style={{ color: "#123E75", textDecoration: "underline" }}>Brand Studio</Link>.
    </div>
  );
}
