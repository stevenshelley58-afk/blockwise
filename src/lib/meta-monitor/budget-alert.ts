import type { createSupabaseServiceClient } from "../supabase/service.ts";
import { fireEvent, formatBudget, formatMoney } from "../mautic/flows.ts";
import type { MetaAdPerformance, MetaMonitorPayload } from "./types.ts";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

type AlertPlanRow = {
  id: string;
  currency: string | null;
  budget_alert_period_key: string | null;
  plan_json: {
    campaign?: { name?: string; budgetMode?: "campaign" | "adset" };
    controls?: { dailyBudgetMinorUnits?: number };
    adSets?: Array<{ localId?: string; dailyBudgetMinorUnits?: number }>;
  } | null;
  reconciled_objects_json: { campaignId?: string } | null;
};

export function campaignPeriodSpendAndBudget(input: {
  ads: MetaAdPerformance[];
  campaignId: string;
  periodDays: number;
  plan: AlertPlanRow["plan_json"];
}): { spendMinorUnits: number; periodBudgetMinorUnits: number; weeklyBudgetMinorUnits: number } | null {
  const campaignAds = input.ads.filter((ad) => ad.campaignId === input.campaignId);
  if (campaignAds.length === 0) return null;

  const spendMinorUnits = Math.round(campaignAds.reduce((sum, ad) => sum + ad.metrics.spend, 0) * 100);
  const liveAdSetBudgets = new Map<string, number>();
  for (const ad of campaignAds) {
    const dollars = ad.management.adsetDailyBudgetDollars;
    if (dollars != null && dollars > 0 && !liveAdSetBudgets.has(ad.adsetId)) {
      liveAdSetBudgets.set(ad.adsetId, Math.round(dollars * 100));
    }
  }

  let dailyBudgetMinorUnits = [...liveAdSetBudgets.values()].reduce((sum, value) => sum + value, 0);
  if (dailyBudgetMinorUnits <= 0) {
    const controlsBudget = Number(input.plan?.controls?.dailyBudgetMinorUnits ?? 0);
    const adSetBudget = (input.plan?.adSets ?? []).reduce(
      (sum, adSet) => sum + Math.max(0, Number(adSet.dailyBudgetMinorUnits ?? 0)),
      0,
    );
    dailyBudgetMinorUnits = input.plan?.campaign?.budgetMode === "campaign"
      ? controlsBudget
      : adSetBudget || controlsBudget;
  }

  if (!Number.isFinite(dailyBudgetMinorUnits) || dailyBudgetMinorUnits <= 0) return null;
  const periodDays = Math.max(1, Math.floor(input.periodDays));
  return {
    spendMinorUnits,
    periodBudgetMinorUnits: Math.round(dailyBudgetMinorUnits * periodDays),
    weeklyBudgetMinorUnits: Math.round(dailyBudgetMinorUnits * 7),
  };
}

export async function queueBudgetAlerts(input: {
  serviceSupabase: SupabaseServiceClient;
  workspaceId: string;
  payload: MetaMonitorPayload;
  now?: Date;
  fireEventImpl?: typeof fireEvent;
}): Promise<number> {
  if (
    input.payload.source !== "live"
    || !input.payload.connected
    || input.payload.range.key !== "last_7"
  ) return 0;

  const periodKey = `${input.payload.range.since}:${input.payload.range.until}`;
  const [{ data: workspace, error: workspaceError }, { data: rows, error: plansError }] = await Promise.all([
    input.serviceSupabase
      .from("workspaces")
      .select("billing_email")
      .eq("id", input.workspaceId)
      .maybeSingle(),
    input.serviceSupabase
      .from("meta_publish_plans")
      .select("id,currency,plan_json,reconciled_objects_json,budget_alert_period_key")
      .eq("workspace_id", input.workspaceId)
      .eq("status", "paused_live"),
  ]);
  if (workspaceError) throw new Error(`Budget-alert contact lookup failed: ${workspaceError.message}`);
  if (plansError) throw new Error(`Budget-alert plan lookup failed: ${plansError.message}`);

  const email = (workspace as { billing_email?: string | null } | null)?.billing_email?.trim();
  if (!email) return 0;

  let queued = 0;
  for (const row of (rows ?? []) as AlertPlanRow[]) {
    if (row.budget_alert_period_key === periodKey) continue;
    const campaignId = row.reconciled_objects_json?.campaignId?.trim();
    if (!campaignId) continue;
    const amounts = campaignPeriodSpendAndBudget({
      ads: input.payload.ads,
      campaignId,
      periodDays: input.payload.range.days,
      plan: row.plan_json,
    });
    if (!amounts || amounts.spendMinorUnits < Math.ceil(amounts.periodBudgetMinorUnits * 0.8)) continue;

    const currency = row.currency?.trim() || input.payload.currencyCode;
    const campaignName = row.plan_json?.campaign?.name
      ?? input.payload.ads.find((ad) => ad.campaignId === campaignId)?.campaignName
      ?? "Meta campaign";
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") || "https://blockwise.sale";
    await (input.fireEventImpl ?? fireEvent)({
      email,
      workspaceId: input.workspaceId,
      event: "budget_alert",
      subjectId: `${campaignId}:${periodKey}`,
      campaignName,
      campaignUrl: `${baseUrl}/performance?planId=${encodeURIComponent(row.id)}`,
      spend: formatMoney(amounts.spendMinorUnits, currency),
      budget: formatBudget({ minorUnits: amounts.weeklyBudgetMinorUnits, currency }),
      threshold: "80%",
    });

    const alertedAt = (input.now ?? new Date()).toISOString();
    const { error: updateError } = await input.serviceSupabase
      .from("meta_publish_plans")
      .update({ budget_alert_period_key: periodKey, budget_alerted_at: alertedAt })
      .eq("workspace_id", input.workspaceId)
      .eq("id", row.id);
    if (updateError) throw new Error(`Budget-alert marker could not be saved: ${updateError.message}`);
    queued += 1;
  }

  return queued;
}
