/**
 * Read-only customer snapshot for the owner CRM boundary.
 *
 * This module mirrors authoritative Blockwise facts. It never derives an
 * entitlement, interprets a provider event, grants access, delivers leads, or
 * writes CRM, billing, or provider state.
 */

export const OWNER_CRM_SNAPSHOT_INTERNAL_SCOPE = "owner-crm.customer-snapshot";
export const OWNER_CRM_SNAPSHOT_MAX_PAGE_SIZE = 100;
export const OWNER_CRM_SNAPSHOT_DEFAULT_PAGE_SIZE = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OwnerCrmSnapshotPageRequest = {
  afterWorkspaceId: string | null;
  limit: number;
};

export type OwnerCrmSnapshotRpcRow = {
  workspace_id: string;
  billing_access_state: string | null;
  stripe_subscription_status: string | null;
  trial_state: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  source_observed_at: string;
  owner_profile_id: string | null;
  owner_full_name: string | null;
  owner_email: string | null;
  owner_count: number | null;
  owner_profile_workspace_count: number | null;
  owner_matches_created_by: boolean | null;
  owner_email_verified_at: string | null;
  marketing_consent_event_id: string | null;
  marketing_consent_granted: boolean | null;
  marketing_consent_occurred_at: string | null;
  marketing_consent_policy_version: string | null;
};

export type OwnerCrmCustomerSnapshot = {
  workspaceId: string;
  owner: {
    profileId: string;
    name: string | null;
    email: string;
  } | null;
  billingAccessState: string | null;
  stripeSubscriptionStatus: string | null;
  trial: {
    state: string | null;
    startedAt: string | null;
    endsAt: string | null;
  };
  marketingConsent: { eventId: string; granted: boolean; occurredAt: string; policyVersion: string } | null;
  ownerEmailVerifiedAt: string | null;
  mappingAmbiguities: string[];
  sourceObservedAt: string;
};

export type OwnerCrmCustomerSnapshotPage = {
  items: OwnerCrmCustomerSnapshot[];
  nextAfterWorkspaceId: string | null;
  sourceObservedAt: string | null;
};

export type OwnerCrmSnapshotRpcClient = {
  rpc: (
    functionName: string,
    args: { p_after_workspace_id: string | null; p_limit: number },
  ) => PromiseLike<{ data: OwnerCrmSnapshotRpcRow[] | null; error: { message: string } | null }>;
};

export function parseOwnerCrmSnapshotPageRequest(searchParams: URLSearchParams): OwnerCrmSnapshotPageRequest {
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit === null || rawLimit === ""
    ? OWNER_CRM_SNAPSHOT_DEFAULT_PAGE_SIZE
    : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > OWNER_CRM_SNAPSHOT_MAX_PAGE_SIZE) {
    throw new Error("invalid_page_limit");
  }

  const afterWorkspaceId = searchParams.get("afterWorkspaceId");
  if (afterWorkspaceId !== null && !UUID_PATTERN.test(afterWorkspaceId)) {
    throw new Error("invalid_page_cursor");
  }

  return { afterWorkspaceId, limit };
}

export async function readOwnerCrmCustomerSnapshotPage(
  client: OwnerCrmSnapshotRpcClient,
  request: OwnerCrmSnapshotPageRequest,
): Promise<OwnerCrmCustomerSnapshotPage> {
  const { data, error } = await client.rpc("owner_crm_customer_snapshot_page", {
    p_after_workspace_id: request.afterWorkspaceId,
    p_limit: request.limit,
  });
  if (error) throw new Error(`owner_crm_snapshot_read_failed: ${error.message}`);

  const rows = data ?? [];
  return {
    items: rows.map(mapOwnerCrmSnapshotRow),
    // The RPC is bounded to p_limit rows. A final empty page is preferable to
    // over-reading a customer record merely to learn whether another exists.
    nextAfterWorkspaceId: rows.length === request.limit ? rows.at(-1)?.workspace_id ?? null : null,
    sourceObservedAt: rows.at(0)?.source_observed_at ?? null,
  };
}

export function mapOwnerCrmSnapshotRow(row: OwnerCrmSnapshotRpcRow): OwnerCrmCustomerSnapshot {
  const mappingAmbiguities = ownerAmbiguities(row);
  return {
    workspaceId: row.workspace_id,
    owner: mappingAmbiguities.some((ambiguity) => ambiguity.startsWith("owner_"))
      ? null
      : row.owner_profile_id && row.owner_email
        ? { profileId: row.owner_profile_id, name: row.owner_full_name, email: row.owner_email }
        : null,
    billingAccessState: row.billing_access_state,
    stripeSubscriptionStatus: row.stripe_subscription_status,
    trial: {
      state: row.trial_state,
      startedAt: row.trial_started_at,
      endsAt: row.trial_ends_at,
    },
    ownerEmailVerifiedAt: row.owner_email_verified_at,
    marketingConsent: row.marketing_consent_event_id && row.marketing_consent_granted !== null && row.marketing_consent_occurred_at && row.marketing_consent_policy_version ? { eventId: row.marketing_consent_event_id, granted: row.marketing_consent_granted, occurredAt: row.marketing_consent_occurred_at, policyVersion: row.marketing_consent_policy_version } : null,
    mappingAmbiguities,
    sourceObservedAt: row.source_observed_at,
  };
}

function ownerAmbiguities(row: OwnerCrmSnapshotRpcRow): string[] {
  const ownerCount = row.owner_count ?? 0;
  if (ownerCount === 0) return ["owner_missing"];
  if (ownerCount > 1) return ["owner_multiple_memberships"];
  if (!row.owner_profile_id || !row.owner_email) return ["owner_profile_missing"];
  if ((row.owner_profile_workspace_count ?? 0) !== 1) return ["owner_profile_multiple_workspaces"];
  if (row.owner_matches_created_by === false) return ["owner_creator_mismatch"];
  return [];
}
