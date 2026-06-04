import { NextResponse } from "next/server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

export type TrialReserveReason =
  | "trial_active"
  | "trial_expired"
  | "credit_limit_reached"
  | "not_trial"
  | "non_trial"
  | "paid_workspace"
  | string;

export type TrialReserveRpcResult = {
  allowed?: boolean | null;
  reason?: TrialReserveReason | null;
  used_count?: number | null;
  limit_count?: number | null;
  trial_ends_at?: string | null;
};

export type AdStudioGenerationTrialReservation = {
  workspaceId: string;
  isTrialWorkspace: boolean;
  shouldRefund: boolean;
  reason: TrialReserveReason | null;
  usedCount: number | null;
  limitCount: number | null;
  trialEndsAt: string | null;
};

type ReserveTrialCreditInput = {
  supabase: SupabaseServerClient;
  workspaceId: string;
  actorProfileId: string;
  serviceSupabase?: SupabaseServiceClient;
};

type WorkspacePlanRecord = {
  workspace_plans?: { key?: string | null } | Array<{ key?: string | null }> | null;
};

export function hasConfirmedEmail(user: {
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
} | null): boolean {
  return Boolean(user?.email && (user.email_confirmed_at || user.confirmed_at));
}

export function trialCreditErrorStatus(reason: TrialReserveReason | null | undefined): 402 | 403 {
  return reason === "trial_expired" || reason === "credit_limit_reached" ? 402 : 403;
}

export function isTrialCreditReservation(result: TrialReserveRpcResult): boolean {
  if (result.reason === "not_trial" || result.reason === "non_trial" || result.reason === "paid_workspace") {
    return false;
  }

  return result.limit_count !== null && result.limit_count !== undefined;
}

export async function reserveAdStudioGenerationCredit(input: ReserveTrialCreditInput): Promise<
  | { ok: true; reservation: AdStudioGenerationTrialReservation }
  | { ok: false; response: NextResponse }
> {
  const {
    data: { user },
    error: userError,
  } = await input.supabase.auth.getUser();

  if (userError || !user || user.id !== input.actorProfileId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication is required." }, { status: 401 }),
    };
  }

  let serviceSupabase = input.serviceSupabase;

  try {
    serviceSupabase ??= createSupabaseServiceClient();
  } catch (error) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: error instanceof Error ? error.message : "Trial credit reservation failed." },
        { status: 500 },
      ),
    };
  }

  const workspacePlan = await loadWorkspacePlanKey(serviceSupabase, input.workspaceId);

  if (!workspacePlan.ok) {
    return workspacePlan;
  }

  if (workspacePlan.planKey !== "trial") {
    return {
      ok: true,
      reservation: {
        workspaceId: input.workspaceId,
        isTrialWorkspace: false,
        shouldRefund: false,
        reason: "not_trial",
        usedCount: null,
        limitCount: null,
        trialEndsAt: null,
      },
    };
  }

  if (!hasConfirmedEmail(user)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Email confirmation is required before generation." },
        { status: 403 },
      ),
    };
  }

  const { data, error } = await serviceSupabase.rpc("reserve_trial_ad_pack_credit", {
    target_workspace_id: input.workspaceId,
    actor_profile_id: input.actorProfileId,
  });

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  const result = normalizeTrialReserveResult(data);
  const reason = result.reason ?? null;

  if (!result.allowed) {
    return {
      ok: false,
      response: NextResponse.json({ error: reason ?? "Trial credit reservation failed." }, { status: trialCreditErrorStatus(reason) }),
    };
  }

  const isTrialWorkspace = isTrialCreditReservation(result);

  return {
    ok: true,
    reservation: {
      workspaceId: input.workspaceId,
      isTrialWorkspace,
      shouldRefund: isTrialWorkspace,
      reason,
      usedCount: typeof result.used_count === "number" ? result.used_count : null,
      limitCount: typeof result.limit_count === "number" ? result.limit_count : null,
      trialEndsAt: result.trial_ends_at ?? null,
    },
  };
}

async function loadWorkspacePlanKey(serviceSupabase: SupabaseServiceClient, workspaceId: string): Promise<
  | { ok: true; planKey: string | null }
  | { ok: false; response: NextResponse }
> {
  const { data, error } = await serviceSupabase
    .from("workspaces")
    .select("workspace_plans(key)")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json({ error: error.message }, { status: 500 }),
    };
  }

  const row = data as WorkspacePlanRecord | null;
  const plan = Array.isArray(row?.workspace_plans) ? row?.workspace_plans[0] : row?.workspace_plans;

  return {
    ok: true,
    planKey: plan?.key ?? null,
  };
}

export async function refundReservedTrialCredit(
  reservation: AdStudioGenerationTrialReservation | null,
  serviceSupabase?: SupabaseServiceClient,
): Promise<void> {
  if (!reservation?.shouldRefund) {
    return;
  }

  try {
    const service = serviceSupabase ?? createSupabaseServiceClient();
    const { error } = await service.rpc("refund_trial_ad_pack_credit", {
      target_workspace_id: reservation.workspaceId,
    });

    if (error) {
      console.error("Failed to refund trial Ad Studio credit", error);
    }
  } catch (error) {
    console.error("Failed to refund trial Ad Studio credit", error);
  }
}

function normalizeTrialReserveResult(data: unknown): TrialReserveRpcResult {
  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object") {
    return { allowed: false, reason: "trial_reservation_failed" };
  }

  return row as TrialReserveRpcResult;
}
