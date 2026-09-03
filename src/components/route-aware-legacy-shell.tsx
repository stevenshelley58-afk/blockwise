"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AccountMenu } from "@/components/account-menu";
import { MobileBottomNav } from "@/components/app/mobile-bottom-nav";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { StudioShell } from "@/components/adstudio/studio-shell";
import { SidebarNav, type SidebarVariant } from "@/components/sidebar-nav";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";

type Props = {
  children: ReactNode;
  variant: SidebarVariant;
  homeHref: string;
  studioWorkspaceName: string;
  legacyWorkspaceName: string;
  workspaceRegion: string;
  account: { email: string; name: string; role: string };
  trialStatus: ReactNode;
  metaConnectionStatus: "connected" | "attention" | "not_connected" | "unknown";
};

/** Chooses Studio chrome for Studio routes and keeps the legacy shell elsewhere. */
export function RouteAwareLegacyShell({
  children,
  variant,
  homeHref,
  studioWorkspaceName,
  legacyWorkspaceName,
  workspaceRegion,
  account,
  trialStatus,
  metaConnectionStatus,
}: Props) {
  const pathname = usePathname() ?? "";
  if (pathname === "/ad-studio" || pathname.startsWith("/ad-studio/"))
    return (
      <StudioShell
        workspaceName={studioWorkspaceName}
        accountName={account.name}
        metaConnectionStatus={metaConnectionStatus}
      >
        {children}
      </StudioShell>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link className="brand" href={homeHref} aria-label="Blockwise">
          <BlockwiseLogo />
        </Link>
        {variant === "operator" ? (
          <p className="sidebar-kicker">Operator</p>
        ) : null}
        <SidebarNav variant={variant} />
        {variant === "operator" ? (
          <div className="sidebar-footer" aria-label="Runtime status">
            <a
              className="sidebar-engine"
              href="https://hermes.blockwise.sale"
              target="_blank"
              rel="noreferrer"
            >
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
          <span
            className="workspace-chip"
            aria-label={`Workspace: ${legacyWorkspaceName}`}
          >
            {legacyWorkspaceName} - {workspaceRegion}
          </span>
          <div className="topbar-actions">
            {trialStatus}
            <SidebarThemeToggle />
            <AccountMenu
              email={account.email}
              name={account.name}
              role={account.role}
            />
          </div>
        </header>
        {children}
      </div>
      <MobileBottomNav variant={variant} account={account} />
    </div>
  );
}
