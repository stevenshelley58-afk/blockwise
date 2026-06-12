import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { AccountMenu } from "@/components/account-menu";
import { MobileBottomNav } from "@/components/app/mobile-bottom-nav";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { SidebarNav, type SidebarVariant } from "@/components/sidebar-nav";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";
import { TrialStatusPill, type TrialStatus } from "@/components/trial-status-pill";
import { hasOperatorAccessFromRows } from "@/lib/auth/workspace-access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AppShellProps = {
  children: React.ReactNode;
  requiredAccess?: "authenticated" | "operator";
};

type WorkspaceSummary = {
  id: string;
  name: string;
  mode: "monitor" | "self_serve";
  region: string;
};

type MembershipRow = {
  role: string;
  workspaces: WorkspaceSummary | WorkspaceSummary[] | null;
};

function normalizeWorkspace(workspace: MembershipRow["workspaces"]) {
  return Array.isArray(workspace) ? workspace[0] : workspace;
}

const INCLUDED_AD_PACKS = 10;
const UPGRADE_HREF = "/settings#billing";

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

async function loadInitialTrialStatus(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  workspaceId: string | undefined,
  workspaceMode: "monitor" | "self_serve",
  isOperator: boolean,
): Promise<TrialStatus | null> {
  if (!workspaceId || workspaceMode !== "self_serve" || isOperator) return null;

  try {
    const { data, error } = await supabase.rpc("get_trial_status", { target_workspace_id: workspaceId });
    if (!error) {
      const status = normalizeRpcTrialStatus(data);
      if (status) return status;
    }
  } catch {
    // Fall through to readable workspace data.
  }

  try {
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("trial_ends_at, workspace_plans(key)")
      .eq("id", workspaceId)
      .maybeSingle();
    const row = workspace as {
      trial_ends_at?: string | null;
      workspace_plans?: { key?: string | null } | Array<{ key?: string | null }> | null;
    } | null;
    const plan = Array.isArray(row?.workspace_plans) ? row?.workspace_plans[0] : row?.workspace_plans;
    if (plan?.key !== "trial") return null;

    const { count } = await supabase.from("adstudio_campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    const usedAdPacks = Math.max(0, count ?? 0);
    const trialEndsAt = row?.trial_ends_at ?? null;
    const msRemaining = trialEndsAt ? new Date(trialEndsAt).getTime() - Date.now() : null;

    return {
      isTrial: true,
      includedAdPacks: INCLUDED_AD_PACKS,
      usedAdPacks,
      remainingAdPacks: Math.max(0, INCLUDED_AD_PACKS - usedAdPacks),
      planName: null,
      trialEndsAt,
      trialDaysRemaining: msRemaining === null ? null : Math.max(0, Math.ceil(msRemaining / 86_400_000)),
      trialExpired: msRemaining !== null && msRemaining <= 0,
      upgradeHref: UPGRADE_HREF,
    };
  } catch {
    return null;
  }
}

export async function AppShell({ children, requiredAccess = "authenticated" }: AppShellProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase.from("profiles").select("full_name,is_operator").eq("id", user.id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("role, workspaces(id, name, mode, region)")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const membershipRows = (memberships ?? []) as MembershipRow[];
  const isOperator = hasOperatorAccessFromRows(profile, membershipRows);
  const primaryMembership = membershipRows[0];
  const workspace = normalizeWorkspace(primaryMembership?.workspaces ?? null);
  const workspaceMode = workspace?.mode === "self_serve" ? "self_serve" : "monitor";

  if (requiredAccess === "operator" && !isOperator) {
    redirect("/results");
  }

  const variant: SidebarVariant = isOperator ? "operator" : workspaceMode === "self_serve" ? "self_serve" : "monitor";
  const homeHref = isOperator ? "/operator" : "/self-serve";
  const workspaceName = isOperator ? "Operator Console" : workspace?.name ?? "Workspace";
  const accountName = profile?.full_name ?? user.email ?? "Signed in";
  const roleLabel = isOperator ? "operator" : primaryMembership?.role ?? "member";
  const showApprovals = isOperator || primaryMembership?.role === "owner" || primaryMembership?.role === "admin";
  const initialTrialStatus = await loadInitialTrialStatus(supabase, workspace?.id, workspaceMode, isOperator);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href={homeHref} aria-label="Blockwise">
          <BlockwiseLogo />
        </Link>
        {variant === "operator" ? <p className="sidebar-kicker">Operator</p> : null}
        <SidebarNav variant={variant} showApprovals={showApprovals} />
        {variant === "operator" ? (
          <div className="sidebar-footer" aria-label="Runtime status">
            <a className="sidebar-engine" href="https://hermes.blockwise.sale" target="_blank" rel="noreferrer">
              <span>
                <strong>Hermes Engine</strong>
                <small>Open runtime workspace</small>
              </span>
              <ChevronRight aria-hidden size={16} />
            </a>
          </div>
        ) : null}
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="workspace-chip" aria-label={`Workspace: ${workspaceName}`}>
            {workspaceName} - {workspace?.region ?? "AU"}
          </span>
          <div className="topbar-actions">
            <TrialStatusPill initialStatus={initialTrialStatus} />
            <SidebarThemeToggle />
            <AccountMenu email={user.email ?? ""} name={accountName} role={roleLabel} />
          </div>
        </header>
        {children}
      </div>
      <MobileBottomNav
        variant={variant}
        showApprovals={showApprovals}
        account={{
          email: user.email ?? "",
          name: accountName,
          role: roleLabel,
        }}
      />
    </div>
  );
}
