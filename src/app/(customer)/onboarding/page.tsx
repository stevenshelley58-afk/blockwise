import { PageHeading } from "@/components/page-heading";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { canAccessSurface } from "@/lib/auth/access-control";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const accessContext = { role: access.role, workspaceMode: access.workspaceMode };
  const canOpenCampaigns = access.isOperator || canAccessSurface(accessContext, "self_serve");
  const canSaveProfile = access.isOperator || access.role === "owner" || access.role === "admin";
  const canSaveBrand = access.isOperator || ["owner", "admin", "member"].includes(access.role);
  const canManageConnections = access.isOperator || access.role === "owner" || access.role === "admin";
  const { data: brandKit } = await supabase
    .from("adstudio_brand_kits")
    .select("*")
    .eq("workspace_id", access.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <main className="content">
      <PageHeading
        eyebrow="Welcome"
        title="Let's get you set up"
        description="Three quick steps to your first campaign. We've done most of it for you."
      />

      <OnboardingWizard
        workspaceId={access.workspaceId}
        agencyName={access.workspaceName ?? "Workspace"}
        region={access.region ?? "AU"}
        brandKit={brandKit}
        canSaveProfile={canSaveProfile}
        canSaveBrand={canSaveBrand}
        canManageConnections={canManageConnections}
        canOpenCampaigns={canOpenCampaigns}
        googleAdsEnabled={GOOGLE_ADS_ENABLED}
      />
    </main>
  );
}
