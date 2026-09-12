import type { HomeData } from "@/components/self-serve/home-dashboard";
import { niche } from "@/config/niche";
import { resolveCustomerActivation } from "@/lib/activation/customer-activation";
import { loadReportingSnapshot } from "@/lib/meta-monitor/reporting-snapshots";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import { listTemplates } from "@/lib/adstudio/pack-gallery";
import { buildHomeCreativeSuggestions, type HomeCreativeSuggestions } from "@/lib/home/creative-suggestions";
import { homePerformanceFromReporting, mergeHomeSafeReadModel, type HomeSafeReadModel } from "@/lib/home/home-safe-read-model";
import { homeLocalAdCandidates, HOME_LOCAL_AD_LIMIT, toHomeLocalAds } from "@/lib/home/home-local-ads";
import { sampleHomeLeads } from "@/lib/leads/sample-crm-leads";
import { leadSourceLabel } from "@/lib/leads/rows";
import { resolveBrandPackLocation } from "@/lib/research/brand-pack-suburb";
import { loadPublicAdRadarCards } from "@/lib/research/public-ad-radar";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;
type BrandKitRow = {
  business_name?: string | null;
  colours_json?: unknown;
  source_url?: string | null;
  review_status?: string | null;
  contact_json?: { address?: string | null } | null;
};

/** How many candidates the radar read returns for Home to choose from. */
const LOCAL_AD_POOL = 24;

/**
 * How long a thumbnail verdict is trusted, and the most verdicts kept.
 *
 * An archived creative that answered once does not need checking again on the
 * next page view, and a verdict is only ever a hint: the browser still asks for
 * the image itself.
 */
const THUMBNAIL_VERDICT_TTL_MS = 60 * 60 * 1000;
const THUMBNAIL_VERDICT_LIMIT = 500;
const thumbnailVerdicts = new Map<string, { loads: boolean; checkedAt: number }>();

/**
 * Whether the still at this URL actually answers.
 *
 * A card whose archived object has gone missing still carries its URL, so
 * "has an image" is not the same as "has a thumbnail", and a row of empty tiles
 * is what Home looked like before this check. Verdicts are held in this process
 * for an hour so a page view does not pay for the same check twice.
 */
async function thumbnailLoads(url: string): Promise<boolean> {
  const cached = thumbnailVerdicts.get(url);
  const now = Date.now();
  if (cached && now - cached.checkedAt < THUMBNAIL_VERDICT_TTL_MS) return cached.loads;

  let loads = false;
  try {
    loads = (await fetch(url, { method: "HEAD", cache: "no-store" })).ok;
  } catch {
    loads = false;
  }

  if (thumbnailVerdicts.size >= THUMBNAIL_VERDICT_LIMIT) {
    for (const [key, verdict] of thumbnailVerdicts) {
      if (now - verdict.checkedAt >= THUMBNAIL_VERDICT_TTL_MS) thumbnailVerdicts.delete(key);
    }
  }
  thumbnailVerdicts.set(url, { loads, checkedAt: now });
  return loads;
}

/**
 * Home's local-ads list, keyed on the workspace's own area.
 *
 * The Brand Pack address carries the postcode when the customer's website gave
 * one, and a postcode is the strongest Ad Radar search key there is. Until the
 * address yields one, Home falls back to the niche's default area rather than
 * showing no list at all. More cards are read than Home shows, because the ones
 * worth showing are not always the most recent, and each candidate's still is
 * checked before it is offered a row.
 */
async function loadHomeLocalAds(
  serviceSupabase: SupabaseServiceClient,
  brandKit: BrandKitRow | null,
): Promise<{ area: HomeData["localAdsArea"]; ads: HomeData["localAds"] }> {
  const copy = niche.copy.home.localAds;
  const brandLocation = resolveBrandPackLocation(brandKit?.contact_json?.address ?? null);
  const area = {
    searchTerm: brandLocation?.searchTerm ?? copy.fallbackArea.searchTerm,
    place: brandLocation?.place ?? copy.fallbackArea.place,
  };
  const response = await loadPublicAdRadarCards(serviceSupabase, {
    location: area.searchTerm,
    limit: LOCAL_AD_POOL,
    sort: "recent",
  });

  const candidates = homeLocalAdCandidates(response.ads);
  const verified = await Promise.all(candidates.map((candidate) => thumbnailLoads(candidate.imageUrl)));
  // Chosen again from the ones that answered, so the row keeps one ad per
  // advertiser even when a candidate ahead of it was dropped for a dead still.
  const shown = homeLocalAdCandidates(
    candidates.filter((_, index) => verified[index]).map((candidate) => candidate.card),
    HOME_LOCAL_AD_LIMIT,
  );

  return { area, ads: toHomeLocalAds(shown, HOME_LOCAL_AD_LIMIT) };
}

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
  const brandKitsQuery = input.supabase
    .from("adstudio_brand_kits")
    .select("business_name, colours_json, source_url, review_status, contact_json")
    .eq("workspace_id", input.workspaceId)
    .limit(1);
  // A builder re-runs its request on every `then`, so the one brand-kit read is
  // memoised: the dashboard needs the pack itself, and the local-ads list needs
  // the address inside it.
  const brandKitRead = Promise.resolve(brandKitsQuery);

  const [campaigns, customerAds, brandKits, connections, workspace, wallet, activation, reporting, templates, leadsResult, localAdsResult] =
    await Promise.all([
      input.supabase
        .from("adstudio_campaigns")
        .select("id, created_at, template_key")
        .eq("workspace_id", input.workspaceId),
      input.supabase.from("ad_customer_ads").select("template_id").eq("workspace_id", input.workspaceId),
      brandKitRead,
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
      brandKitRead
        .then(({ data }) => loadHomeLocalAds(input.serviceSupabase, (data?.[0] as BrandKitRow | undefined) ?? null))
        .catch(() => ({ area: null, ads: [] })),
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
  // Example leads stand in exactly where the example figures do: a workspace
  // reading a demo has no leads of its own, and a workspace with real delivery
  // but no leads yet keeps saying so.
  const leadsAreExamples = leadsResult.length === 0 && live?.performance.isSample === true;

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
    leads: leadsAreExamples ? sampleHomeLeads() : leadsResult,
    leadsAreExamples,
    localAds: localAdsResult.ads,
    localAdsArea: localAdsResult.area,
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

