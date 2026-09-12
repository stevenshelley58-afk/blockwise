import { DEFAULT_META_GRAPH_VERSION } from "./meta-graph-version.ts";
import type { MetaPublishPlan } from "./meta-execution.ts";

export type PublishDeliveryState = {
  deliveryStatus: "in_review" | "scheduled" | "pending" | "needs_attention";
  metaStatus: { campaign: string; adSets: string; ads: string };
};
export function summarizeMetaDelivery(rows: Array<{ configured_status?: string; effective_status?: string }>, startTime?: string | null): PublishDeliveryState["deliveryStatus"] {
  const statuses = rows.map(row => row.effective_status?.toUpperCase());
  if (!rows.length || statuses.some(status => !status)) return "pending";
  if (statuses.some(status => ["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED"].includes(status!))) return "needs_attention";
  if (statuses.some(status => ["PENDING_REVIEW", "IN_PROCESS"].includes(status!))) return "in_review";
  if (startTime && Date.parse(startTime) > Date.now()) return "scheduled";
  // ACTIVE is configuration/delivery eligibility, not proof of impressions.
  return "pending";
}
function label(rows: Array<{ configured_status?: string; effective_status?: string }>): string {
  if (!rows.length) return "Not confirmed";
  if (rows.some(row => row.configured_status !== "ACTIVE")) return "Needs attention";
  if (rows.some(row => ["PENDING_REVIEW", "IN_PROCESS"].includes(row.effective_status ?? ""))) return "On · in review";
  if (rows.some(row => ["DISAPPROVED", "WITH_ISSUES", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PAUSED", "ARCHIVED", "DELETED"].includes(row.effective_status ?? ""))) return "Needs attention";
  return "On";
}
/** Read-only, provider-confirmed configuration. Never manufacture Live from ACTIVE. */
export async function readMetaPublishDelivery(input: { plan: MetaPublishPlan; accessToken: string; fetchImpl?: typeof fetch }): Promise<PublishDeliveryState> {
  const { plan } = input;
  const campaign = plan.reconciledObjects.campaignId;
  const adSets = Object.values(plan.reconciledObjects.adSetIds);
  const ads = Object.values(plan.reconciledObjects.adIds);
  const ids = [...new Set([campaign, ...adSets, ...ads].filter((id): id is string => Boolean(id)))];
  if (!campaign || !ads.length || ids.length > 50) throw new Error("Publish objects are incomplete.");
  const url = new URL("https://graph.facebook.com/" + DEFAULT_META_GRAPH_VERSION + "/");
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("fields", "id,account_id,configured_status,effective_status");
  const response = await (input.fetchImpl ?? fetch)(url, {
    headers: { Authorization: "Bearer " + input.accessToken }, cache: "no-store", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Meta status could not be refreshed.");
  const body = await response.json() as Record<string, { id?: string; account_id?: string; configured_status?: string; effective_status?: string }>;
  for (const id of ids) {
    if (body[id]?.id !== id || body[id]?.account_id?.replace(/^act_/, "") !== plan.setup.metaAdAccountId.replace(/^act_/, "")) throw new Error("Meta status ownership could not be verified.");
  }
  return {
    deliveryStatus: summarizeMetaDelivery(ids.map(id => body[id]), plan.controls.schedule?.startTime),
    metaStatus: { campaign: label([body[campaign]]), adSets: label(adSets.map(id => body[id])), ads: label(ads.map(id => body[id])) },
  };
}
