import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Suspense } from "react";

import { AccountMenu } from "@/components/account-menu";
import { MobileBottomNav } from "@/components/app/mobile-bottom-nav";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { SelfServeShell } from "@/components/self-serve-shell";
import { SidebarNav, type SidebarVariant } from "@/components/sidebar-nav";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";
import { TrialStatusCard, TrialStatusPill } from "@/components/trial-status-pill";
import { getRequestAuthContext } from "@/lib/auth/request-context";
import { hasOperatorAccessFromRows } from "@/lib/auth/workspace-access";
import { loadTrialStatus, type TrialStatus } from "@/lib/trial/trial-status";

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

async function loadInitialTrialStatus(
  supabase: Awaited<ReturnType<typeof getRequestAuthContext>>["supabase"],
  workspaceId: string | undefined,
  workspaceMode: "monitor" | "self_serve",
  isOperator: boolean,
): Promise<TrialStatus | null> {
  if (!workspaceId || workspaceMode !== "self_serve" || isOperator) return null;

  return loadTrialStatus(
    (functionName, parameters) => supabase.rpc(functionName, parameters),
    workspaceId,
  );
}

async function DeferredTrialStatus({
  supabase,
  workspaceId,
  workspaceMode,
  isOperator,
  presentation,
}: {
  supabase: Awaited<ReturnType<typeof getRequestAuthContext>>["supabase"];
  workspaceId: string | undefined;
  workspaceMode: "monitor" | "self_serve";
  isOperator: boolean;
  presentation: "card" | "pill";
}) {
  const status = await loadInitialTrialStatus(supabase, workspaceId, workspaceMode, isOperator);

  return presentation === "card" ? (
    <TrialStatusCard initialStatus={status} />
  ) : (
    <TrialStatusPill initialStatus={status} />
  );
}

export async function AppShell({ children, requiredAccess = "authenticated" }: AppShellProps) {
  const auth = await getRequestAuthContext();
  const { claims, memberships, profile, supabase } = auth;

  if (!claims) {
    redirect("/login");
  }

  const membershipRows = (memberships ?? []) as MembershipRow[];
  const isOperator = hasOperatorAccessFromRows(profile, membershipRows);
  const primaryMembership = membershipRows[0];
  const workspace = normalizeWorkspace(primaryMembership?.workspaces ?? null);
  const workspaceMode = workspace?.mode === "self_serve" ? "self_serve" : "monitor";

  if (requiredAccess === "operator" && !isOperator) {
    redirect("/results");
  }

  const variant: SidebarVariant = isOperator ? "operator" : workspaceMode === "self_serve" ? "self_serve" : "monitor";
  const homeHref = isOperator ? "/operator" : workspaceMode === "self_serve" ? "/self-serve" : "/results";
  const workspaceName = isOperator ? "Operator Console" : workspace?.name ?? "Workspace";
  const accountEmail = profile?.email ?? claims.email ?? "";
  const accountName = profile?.full_name ?? accountEmail ?? "Signed in";
  const roleLabel = isOperator ? "operator" : primaryMembership?.role ?? "member";

  // Self-serve workspaces render on the shadcn/ui shell; operator and monitor
  // workspaces keep the existing CSS shell until their own migrations.
  if (variant === "self_serve") {
    return (
      <SelfServeShell
        userId={claims.sub}
        workspaceId={workspace?.id ?? ""}
        workspaceName={workspaceName}
        workspaceRegion={workspace?.region ?? "AU"}
        account={{
          email: accountEmail,
          name: accountName,
          role: roleLabel,
        }}
        trialStatus={
          <Suspense fallback={null}>
            <DeferredTrialStatus
              supabase={supabase}
              workspaceId={workspace?.id}
              workspaceMode={workspaceMode}
              isOperator={isOperator}
              presentation="card"
            />
          </Suspense>
        }
      >
        {children}
      </SelfServeShell>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href={homeHref} aria-label="Blockwise">
          <BlockwiseLogo />
        </Link>
        {variant === "operator" ? <p className="sidebar-kicker">Operator</p> : null}
        <SidebarNav variant={variant} />
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
          <Link className="topbar-brand" href={homeHref} aria-label="Blockwise">
            <BlockwiseLogo showWordmark={false} />
          </Link>
          <span className="workspace-chip" aria-label={`Workspace: ${workspaceName}`}>
            {workspaceName} - {workspace?.region ?? "AU"}
          </span>
          <div className="topbar-actions">
            <Suspense fallback={null}>
              <DeferredTrialStatus
                supabase={supabase}
                workspaceId={workspace?.id}
                workspaceMode={workspaceMode}
                isOperator={isOperator}
                presentation="pill"
              />
            </Suspense>
            <SidebarThemeToggle />
            <AccountMenu email={accountEmail} name={accountName} role={roleLabel} />
          </div>
        </header>
        {children}
      </div>
      <MobileBottomNav
        variant={variant}
        account={{
          email: accountEmail,
          name: accountName,
          role: roleLabel,
        }}
      />
    </div>
  );
}
