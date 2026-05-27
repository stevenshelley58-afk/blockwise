import {
  Bot,
  Building2,
  ClipboardCheck,
  FileSearch,
  Gauge,
  LayoutDashboard,
  Megaphone,
  Settings2,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AccountMenu } from "@/components/account-menu";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type AppShellProps = {
  children: React.ReactNode;
  requiredAccess?: "authenticated" | "operator";
};

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
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

const operatorNavItems: NavItem[] = [
  { href: "/operator", label: "Operator", icon: LayoutDashboard },
  { href: "/monitor", label: "Monitor", icon: Gauge },
  { href: "/self-serve", label: "Self-Serve", icon: Sparkles },
  { href: "/research", label: "Research", icon: FileSearch },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/onboarding", label: "Onboarding", icon: Building2 },
  { href: "/agents", label: "Agent Workforce", icon: Bot },
  { href: "/model-control", label: "Model Control", icon: Settings2 },
];

const selfServeNavItems: NavItem[] = [
  { href: "/self-serve", label: "Self-Serve", icon: Sparkles },
  { href: "/monitor", label: "Monitor", icon: Gauge },
  { href: "/research", label: "Research", icon: FileSearch },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/onboarding", label: "Onboarding", icon: Building2 },
];

const monitorNavItems: NavItem[] = [
  { href: "/monitor", label: "Monitor", icon: Gauge },
  { href: "/research", label: "Research", icon: FileSearch },
  { href: "/leads", label: "Leads", icon: UsersRound },
  { href: "/onboarding", label: "Onboarding", icon: Building2 },
];

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

  const navItems = isOperator ? operatorNavItems : workspaceMode === "self_serve" ? selfServeNavItems : monitorNavItems;
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
        <nav className="nav-group">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link className="nav-link" href={item.href} key={item.href}>
                <Icon aria-hidden size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
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
