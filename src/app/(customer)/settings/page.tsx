import { PageHeading } from "@/components/page-heading";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { GOOGLE_ADS_ENABLED } from "@/lib/config/feature-flags";
import { listProviderConnections } from "@/lib/providers/provider-connections";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { SettingsView } from "./settings-view";

export const dynamic = "force-dynamic";

type ProfileRow = {
  full_name: string | null;
  email: string | null;
  notification_preferences?: Record<string, boolean> | null;
};

type WorkspaceRow = {
  name: string | null;
  region: string | null;
  approval_required_by_default: boolean | null;
  plan_id: string | null;
  billing_email?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_status?: string | null;
};

type PlanRow = {
  name: string | null;
  key: string | null;
  monthly_ai_budget_cents: number | null;
  max_workspaces: number | null;
  max_agent_runs_per_month: number | null;
};

type MemberProfile = { full_name: string | null; email: string | null; is_operator: boolean | null };
type MemberRow = { profile_id: string; role: string; profiles: MemberProfile | MemberProfile[] | null };

export default async function SettingsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const canManage = access.isOperator || access.role === "owner" || access.role === "admin";

  const [{ data: profile }, { data: workspace }, connections] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", access.userId).maybeSingle(),
    supabase.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle(),
    listProviderConnections(supabase, access.workspaceId),
  ]);

  const w = (workspace as WorkspaceRow | null) ?? null;
  const planId = w?.plan_id ?? null;
  let planData: PlanRow | null = null;
  if (planId) {
    const planResult = await supabase.from("workspace_plans").select("*").eq("id", planId).maybeSingle();
    planData = (planResult.data as PlanRow | null) ?? null;
  }

  // Teammate names/emails cross the profiles RLS boundary, so read members with
  // the service client, scoped to this workspace.
  let members: Array<{ profileId: string; role: string; fullName: string | null; email: string | null; isOperator: boolean }> = [];
  try {
    const service = createSupabaseServiceClient();
    const { data: memberRows } = await service
      .from("workspace_members")
      .select("profile_id, role, created_at, profiles(full_name, email, is_operator)")
      .eq("workspace_id", access.workspaceId)
      .order("created_at", { ascending: true });
    members = ((memberRows ?? []) as MemberRow[]).map((row) => {
      const mp = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        profileId: row.profile_id,
        role: row.role,
        fullName: mp?.full_name ?? null,
        email: mp?.email ?? null,
        isOperator: Boolean(mp?.is_operator),
      };
    });
  } catch {
    members = [];
  }

  const p = (profile as ProfileRow | null) ?? null;
  const pl = planData;
  const wsQuery = encodeURIComponent(access.workspaceId);

  return (
    <main className="content">
      <PageHeading
        eyebrow="Account"
        title="Settings"
        description="Manage your account, security, billing, ad connections, workspace, and team."
      />
      <SettingsView
        user={{ id: access.userId, email: p?.email ?? "" }}
        profile={{ fullName: p?.full_name ?? "", notificationPreferences: p?.notification_preferences ?? {} }}
        workspace={{
          id: access.workspaceId,
          name: w?.name ?? access.workspaceName ?? "Workspace",
          region: w?.region ?? access.region ?? "AU",
          approvalRequiredByDefault: Boolean(w?.approval_required_by_default),
          billingEmail: w?.billing_email ?? "",
          stripeCustomerId: w?.stripe_customer_id ?? null,
          subscriptionStatus: w?.stripe_subscription_status ?? null,
        }}
        plan={
          pl
            ? {
                name: pl.name ?? "Plan",
                key: pl.key ?? "",
                monthlyAiBudgetCents: pl.monthly_ai_budget_cents ?? 0,
                maxWorkspaces: pl.max_workspaces ?? 0,
                maxAgentRunsPerMonth: pl.max_agent_runs_per_month ?? 0,
              }
            : null
        }
        connections={connections.map((c) => ({
          id: c.id,
          provider: c.provider,
          status: c.status,
          accountName: c.externalAccountName,
          healthStatus: c.healthStatus,
          lastSyncAt: c.lastSyncAt,
        }))}
        members={members}
        role={access.role}
        isOperator={access.isOperator}
        canManage={canManage}
        googleAdsEnabled={GOOGLE_ADS_ENABLED}
        metaConnectHref={`/api/integrations/meta/connect?workspaceId=${wsQuery}`}
        googleConnectHref={`/api/integrations/google/connect?workspaceId=${wsQuery}`}
      />
    </main>
  );
}
