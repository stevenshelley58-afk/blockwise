import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { resolveCustomerActivation } from "@/lib/activation/customer-activation";
import { niche } from "@/config/niche";
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
  country_code?: string | null;
  billing_currency?: string | null;
  billing_access_state?: string | null;
  billing_checkout_completed_at?: string | null;
  stripe_current_period_start?: string | null;
  stripe_current_period_end?: string | null;
  stripe_cancel_at_period_end?: boolean | null;
  stripe_latest_invoice_status?: string | null;
  stripe_latest_invoice_amount_paid?: number | null;
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
type InvitationRow = { id: string; email: string; role: string; expires_at: string };

export default async function SettingsPage() {
  const { supabase, access } = await requirePageSurfaceAccess("monitor");
  const canManage = access.isOperator || access.role === "owner" || access.role === "admin";
  const service = createSupabaseServiceClient();

  const [
    { data: profile },
    { data: workspace },
    connections,
    { data: authData },
    { data: brandKit },
    { data: wallet },
    activation,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", access.userId).maybeSingle(),
    supabase.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle(),
    listProviderConnections(supabase, access.workspaceId),
    supabase.auth.getUser(),
    supabase
      .from("adstudio_brand_kits")
      .select("source_url, review_status")
      .eq("workspace_id", access.workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("workspace_credit_wallets")
      .select("*")
      .eq("workspace_id", access.workspaceId)
      .eq("status", "active")
      .order("period_end", { ascending: false })
      .limit(1)
      .maybeSingle(),
    resolveCustomerActivation({ workspaceId: access.workspaceId, serviceSupabase: service }),
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
  let members: Array<{
    profileId: string;
    role: string;
    fullName: string | null;
    email: string | null;
    isOperator: boolean;
    emailVerified: boolean;
  }> = [];
  let invitations: Array<{
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  }> = [];
  try {
    const [{ data: memberRows }, { data: invitationRows }] = await Promise.all([
      service
        .from("workspace_members")
        .select("profile_id, role, created_at, profiles(full_name, email, is_operator)")
        .eq("workspace_id", access.workspaceId)
        .order("created_at", { ascending: true }),
      service
        .from("workspace_invitations")
        .select("id, email, role, expires_at")
        .eq("workspace_id", access.workspaceId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true }),
    ]);
    members = await Promise.all(
      ((memberRows ?? []) as MemberRow[]).map(async (row) => {
        const mp = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        const { data: memberAuth } = await service.auth.admin.getUserById(row.profile_id);
        return {
          profileId: row.profile_id,
          role: row.role,
          fullName: mp?.full_name ?? null,
          email: mp?.email ?? null,
          isOperator: Boolean(mp?.is_operator),
          emailVerified: Boolean(memberAuth.user?.email_confirmed_at),
        };
      }),
    );
    invitations = ((invitationRows ?? []) as InvitationRow[]).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
    }));
  } catch {
    members = [];
    invitations = [];
  }

  const p = (profile as ProfileRow | null) ?? null;
  const pl = planData;
  const wsQuery = encodeURIComponent(access.workspaceId);
  const authUser = authData.user;
  const userMetadata = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
  const walletRow = (wallet ?? null) as {
    credits_granted?: number | null;
    credits_reserved?: number | null;
    credits_consumed?: number | null;
    credits_expired?: number | null;
    period_start?: string | null;
    period_end?: string | null;
  } | null;
  const granted = walletRow?.credits_granted ?? null;
  const reserved = walletRow?.credits_reserved ?? 0;
  const used = walletRow?.credits_consumed ?? 0;
  const expired = walletRow?.credits_expired ?? 0;
  const remaining = granted == null ? null : Math.max(0, granted - reserved - used - expired);
  const brand = (brandKit ?? null) as { source_url?: string | null; review_status?: string | null } | null;
  const metaIsBound = connections.some(
    (connection) => connection.provider === "meta" && connection.status !== "not_connected",
  );

  return (
    <main className="mx-auto w-full max-w-[880px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16" aria-label="Settings">
      <header className="mb-5">
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] md:text-[27px]">{niche.copy.settings.title}</h1>
      </header>
      <SettingsView
        user={{ id: access.userId, email: p?.email ?? "" }}
        profile={{
          fullName: p?.full_name ?? "",
          phone: typeof userMetadata.phone === "string" ? userMetadata.phone : "",
          timezone:
            typeof userMetadata.timezone === "string"
              ? userMetadata.timezone
              : Intl.DateTimeFormat().resolvedOptions().timeZone,
          emailVerified: Boolean(authUser?.email_confirmed_at),
          notificationPreferences: p?.notification_preferences ?? {},
        }}
        workspace={{
          id: access.workspaceId,
          name: w?.name ?? access.workspaceName ?? "Workspace",
          region: w?.region ?? access.region ?? "AU",
          country: w?.country_code ?? w?.region ?? access.region ?? "AU",
          currency: w?.billing_currency ?? (w?.country_code === "US" ? "USD" : "AUD"),
          website: brand?.source_url ?? "",
          brandPackStatus: brand?.review_status ?? null,
          marketBound: Boolean(w?.billing_checkout_completed_at || w?.stripe_customer_id || metaIsBound),
          approvalRequiredByDefault: Boolean(w?.approval_required_by_default),
          billingEmail: w?.billing_email ?? "",
          stripeCustomerId: w?.stripe_customer_id ?? null,
          subscriptionStatus: w?.stripe_subscription_status ?? null,
          billingAccessState: w?.billing_access_state ?? "unbilled",
          billingPeriodStart: w?.stripe_current_period_start ?? walletRow?.period_start ?? null,
          billingPeriodEnd: w?.stripe_current_period_end ?? walletRow?.period_end ?? null,
          cancelAtPeriodEnd: Boolean(w?.stripe_cancel_at_period_end),
          latestInvoiceStatus: w?.stripe_latest_invoice_status ?? null,
          latestInvoiceAmountPaid: w?.stripe_latest_invoice_amount_paid ?? null,
        }}
        usage={{
          granted,
          used,
          reserved,
          remaining,
          periodStart: walletRow?.period_start ?? null,
          periodEnd: walletRow?.period_end ?? null,
        }}
        bookingState={
          activation.record.onboarding_completed_at
            ? "completed"
            : activation.record.onboarding_booked_at
              ? "booked"
              : activation.operatorBlockers.includes("booking_source_unavailable")
                ? "unavailable"
                : "not_booked"
        }
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
        invitations={invitations}
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
