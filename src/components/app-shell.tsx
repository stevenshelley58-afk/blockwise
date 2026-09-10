import { redirect } from "next/navigation";
import { Suspense } from "react";

import { StudioRouteShell } from "@/components/adstudio/studio-route-shell";
import { TrialStatusSkeleton } from "@/components/trial-status-skeleton";
import { TrialStatusCard } from "@/components/trial-status-pill";
import { getRequestAuthContext } from "@/lib/auth/request-context";
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
): Promise<TrialStatus | null> {
  if (!workspaceId || workspaceMode !== "self_serve") return null;

  return loadTrialStatus(
    (functionName, parameters) => supabase.rpc(functionName, parameters),
    workspaceId,
  );
}

async function DeferredTrialStatus({
  supabase,
  workspaceId,
  workspaceMode,
}: {
  supabase: Awaited<ReturnType<typeof getRequestAuthContext>>["supabase"];
  workspaceId: string | undefined;
  workspaceMode: "monitor" | "self_serve";
}) {
  const status = await loadInitialTrialStatus(
    supabase,
    workspaceId,
    workspaceMode,
  );

  return <TrialStatusCard initialStatus={status} />;
}

export async function AppShell({
  children,
  requiredAccess = "authenticated",
}: AppShellProps) {
  const auth = await getRequestAuthContext();
  const { claims, memberships, profile, supabase } = auth;

  if (!claims) {
    redirect("/login");
  }

  const membershipRows = (memberships ?? []) as MembershipRow[];
  const primaryMembership = membershipRows[0];
  const workspace = normalizeWorkspace(primaryMembership?.workspaces ?? null);
  const workspaceMode =
    workspace?.mode === "self_serve" ? "self_serve" : "monitor";

  const homeHref = "/self-serve";
  const workspaceName = workspace?.name ?? "Workspace";
  const accountEmail = profile?.email ?? claims.email ?? "";
  const accountName = profile?.full_name ?? accountEmail ?? "Signed in";
  const roleLabel = primaryMembership?.role ?? "member";

  const metaConnectionResult = workspace?.id
    ? await supabase
        .from("provider_connections")
        .select("status")
        .eq("workspace_id", workspace.id)
        .eq("provider", "meta")
        .maybeSingle()
    : null;
  const metaConnectionStatus = metaConnectionResult?.error
    ? "unknown"
    : metaConnectionResult?.data?.status === "connected"
      ? "connected"
      : metaConnectionResult?.data?.status
        ? "attention"
        : "not_connected";

  return (
    <StudioRouteShell
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
        <Suspense fallback={<TrialStatusSkeleton />}>
          <DeferredTrialStatus
            supabase={supabase}
            workspaceId={workspace?.id}
            workspaceMode={workspaceMode}
          />
        </Suspense>
      }
      metaConnectionStatus={metaConnectionStatus}
      homeHref={homeHref}
    >
      {children}
    </StudioRouteShell>
  );
}
