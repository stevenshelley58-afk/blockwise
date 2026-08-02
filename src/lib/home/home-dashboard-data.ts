import type { HomeData } from "@/components/self-serve/home-dashboard";
import { resolveCustomerActivation } from "@/lib/activation/customer-activation";
import { loadReportingSnapshot } from "@/lib/meta-monitor/reporting-snapshots";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type HomeSafeReadModel = Pick<
  HomeData,
  | "workspaceName"
  | "hasBrand"
  | "hasProvider"
  | "activation"
  | "meta"
  | "booking"
  | "ads"
  | "performance"
>;

export async function loadHomeDashboardData(input: {
  supabase: SupabaseServerClient;
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  workspaceName?: string | null;
}): Promise<{
  data: HomeData;
  safe: HomeSafeReadModel;
  reportingNeedsRefresh: boolean;
  reportingGeneratedAt: string;
}> {
  const [campaigns, brandKits, connections, workspace, wallet, activation, reporting] =
    await Promise.all([
      input.supabase
        .from("adstudio_campaigns")
        .select("id, created_at, template_key")
        .eq("workspace_id", input.workspaceId),
      input.supabase
        .from("adstudio_brand_kits")
        .select("business_name, colours_json, source_url, review_status")
        .eq("workspace_id", input.workspaceId)
        .limit(1),
      input.supabase
        .from("provider_connections")
        .select("id, provider, status, external_account_name, updated_at")
        .eq("workspace_id", input.workspaceId)
        .neq("status", "revoked"),
      input.supabase.from("workspaces").select("*").eq("id", input.workspaceId).maybeSingle(),
      input.supabase
        .from("workspace_credit_wallets")
        .select("*")
        .eq("workspace_id", input.workspaceId)
        .eq("status", "active")
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle(),
      resolveCustomerActivation({
        workspaceId: input.workspaceId,
        serviceSupabase: input.serviceSupabase,
      }),
      loadReportingSnapshot({
        supabase: input.supabase,
        workspaceId: input.workspaceId,
        range: "last_30",
      }).catch(() => null),
    ]);

  const results = reporting?.snapshot.payload ?? null;
  const brandKit = brandKits.data?.[0] ?? null;
  const workspaceName = input.workspaceName?.trim() || "Workspace";
  const connectionRows = (connections.data ?? []) as Array<{
    provider?: string | null;
    status?: string | null;
    external_account_name?: string | null;
  }>;
  const metaConnection = connectionRows.find((row) => row.provider === "meta") ?? null;
  const campaignRows = (campaigns.data ?? []) as Array<{
    id: string;
    created_at: string | null;
  }>;
  const weekAgo = Date.now() - 7 * 86_400_000;
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
  const workspaceRow = (workspace.data ?? {}) as Record<string, unknown>;
  const live =
    results && results.source === "live" && results.connected && results.summary
      ? {
          leads: results.summary.leads,
          spend: results.summary.spend,
          previousLeads: results.summary.previousPeriod?.leads ?? null,
          previousSpend: results.summary.previousPeriod?.spend ?? null,
          daily: results.daily.map((point: { date: string; leads: number }) => ({ date: point.date, leads: point.leads })),
          adsLive: results.ads.filter((ad: { status: string }) => ad.status === "ACTIVE").length,
        }
      : null;

  const safe: HomeSafeReadModel = {
    workspaceName,
    hasBrand: Boolean(brandKit?.business_name?.trim()),
    hasProvider: connectionRows.length > 0,
    activation: {
      currentStage: activation.currentStage,
      nextAction: activation.nextAction,
      resumePath: activation.resumePath,
      completed: activation.progress.completed,
      total: activation.progress.total,
      milestones: activation.progress.milestones,
      foundationAvailable: !activation.operatorBlockers.includes("activation_foundation_unavailable"),
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
      created: campaignRows.length,
      live: live?.adsLive ?? null,
      publishedThisWeek: campaignRows.filter((row) => {
        const createdAt = row.created_at ? new Date(row.created_at).getTime() : Number.NaN;
        return Number.isFinite(createdAt) && createdAt >= weekAgo;
      }).length,
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
  const periodEnd =
    typeof workspaceRow.stripe_current_period_end === "string"
      ? workspaceRow.stripe_current_period_end
      : walletRow?.period_end ?? null;
  const data: HomeData = {
    ...safe,
    credits: {
      granted: creditsGranted,
      used: creditsUsed,
      reserved: creditsReserved,
      remaining:
        creditsGranted == null
          ? null
          : Math.max(0, creditsGranted - creditsReserved - creditsUsed - creditsExpired),
      entitlementType: walletRow?.entitlement_type ?? "trial",
      periodStart: walletRow?.period_start ?? null,
      periodEnd: walletRow?.period_end ?? null,
    },
    plan: {
      accessState: String(
        workspaceRow.billing_access_state ?? workspaceRow.stripe_subscription_status ?? "unbilled",
      ),
      currency: String(workspaceRow.billing_currency ?? "AUD"),
      periodEnd,
      cancelAtPeriodEnd: workspaceRow.stripe_cancel_at_period_end === true,
      latestInvoiceStatus:
        typeof workspaceRow.stripe_latest_invoice_status === "string"
          ? workspaceRow.stripe_latest_invoice_status
          : null,
    },
  };

  return {
    data,
    safe,
    reportingNeedsRefresh: reporting?.needsRefresh ?? false,
    reportingGeneratedAt: new Date().toISOString(),
  };
}

export function mergeHomeSafeReadModel(
  current: HomeData,
  safe: HomeSafeReadModel,
): HomeData {
  return { ...current, ...safe };
}

export function homeSafeReadModelFromData(data: HomeData): HomeSafeReadModel {
  return {
    workspaceName: data.workspaceName,
    hasBrand: data.hasBrand,
    hasProvider: data.hasProvider,
    activation: data.activation,
    meta: data.meta,
    booking: data.booking,
    ads: data.ads,
    performance: data.performance,
  };
}
