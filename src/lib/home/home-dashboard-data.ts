import type { HomeData } from "@/components/self-serve/home-dashboard";
import { resolveCustomerActivation } from "@/lib/activation/customer-activation";
import { loadReportingSnapshot } from "@/lib/meta-monitor/reporting-snapshots";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import { listTemplates } from "@/lib/adstudio/pack-gallery";
import { buildHomeCreativeSuggestions, type HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import { homePerformanceFromReporting, mergeHomeSafeReadModel, type HomeSafeReadModel } from "@/lib/home/home-safe-read-model";
import { leadSourceLabel } from "@/lib/leads/rows";
import { loadPublicAdRadarCards } from "@/lib/research/public-ad-radar";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

// The read-model contract lives in a client-safe module; re-exported here so
// existing server-side importers keep one import site.
export { mergeHomeSafeReadModel, homePerformanceFromReporting, homeSafeReadModelFromData, type HomeSafeReadModel } from "@/lib/home/home-safe-read-model";

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
  const [campaigns, customerAds, brandKits, connections, workspace, wallet, activation, reporting, templates, leadsResult, perthAdsResult] =
    await Promise.all([
      input.supabase
        .from("adstudio_campaigns")
        .select("id, created_at, template_key")
        .eq("workspace_id", input.workspaceId),
      input.supabase.from("ad_customer_ads").select("template_id").eq("workspace_id", input.workspaceId),
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
      listTemplates(input.supabase).catch(() => null),
      Promise.resolve(
        input.supabase
          .from("leads")
          .select("id,full_name,suburb,provider,created_at")
          .eq("workspace_id", input.workspaceId)
          .order("created_at", { ascending: false })
          .limit(5),
      )
        .then(({ data }) =>
          (data ?? []).map((row) => ({
            id: row.id,
            name: row.full_name ?? "Unknown lead",
            suburb: row.suburb ?? "Unknown",
            source: leadSourceLabel(row.provider),
            createdAt: row.created_at ?? new Date(0).toISOString(),
          })),
        )
        .catch(() => []),
      Promise.resolve(
        loadPublicAdRadarCards(input.serviceSupabase, {
          location: "Perth, WA",
          limit: 4,
          sort: "recent",
        }),
      )
        .then((res) =>
          res.ads.map((ad) => ({
            id: ad.id,
            pageName: ad.pageName,
            headline: ad.headline,
            suburb: ad.suburb,
            state: ad.state,
            imageUrl: ad.media[0]?.url ?? null,
          })),
        )
        .catch(() => []),
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
    template_key?: string | null;
  }>;
  const customerAdRows = (customerAds.data ?? []) as Array<{ template_id?: string | null }>;
  const usageReadSucceeded = !campaigns.error && !customerAds.error && templates !== null;
  const usedTemplateIds = new Set<string>([
    ...campaignRows.map((row) => row.template_key?.trim() ?? "").filter(Boolean),
    ...customerAdRows.map((row) => row.template_id?.trim() ?? "").filter(Boolean),
  ]);
  const creativeSuggestions: HomeCreativeSuggestions = buildHomeCreativeSuggestions({ templates: templates ?? [], usedTemplateIds, hasCreatedAds: campaignRows.length > 0 || customerAdRows.length > 0, usageReadSucceeded });
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
  const live = homePerformanceFromReporting(results);

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
    performance: live?.performance ?? null,
    creativeSuggestions,
    leads: leadsResult,
    perthAds: perthAdsResult,
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

