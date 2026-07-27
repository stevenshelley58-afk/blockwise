import { ConfirmRegistrationTracker } from "@/components/confirm-registration-tracker";
import { HomeDashboard, type HomeData } from "@/components/self-serve/home-dashboard";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { getResultsPayload } from "@/lib/meta-monitor/getResultsPayload";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const INCLUDED_AD_PACKS = 10;

export default async function SelfServeHome() {
  const { supabase, access } = await requirePageSurfaceAccess("self_serve");

  const [campaigns, brandKits, connections, results] = await Promise.all([
    supabase
      .from("adstudio_campaigns")
      .select("id, created_at")
      .eq("workspace_id", access.workspaceId),
    supabase
      .from("adstudio_brand_kits")
      .select("business_name, colours_json")
      .eq("workspace_id", access.workspaceId)
      .limit(1),
    supabase
      .from("provider_connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspaceId)
      .neq("status", "revoked"),
    getResultsPayload({
      supabase,
      serviceSupabase: createSupabaseServiceClient(),
      workspaceId: access.workspaceId,
      range: "last_30",
    }).catch(() => null),
  ]);

  const brandKit = brandKits.data?.[0] ?? null;
  const workspaceName = access.workspaceName?.trim() || "Workspace";
  const hasBrand = Boolean(brandKit?.business_name?.trim());
  const hasProvider = (connections.count ?? 0) > 0;

  const campaignRows = (campaigns.data ?? []) as Array<{ id: string; created_at: string | null }>;
  const adsCreated = campaignRows.length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const publishedThisWeek = campaignRows.filter((row) => {
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : Number.NaN;
    return Number.isFinite(createdAt) && createdAt >= weekAgo;
  }).length;

  const usedAdPacks = adsCreated;
  const remainingAdPacks = Math.max(0, INCLUDED_AD_PACKS - usedAdPacks);

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
    packs: {
      used: usedAdPacks,
      included: INCLUDED_AD_PACKS,
      remaining: remainingAdPacks,
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
