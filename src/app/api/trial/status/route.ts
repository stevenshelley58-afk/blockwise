import { NextResponse, type NextRequest } from "next/server";

import { requireWorkspaceAccess } from "@/lib/auth/workspace-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TrialStatus = {
  isTrial: boolean;
  includedAdPacks: number;
  usedAdPacks: number;
  remainingAdPacks: number;
  planName: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  trialExpired: boolean;
  upgradeHref: string;
};

const INCLUDED_AD_PACKS = 10;
const UPGRADE_HREF = "/settings#plan";

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return firstRecord(value[0]);
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numeric(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRpcTrialStatus(value: unknown): TrialStatus | null {
  const row = firstRecord(value);
  if (!row) return null;
  const planKey = row.plan_key ?? row.planKey;
  if (planKey !== "trial" && row.is_trial !== true && row.isTrial !== true) return null;

  const includedAdPacks = numeric(row.ad_packs_limit ?? row.included_ad_packs ?? row.includedAdPacks, INCLUDED_AD_PACKS);
  const usedAdPacks = numeric(row.ad_packs_used ?? row.used_ad_packs ?? row.usedAdPacks, 0);
  const remainingAdPacks = numeric(row.ad_packs_remaining ?? row.remaining_ad_packs ?? row.remainingAdPacks, includedAdPacks - usedAdPacks);

  return {
    isTrial: true,
    includedAdPacks,
    usedAdPacks,
    remainingAdPacks: Math.max(0, remainingAdPacks),
    planName: typeof (row.plan_name ?? row.planName) === "string" ? String(row.plan_name ?? row.planName) : null,
    trialEndsAt: typeof (row.trial_ends_at ?? row.trialEndsAt) === "string" ? String(row.trial_ends_at ?? row.trialEndsAt) : null,
    trialDaysRemaining:
      row.trial_days_remaining === null || row.trial_days_remaining === undefined
        ? null
        : numeric(row.trial_days_remaining, 0),
    trialExpired: Boolean(row.trial_expired ?? row.trialExpired),
    upgradeHref: UPGRADE_HREF,
  };
}

async function loadRpcTrialStatus(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, workspaceId: string) {
  const attempts = [{ target_workspace_id: workspaceId }, { workspace_id: workspaceId }];

  for (const args of attempts) {
    const { data, error } = await supabase.rpc("get_trial_status", args);
    if (!error) {
      return normalizeRpcTrialStatus(data);
    }
  }

  return null;
}

async function loadFallbackTrialStatus(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, workspaceId: string) {
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("mode, trial_ends_at, plan_id, workspace_plans(key, name)")
    .eq("id", workspaceId)
    .maybeSingle();
  const row = workspace as {
    mode?: string | null;
    trial_ends_at?: string | null;
    workspace_plans?: { key?: string | null; name?: string | null } | Array<{ key?: string | null; name?: string | null }> | null;
  } | null;
  const plan = Array.isArray(row?.workspace_plans) ? row?.workspace_plans[0] : row?.workspace_plans;
  const isTrial = row?.mode === "self_serve" && plan?.key === "trial";

  if (!isTrial) return null;

  const { count } = await supabase.from("adstudio_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  const usedAdPacks = Math.max(0, count ?? 0);
  const planName = (plan as { name?: string | null } | null)?.name ?? null;
  const trialEndsAt = row?.trial_ends_at ?? null;
  const msRemaining = trialEndsAt ? new Date(trialEndsAt).getTime() - Date.now() : null;
  const trialDaysRemaining = msRemaining === null ? null : Math.max(0, Math.ceil(msRemaining / 86_400_000));

  return {
    isTrial: true,
    includedAdPacks: INCLUDED_AD_PACKS,
    usedAdPacks,
    remainingAdPacks: Math.max(0, INCLUDED_AD_PACKS - usedAdPacks),
    planName,
    trialEndsAt,
    trialDaysRemaining,
    trialExpired: msRemaining !== null && msRemaining <= 0,
    upgradeHref: UPGRADE_HREF,
  };
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const access = await requireWorkspaceAccess(supabase, {
    surface: "monitor",
    requestedWorkspaceId: request.nextUrl.searchParams.get("workspaceId"),
  });

  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  try {
    const trial = (await loadRpcTrialStatus(supabase, access.access.workspaceId)) ??
      (await loadFallbackTrialStatus(supabase, access.access.workspaceId));
    return NextResponse.json({ trial });
  } catch {
    return NextResponse.json({ trial: null });
  }
}
