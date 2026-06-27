import type { ApprovalStatus } from "./readiness.ts";
import type { createSupabaseServerClient } from "../supabase/server.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type ApprovalRecord = {
  id: string | null;
  status: ApprovalStatus;
};

type ApprovalRow = {
  id?: string;
  target_id?: string | null;
  target_type?: string | null;
  status?: string | null;
  risk_summary?: string | null;
  created_at?: string | null;
  workspaces?: { name?: string | null } | Array<{ name?: string | null }> | null;
};

export function normalizeApprovalStatus(value: unknown): ApprovalStatus {
  return value === "approved" || value === "rejected" || value === "cancelled" || value === "requested"
    ? value
    : "draft";
}

export function buildApprovalRows(rows: ApprovalRow[]) {
  return rows.map((row) => ({
    id: row.id ?? `${row.target_type ?? "approval"}-${row.target_id ?? "unknown"}`,
    title: `${row.target_type ?? "Action"} approval`,
    workspace: one(row.workspaces)?.name ?? "Workspace",
    risk: row.risk_summary ?? "Review required",
    status: row.status ?? "requested",
  }));
}

export async function listApprovalRows(supabase: SupabaseServerClient, workspaceId: string) {
  const { data } = await supabase
    .from("approval_requests")
    .select("id,target_type,target_id,status,risk_summary,workspaces(name)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return buildApprovalRows((data ?? []) as ApprovalRow[]);
}

/**
 * Resolves the latest approval covering an AdStudio campaign / export
 * package, preferring the approval attached to the newest Meta publish plan
 * for those targets.
 */
export async function loadApprovalStatus(
  supabase: SupabaseServerClient,
  workspaceId: string,
  targetIds: string[],
): Promise<ApprovalRecord> {
  const uniqueTargetIds = uniqueStrings(targetIds);
  const { data: latestPlan } = await supabase
    .from("meta_publish_plans")
    .select("id,approval_request_id")
    .eq("workspace_id", workspaceId)
    .in("adstudio_campaign_id", uniqueTargetIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const possibleApprovalIds = typeof latestPlan?.approval_request_id === "string" ? [latestPlan.approval_request_id] : [];
  const possibleTargetIds = uniqueStrings([...uniqueTargetIds, ...(typeof latestPlan?.id === "string" ? [latestPlan.id] : [])]);

  if (possibleApprovalIds.length > 0) {
    const { data } = await supabase
      .from("approval_requests")
      .select("id,status")
      .eq("workspace_id", workspaceId)
      .in("id", possibleApprovalIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.id) {
      return { id: data.id as string, status: normalizeApprovalStatus(data.status) };
    }
  }

  const { data } = await supabase
    .from("approval_requests")
    .select("id,status")
    .eq("workspace_id", workspaceId)
    .in("target_id", possibleTargetIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    id: typeof data?.id === "string" ? data.id : null,
    status: normalizeApprovalStatus(data?.status),
  };
}

export async function loadApprovalById(
  supabase: SupabaseServerClient,
  workspaceId: string,
  approvalRequestId: string,
): Promise<ApprovalStatus> {
  const { data } = await supabase
    .from("approval_requests")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("id", approvalRequestId)
    .maybeSingle();

  return normalizeApprovalStatus(data?.status);
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function one<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}
