"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StudioShell } from "@/components/adstudio/studio-shell";
import { SelfServeShell } from "@/components/self-serve-shell";

type Account = { email: string; name: string; role: string };

type StudioRouteShellProps = {
  children: ReactNode;
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRegion: string;
  account: Account;
  trialStatus: ReactNode;
  metaConnectionStatus: "connected" | "attention" | "not_connected" | "unknown";
  homeHref?: string;
};

/**
 * Unified route boundary (replaces RouteAwareLegacyShell).
 * Dark Studio chrome for /ad-studio* for every workspace,
 * light SelfServe chrome everywhere else. No monitor/operator split.
 */
export function StudioRouteShell({
  children,
  userId,
  workspaceId,
  workspaceName,
  workspaceRegion,
  account,
  trialStatus,
  metaConnectionStatus,
  homeHref = "/self-serve",
}: StudioRouteShellProps) {
  const pathname = usePathname() ?? "";
  if (pathname === "/ad-studio" || pathname.startsWith("/ad-studio/")) {
    return (
      <StudioShell
        workspaceName={workspaceName}
        homeHref={homeHref}
        account={account}
        metaConnectionStatus={metaConnectionStatus}
      >
        {children}
      </StudioShell>
    );
  }
  return (
    <SelfServeShell
      userId={userId}
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      workspaceRegion={workspaceRegion}
      account={account}
      trialStatus={trialStatus}
    >
      {children}
    </SelfServeShell>
  );
}
