import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountMenu } from "@/components/account-menu";
import { SidebarNav, type SidebarVariant } from "@/components/sidebar-nav";
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

  const variant: SidebarVariant = isOperator ? "operator" : workspaceMode === "self_serve" ? "self_serve" : "monitor";
  const homeHref = isOperator ? "/operator" : workspaceMode === "self_serve" ? "/self-serve" : "/monitor";
  const workspaceName = isOperator ? "Operator Console" : workspace?.name ?? "Workspace";
  const accountName = profile?.full_name ?? user.email ?? "Signed in";
  const roleLabel = isOperator ? "operator" : primaryMembership?.role ?? "member";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href={homeHref} aria-label="Blockwise">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </Link>
        <SidebarNav variant={variant} />
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="workspace-chip">
            {workspaceName} - {workspace?.region ?? "AU"}
          </span>
          <AccountMenu email={user.email ?? ""} name={accountName} role={roleLabel} />
        </header>
        {children}
      </div>
    </div>
  );
}
