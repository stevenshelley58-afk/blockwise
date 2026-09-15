"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StudioShell } from "@/components/adbuilder/studio-shell";
import { AdStudioShell } from "@/components/ad-studio-shell";

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
 * Dark Studio chrome for /ad-builder* for every workspace,
 * light adStudio chrome everywhere else. No monitor/operator split.
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
  homeHref = "/ad-studio",
}: StudioRouteShellProps) {
  const pathname = usePathname() ?? "";
  if (pathname === "/ad-builder" || pathname.startsWith("/ad-builder/")) {
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
    <AdStudioShell
      userId={userId}
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      workspaceRegion={workspaceRegion}
      account={account}
      trialStatus={trialStatus}
    >
      {children}
    </AdStudioShell>
  );
}
