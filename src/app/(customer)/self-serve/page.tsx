import * as Sentry from "@sentry/nextjs";

import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { HomeDashboard, type HomeData } from "@/components/self-serve/home-dashboard";
import { resolveCustomerActivation } from "@/lib/activation/customer-activation";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getResultsPayload } from "@/lib/meta-monitor/getResultsPayload";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export default async function SelfServeHome() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");
  const serviceSupabase = createSupabaseServiceClient();

  const [dashboardRows, results] = await Promise.all([
    Sentry.startSpan(
      {
        name: "Load Home database read model",
        op: "db.home_dashboard",
        attributes: { "workspace.id": access.workspaceId },
      },
      () =>
        Promise.all([
          supabase
            .from("adstudio_campaigns")
            .select("id, created_at, template_key")
            .eq("workspace_id", access.workspaceId),
          supabase
            .from("adstudio_brand_kits")
            .select("business_name, colours_json, source_url, review_status")
            .eq("workspace_id", access.workspaceId)
            .limit(1),
          supabase
            .from("provider_connections")
            .select("id, provider, status, external_account_name, updated_at")
            .eq("workspace_id", access.workspaceId)
            .neq("status", "revoked"),
          supabase.from("workspaces").select("*").eq("id", access.workspaceId).maybeSingle(),
          supabase
            .from("workspace_credit_wallets")
            .select("*")
            .eq("workspace_id", access.workspaceId)
            .eq("status", "active")
            .order("period_end", { ascending: false })
            .limit(1)
            .maybeSingle(),
          resolveCustomerActivation({
            workspaceId: access.workspaceId,
            serviceSupabase,
          }),
        ]),
    ),
    Sentry.startSpan(
      {
        name: "Load Home Meta reporting",
        op: "provider.meta",
        attributes: { "workspace.id": access.workspaceId },
      },
      () =>
        getResultsPayload({
          supabase,
          serviceSupabase,
          workspaceId: access.workspaceId,
          range: "last_30",
        }).catch(() => null),
    ),
  ]);
  const [campaigns, brandKits, connections, workspace, wallet, activation] = dashboardRows;

  const brandKit = brandKits.data?.[0] ?? null;
  const workspaceName = access.workspaceName?.trim() || "Workspace";
  const hasBrand = Boolean(brandKit?.business_name?.trim());
  const connectionRows = (connections.data ?? []) as Array<{
    provider?: string | null;
    status?: string | null;
    external_account_name?: string | null;
    updated_at?: string | null;
  }>;
  const metaConnection = connectionRows.find((row) => row.provider === "meta") ?? null;
  const hasProvider = connectionRows.length > 0;

  const campaignRows = (campaigns.data ?? []) as Array<{
    id: string;
    created_at: string | null;
    template_key?: string | null;
  }>;
  const adsCreated = campaignRows.length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const publishedThisWeek = campaignRows.filter((row) => {
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : Number.NaN;
    return Number.isFinite(createdAt) && createdAt >= weekAgo;
  }).length;

  const walletRow = (wallet.data ?? null) as {
    entitlement_type?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    credits_granted?: number | null;
    credits_reserved?: number | null;
    credits_consumed?: number | null;
    credits_expired?: number | null;
  } | null;
  const creditsGranted = walletRow?.credits_granted ?? null;
  const creditsReserved = walletRow?.credits_reserved ?? 0;
  const creditsUsed = walletRow?.credits_consumed ?? 0;
  const creditsExpired = walletRow?.credits_expired ?? 0;
  const creditsRemaining =
    creditsGranted == null
      ? null
      : Math.max(0, creditsGranted - creditsReserved - creditsUsed - creditsExpired);

  const workspaceRow = (workspace.data ?? {}) as Record<string, unknown>;
  const billingAccessState = String(
    workspaceRow.billing_access_state ?? workspaceRow.stripe_subscription_status ?? "unbilled",
  );
  const billingCurrency = String(workspaceRow.billing_currency ?? "AUD");
  const periodEnd =
    typeof workspaceRow.stripe_current_period_end === "string"
      ? workspaceRow.stripe_current_period_end
      : walletRow?.period_end ?? null;

  // Live Meta reporting only — Home never shows demo numbers. When the
  // account is not connected (or reporting fails) the KPIs render honest
  // zeros and the chart renders its empty state.
  const live =
    results && results.source === "live" && results.connected && results.summary
      ? {
          leads: results.summary.leads,
          spend: results.summary.spend,
          previousLeads: results.summary.previousPeriod?.leads ?? null,
          previousSpend: results.summary.previousPeriod?.spend ?? null,
          daily: results.daily.map((point) => ({ date: point.date, leads: point.leads })),
          adsLive: results.ads.filter((ad) => ad.status === "ACTIVE").length,
        }
      : null;

  const data: HomeData = {
    workspaceName,
    hasBrand,
    hasProvider,
    activation: {
      currentStage: activation.currentStage,
      nextAction: activation.nextAction,
      resumePath: activation.resumePath,
      completed: activation.progress.completed,
      total: activation.progress.total,
      milestones: activation.progress.milestones,
      foundationAvailable: !activation.operatorBlockers.includes("activation_foundation_unavailable"),
    },
    credits: {
      granted: creditsGranted,
      used: creditsUsed,
      reserved: creditsReserved,
      remaining: creditsRemaining,
      entitlementType: walletRow?.entitlement_type ?? "trial",
      periodStart: walletRow?.period_start ?? null,
      periodEnd: walletRow?.period_end ?? null,
    },
    plan: {
      accessState: billingAccessState,
      currency: billingCurrency,
      periodEnd,
      cancelAtPeriodEnd: workspaceRow.stripe_cancel_at_period_end === true,
      latestInvoiceStatus:
        typeof workspaceRow.stripe_latest_invoice_status === "string"
          ? workspaceRow.stripe_latest_invoice_status
          : null,
    },
    meta: {
      state: metaConnection?.status ?? "not_connected",
      accountName: metaConnection?.external_account_name ?? null,
    },
    booking: {
      state: activation.record.onboarding_completed_at
        ? "completed"
        : activation.record.onboarding_booked_at
          ? "booked"
          : activation.operatorBlockers.includes("booking_source_unavailable")
            ? "unavailable"
            : "not_booked",
    },
    ads: {
      created: adsCreated,
      live: live?.adsLive ?? null,
      publishedThisWeek,
    },
    performance: live
      ? {
          leads: live.leads,
          cpl: live.leads > 0 ? live.spend / live.leads : null,
          previousLeads: live.previousLeads,
          previousCpl:
            live.previousLeads && live.previousLeads > 0 && live.previousSpend != null
              ? live.previousSpend / live.previousLeads
              : null,
          daily: live.daily,
        }
      : null,
  };

  return (
    <>
      <ConfirmRegistrationTracker />
      <HomeDashboard data={data} />
    </>
  );
}
