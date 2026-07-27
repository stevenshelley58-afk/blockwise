import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { niche } from "@/config/niche";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { canManageProviderConnections } from "@/lib/auth/access-control";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

type BrandKitRow = {
  id: string;
  source_type?: string | null;
  source_url?: string | null;
  business_name?: string | null;
  market_country?: string | null;
  market_region?: string | null;
  identity_json?: JsonObject | null;
  logos_json?: JsonObject | null;
  colours_json?: JsonObject | null;
  typography_json?: JsonObject | null;
  tone_json?: JsonObject | null;
  visual_style_json?: JsonObject | null;
  compliance_json?: JsonObject | null;
  contact_json?: JsonObject | null;
  review_status?: string | null;
  locked_fields_json?: unknown[] | null;
};

type WorkspaceRow = {
  name?: string | null;
  region?: string | null;
};

export default async function OnboardingPage() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");

  const [{ data: workspace }, { data: brandKit }] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle(),
    supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", access.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const w = (workspace as WorkspaceRow | null) ?? null;
  const canManage = access.isOperator || access.role === "owner" || access.role === "admin";

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16" aria-label="Onboarding">
      <header className="mb-6">
        <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Workspace setup</p>
        <h1 className="mt-1 font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">{niche.copy.onboarding.title}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{niche.copy.onboarding.lead}</p>
      </header>

      <OnboardingWizard
        workspaceId={access.workspaceId}
        agencyName={w?.name ?? access.workspaceName ?? "Workspace"}
        region={w?.region ?? access.region ?? "AU"}
        brandKit={(brandKit as BrandKitRow | null) ?? null}
        canSaveProfile={canManage}
        canSaveBrand={access.isOperator || access.role === "owner" || access.role === "admin" || access.role === "member"}
        canManageConnections={canManageProviderConnections({ role: access.role, workspaceMode: access.workspaceMode })}
        canOpenCampaigns
        googleAdsEnabled={GOOGLE_ADS_ENABLED}
      />
    </main>
  );
}
