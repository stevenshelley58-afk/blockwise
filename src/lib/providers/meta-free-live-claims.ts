import type { createSupabaseServiceClient } from "../supabase/service.ts";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type MetaFreeLiveClaimIdentity = {
  metaBusinessId: string;
  metaAdAccountId: string;
};

export type MetaFreeLiveClaimResult = {
  allowed: boolean;
  reason: string;
  claimId: string;
  status: "available" | "reserved" | "consumed";
  mutationKey: string;
};

type ClaimRpcRow = {
  allowed?: boolean;
  consumed?: boolean;
  released?: boolean;
  reason: string;
  claim_id: string;
  status: MetaFreeLiveClaimResult["status"];
  mutation_key: string;
};

export function metaFreeLiveReservationKey(planId: string): string {
  return `meta-free-live:${planId}`;
}

export async function reserveMetaFreeLiveClaim(input: {
  service: ServiceClient;
  workspaceId: string;
  planId: string;
  identity: MetaFreeLiveClaimIdentity;
  reservationKey: string;
  mutationKey: string;
}): Promise<MetaFreeLiveClaimResult> {
  const identity = normalizeIdentity(input.identity);
  const { data, error } = await input.service.rpc("reserve_meta_free_live_claim", {
    p_workspace_id: input.workspaceId,
    p_meta_business_id: identity.metaBusinessId,
    p_meta_ad_account_id: identity.metaAdAccountId,
    p_plan_id: input.planId,
    p_reservation_key: requiredKey(input.reservationKey),
    p_mutation_key: requiredKey(input.mutationKey),
  });
  if (error) throw new Error(`Free live-campaign claim could not be reserved: ${error.message}`);
  const row = firstRow(data);
  return normalizeResult(row, row.allowed === true);
}

export async function consumeMetaFreeLiveClaim(input: {
  service: ServiceClient;
  workspaceId: string;
  planId: string;
  identity: MetaFreeLiveClaimIdentity;
  reservationKey: string;
  mutationKey: string;
}): Promise<MetaFreeLiveClaimResult> {
  const identity = normalizeIdentity(input.identity);
  const { data, error } = await input.service.rpc("consume_meta_free_live_claim", {
    p_workspace_id: input.workspaceId,
    p_meta_business_id: identity.metaBusinessId,
    p_meta_ad_account_id: identity.metaAdAccountId,
    p_plan_id: input.planId,
    p_reservation_key: requiredKey(input.reservationKey),
    p_mutation_key: requiredKey(input.mutationKey),
  });
  if (error) throw new Error(`Free live-campaign claim could not be consumed: ${error.message}`);
  const row = firstRow(data);
  return normalizeResult(row, row.consumed === true);
}

export async function releaseMetaFreeLiveClaim(input: {
  service: ServiceClient;
  workspaceId: string;
  planId: string;
  identity: MetaFreeLiveClaimIdentity;
  reservationKey: string;
  mutationKey: string;
}): Promise<MetaFreeLiveClaimResult> {
  const identity = normalizeIdentity(input.identity);
  const { data, error } = await input.service.rpc("release_meta_free_live_claim", {
    p_workspace_id: input.workspaceId,
    p_meta_business_id: identity.metaBusinessId,
    p_meta_ad_account_id: identity.metaAdAccountId,
    p_plan_id: input.planId,
    p_reservation_key: requiredKey(input.reservationKey),
    p_mutation_key: requiredKey(input.mutationKey),
  });
  if (error) throw new Error(`Free live-campaign claim could not be released: ${error.message}`);
  const row = firstRow(data);
  return normalizeResult(row, row.released === true);
}

export function resolveMetaFreeLiveClaimIdentity(input: {
  metadata: Record<string, unknown> | null | undefined;
  fallbackAdAccountId?: string | null;
}): MetaFreeLiveClaimIdentity {
  const metadata = input.metadata ?? {};
  const meta = objectValue(metadata.meta) ?? metadata;
  const metaBusinessId = stringValue(meta.metaBusinessId) ?? stringValue(meta.businessId);
  const metaAdAccountId =
    stringValue(meta.metaAdAccountId) ??
    stringValue(meta.adAccountId) ??
    stringValue(input.fallbackAdAccountId);

  if (!metaBusinessId || !metaAdAccountId) {
    throw new Error(
      "Reconnect Meta so Blockwise can verify the Business Portfolio and ad account for the free live-campaign setup.",
    );
  }

  return normalizeIdentity({ metaBusinessId, metaAdAccountId });
}

function normalizeIdentity(identity: MetaFreeLiveClaimIdentity): MetaFreeLiveClaimIdentity {
  const metaBusinessId = requiredKey(identity.metaBusinessId).toLowerCase();
  const metaAdAccountId = requiredKey(identity.metaAdAccountId).replace(/^act_/i, "").toLowerCase();
  return { metaBusinessId, metaAdAccountId };
}

function normalizeResult(row: ClaimRpcRow, allowed: boolean): MetaFreeLiveClaimResult {
  if (!row.claim_id || !row.reason || !row.status || !row.mutation_key) {
    throw new Error("Free live-campaign claim returned an incomplete result.");
  }
  return {
    allowed,
    reason: row.reason,
    claimId: row.claim_id,
    status: row.status,
    mutationKey: row.mutation_key,
  };
}

function firstRow(value: unknown): ClaimRpcRow {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") {
    throw new Error("Free live-campaign claim returned no result.");
  }
  return row as ClaimRpcRow;
}

function requiredKey(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Free live-campaign claim keys are required.");
  return normalized;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
