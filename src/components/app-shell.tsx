import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountMenu } from "@/components/account-menu";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";
import { deriveCapabilities } from "@/lib/auth/capabilities";
import type { WorkspaceRole } from "@/lib/auth/access-control";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AppShellProps = {
  children: React.ReactNode;
  requiredAccess?: "authenticated" | "operator";
};

type WorkspaceSummary = {
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
      .select("role, workspaces(name, mode, region)")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const isOperator = Boolean(profile?.is_operator);
  const membershipRows = (memberships ?? []) as MembershipRow[];
  const primaryMembership = membershipRows[0];
  const workspace = normalizeWorkspace(primaryMembership?.workspaces ?? null);
  const workspaceMode = workspace?.mode === "self_serve" ? "self_serve" : "monitor";

  if (requiredAccess === "operator" && !isOperator) {
    redirect(workspaceMode === "self_serve" ? "/self-serve" : "/monitor");
  }

  const role = (primaryMembership?.role ?? "viewer") as WorkspaceRole;
  const capabilities = Array.from(deriveCapabilities({ role, workspaceMode, isOperator }));
  const homeHref = isOperator ? "/operator" : workspaceMode === "self_serve" ? "/self-serve" : "/monitor";
  const workspaceName = isOperator ? "Operator Console" : workspace?.name ?? "Workspace";
  const accountName = profile?.full_name ?? user.email ?? "Signed in";
  const roleLabel = isOperator ? "operator" : primaryMembership?.role ?? "member";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href={homeHref} aria-label="Blockwise">
          <BlockwiseLogo />
        </Link>
        <SidebarNav capabilities={capabilities} />
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="workspace-chip">
            {workspaceName} - {workspace?.region ?? "AU"}
          </span>
          <div className="topbar-actions">
            <SidebarThemeToggle />
            <AccountMenu email={user.email ?? ""} name={accountName} role={roleLabel} />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
