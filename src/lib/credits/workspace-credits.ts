import { createSupabaseServiceClient } from "../supabase/service.ts";

type CreditRpcClient = Pick<ReturnType<typeof createSupabaseServiceClient>, "rpc">;

type GrantCreditRpcRow = {
  wallet_id?: string | null;
  mutation_key?: string | null;
  credits_granted?: number | null;
  credits_remaining?: number | null;
  period_end?: string | null;
  entitlement_type?: string | null;
};

export type CreditReservationReason =
  | "reserved"
  | "credit_limit_reached"
  | "entitlement_expired"
  | "no_active_entitlement"
  | string;

type ReserveCreditRpcRow = {
  allowed?: boolean | null;
  reason?: CreditReservationReason | null;
  reservation_id?: string | null;
  wallet_id?: string | null;
  credits_reserved?: number | null;
  credits_remaining?: number | null;
  period_end?: string | null;
  entitlement_type?: string | null;
  mutation_key?: string | null;
};

type CloseCreditRpcRow = {
  reservation_id?: string | null;
  wallet_id?: string | null;
  credits_settled?: number | null;
  credits_refunded?: number | null;
  credits_outstanding?: number | null;
  credits_remaining?: number | null;
  mutation_key?: string | null;
};

export type WorkspaceCreditReservation = {
  workspaceId: string;
  reservationId: string;
  walletId: string;
  mutationKey: string;
  entitlementType: string;
  creditsReserved: number;
  creditsOutstanding: number;
  creditsRemaining: number;
  periodEnd: string | null;
};

export type WorkspaceCreditMutationResult = {
  reservationId: string;
  walletId: string;
  creditsChanged: number;
  creditsOutstanding: number;
  creditsRemaining: number;
  mutationKey: string;
};

export type WorkspaceCreditGrant = {
  walletId: string;
  mutationKey: string;
  creditsGranted: number;
  creditsRemaining: number;
  periodEnd: string;
  entitlementType: string;
};

export class WorkspaceCreditError extends Error {
  readonly reason: CreditReservationReason;

  constructor(message: string, reason: CreditReservationReason) {
    super(message);
    this.name = "WorkspaceCreditError";
    this.reason = reason;
  }
}

export async function grantWorkspaceCredits(input: {
  workspaceId: string;
  entitlementType: "trial" | "paid" | "operator";
  periodKey: string;
  credits: number;
  periodStart: string;
  periodEnd: string;
  mutationKey: string;
  sourceReference?: string | null;
  metadata?: Record<string, unknown>;
  serviceSupabase?: CreditRpcClient;
}): Promise<WorkspaceCreditGrant> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("grant_workspace_credits", {
    p_workspace_id: input.workspaceId,
    p_entitlement_type: input.entitlementType,
    p_period_key: input.periodKey,
    p_credits: input.credits,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_mutation_key: input.mutationKey,
    p_source_reference: input.sourceReference ?? null,
    p_metadata: input.metadata ?? {},
  });
  if (error) throw new Error(`Credit grant failed: ${error.message}`);

  const row = firstRow<GrantCreditRpcRow>(data);
  return {
    walletId: requiredString(row?.wallet_id, "wallet id"),
    mutationKey: requiredString(row?.mutation_key, "mutation key"),
    creditsGranted: numberOrZero(row?.credits_granted),
    creditsRemaining: numberOrZero(row?.credits_remaining),
    periodEnd: requiredString(row?.period_end, "period end"),
    entitlementType: requiredString(row?.entitlement_type, "entitlement type"),
  };
}

function firstRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as T : null;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Credit ledger returned no ${label}.`);
  }
  return value;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function reserveWorkspaceCredits(input: {
  workspaceId: string;
  actorProfileId: string;
  credits: number;
  mutationKey: string;
  purpose: string;
  metadata?: Record<string, unknown>;
  serviceSupabase?: CreditRpcClient;
}): Promise<WorkspaceCreditReservation> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("reserve_workspace_credits", {
    p_workspace_id: input.workspaceId,
    p_actor_profile_id: input.actorProfileId,
    p_credits: input.credits,
    p_mutation_key: input.mutationKey,
    p_purpose: input.purpose,
    p_metadata: input.metadata ?? {},
  });
  if (error) throw new Error(`Credit reservation failed: ${error.message}`);

  const row = firstRow<ReserveCreditRpcRow>(data);
  const reason = row?.reason ?? "credit_reservation_failed";
  if (!row?.allowed) {
    throw new WorkspaceCreditError(creditErrorMessage(reason), reason);
  }

  return {
    workspaceId: input.workspaceId,
    reservationId: requiredString(row.reservation_id, "reservation id"),
    walletId: requiredString(row.wallet_id, "wallet id"),
    mutationKey: requiredString(row.mutation_key, "mutation key"),
    entitlementType: requiredString(row.entitlement_type, "entitlement type"),
    creditsReserved: numberOrZero(row.credits_reserved),
    creditsOutstanding: numberOrZero(row.credits_reserved),
    creditsRemaining: numberOrZero(row.credits_remaining),
    periodEnd: typeof row.period_end === "string" ? row.period_end : null,
  };
}

export async function settleWorkspaceCreditReservation(input: {
  reservation: WorkspaceCreditReservation;
  credits: number;
  mutationKey: string;
  metadata?: Record<string, unknown>;
  serviceSupabase?: CreditRpcClient;
}): Promise<WorkspaceCreditMutationResult> {
  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("settle_workspace_credit_reservation", {
    p_workspace_id: input.reservation.workspaceId,
    p_reservation_id: input.reservation.reservationId,
    p_credits: input.credits,
    p_mutation_key: input.mutationKey,
    p_metadata: input.metadata ?? {},
  });
  if (error) throw new Error(`Credit settlement failed: ${error.message}`);

  const row = firstRow<CloseCreditRpcRow>(data);
  const result = closeMutationResult(row, "credits_settled", input.mutationKey);
  input.reservation.creditsOutstanding = result.creditsOutstanding;
  input.reservation.creditsRemaining = result.creditsRemaining;
  return result;
}

export async function refundWorkspaceCreditReservation(input: {
  reservation: WorkspaceCreditReservation;
  credits?: number;
  mutationKey: string;
  reason: string;
  metadata?: Record<string, unknown>;
  serviceSupabase?: CreditRpcClient;
}): Promise<WorkspaceCreditMutationResult | null> {
  const credits = input.credits ?? input.reservation.creditsOutstanding;
  if (credits <= 0) return null;

  const service = input.serviceSupabase ?? createSupabaseServiceClient();
  const { data, error } = await service.rpc("refund_workspace_credit_reservation", {
    p_workspace_id: input.reservation.workspaceId,
    p_reservation_id: input.reservation.reservationId,
    p_credits: credits,
    p_mutation_key: input.mutationKey,
    p_reason: input.reason,
    p_metadata: input.metadata ?? {},
  });
  if (error) throw new Error(`Credit refund failed: ${error.message}`);

  const row = firstRow<CloseCreditRpcRow>(data);
  const result = closeMutationResult(row, "credits_refunded", input.mutationKey);
  input.reservation.creditsOutstanding = result.creditsOutstanding;
  input.reservation.creditsRemaining = result.creditsRemaining;
  return result;
}

export async function refundOutstandingWorkspaceCredits(input: {
  reservation: WorkspaceCreditReservation | null;
  mutationKey: string;
  reason: string;
  metadata?: Record<string, unknown>;
  serviceSupabase?: CreditRpcClient;
}): Promise<void> {
  if (!input.reservation || input.reservation.creditsOutstanding <= 0) return;

  try {
    await refundWorkspaceCreditReservation({
      reservation: input.reservation,
      mutationKey: input.mutationKey,
      reason: input.reason,
      metadata: input.metadata,
      serviceSupabase: input.serviceSupabase,
    });
  } catch (error) {
    console.error("Failed to refund reserved workspace credits", error);
  }
}

export function creditErrorMessage(reason: CreditReservationReason): string {
  if (reason === "credit_limit_reached") {
    return "There are not enough render credits for this ad. Your draft is still saved.";
  }
  if (reason === "entitlement_expired") {
    return "Your render-credit period has ended. Renew or update billing to keep generating.";
  }
  if (reason === "no_active_entitlement") {
    return "This workspace does not have an active render-credit entitlement.";
  }
  if (reason === "billing_access_blocked") {
    return "New renders are paused while billing needs attention.";
  }
  if (reason === "paid_entitlement_inactive") {
    return "Paid render credits are not active yet.";
  }
  return "Render credits could not be reserved.";
}

function closeMutationResult(
  row: CloseCreditRpcRow | null,
  quantityField: "credits_settled" | "credits_refunded",
  fallbackMutationKey: string,
): WorkspaceCreditMutationResult {
  return {
    reservationId: requiredString(row?.reservation_id, "reservation id"),
    walletId: requiredString(row?.wallet_id, "wallet id"),
    creditsChanged: numberOrZero(row?.[quantityField]),
    creditsOutstanding: numberOrZero(row?.credits_outstanding),
    creditsRemaining: numberOrZero(row?.credits_remaining),
    mutationKey: typeof row?.mutation_key === "string" ? row.mutation_key : fallbackMutationKey,
  };
}
