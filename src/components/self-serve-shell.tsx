"use client";

import { Download, LifeBuoy, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { MobileBottomNav } from "@/components/app/mobile-bottom-nav";
import { CommandMenu } from "@/components/command-menu";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";
import { isItemActive, navByVariant, type NavItem } from "@/components/sidebar-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger } from "@/components/ui/sidebar";
import { niche } from "@/config/niche";
import { purgeLocalReadModels, syncReadModelIdentity } from "@/lib/read-models/browser-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type SelfServeShellProps = {
  children: React.ReactNode;
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRegion: string;
  account: {
    email: string;
    name: string;
    role: string;
  };
  trialStatus: React.ReactNode;
};

type NavGroup = {
  section?: string;
  items: NavItem[];
};

// The self-serve menu is a single guided path plus a "Set up" group; split the
// flat nav list on the `section` field so each group renders under a label.
function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (!last || last.section !== item.section) {
      groups.push({ section: item.section, items: [item] });
    } else {
      last.items.push(item);
    }
  }
  return groups;
}

/** Topbar breadcrumb page title: the deepest nav item matching the path. */
function pageTitleForPath(pathname: string): string {
  let best: { href: string; label: string } | null = null;
  for (const item of niche.nav.items) {
    const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best?.label ?? niche.product.name;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

type Account = { email: string; name: string; role: string };

function useSignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    const supabase = createSupabaseBrowserClient();
    await purgeLocalReadModels();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return { signOut, isSigningOut };
}

function requestInstallPrompt() {
  window.dispatchEvent(new CustomEvent("blockwise:install-app-request"));
}

// Avatar account menu — the mockup's topbar avatar. Desktop and mobile share
// it; the mobile "More" sheet keeps the large-touch-target equivalents.
function AccountDropdown({ account, homeCompact = false }: { account: Account; homeCompact?: boolean }) {
  const copy = niche.copy.shell;
  const { signOut, isSigningOut } = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className={homeCompact
            ? "inline-grid size-11 cursor-pointer place-items-center text-foreground transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-9"
            : "inline-grid size-8 cursor-pointer place-items-center rounded-full border border-border bg-(--accent-tint) font-display text-[11.5px] font-extrabold text-foreground transition-opacity duration-150 hover:opacity-80 md:size-9"}
        >
          {homeCompact ? (
            <UserRound aria-hidden size={22} strokeWidth={1.9} />
          ) : (
            <Avatar className="size-full">
              <AvatarFallback className="bg-transparent font-display text-[11.5px] font-extrabold">
                {initialsFor(account.name)}
              </AvatarFallback>
            </Avatar>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-semibold">{account.name}</p>
          <p className="text-xs font-normal text-muted-foreground">
            {account.role} · {account.email}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={requestInstallPrompt}>
          <Download aria-hidden />
          {copy.installApp}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()} disabled={isSigningOut}>
          <LogOut aria-hidden />
          {copy.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SelfServeShell({
  children,
  userId,
  workspaceId,
  workspaceName,
  workspaceRegion,
  account,
  trialStatus,
}: SelfServeShellProps) {
  const pathname = usePathname() ?? "";
  const groups = useMemo(() => groupNavItems(navByVariant.self_serve), []);
  const pageTitle = pageTitleForPath(pathname);
  const isSelfServeHome = pathname === "/self-serve";

  useEffect(() => {
    void syncReadModelIdentity({ userId, workspaceId });
  }, [userId, workspaceId]);

  return (
    <SidebarProvider
      className="tw"
      style={
        {
          "--ui-data": niche.theme.data,
          "--ui-data-soft": niche.theme.dataSoft,
          "--ui-data-track": niche.theme.dataTrack,
        } as CSSProperties
      }
    >
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-3">
          <Link
            href="/self-serve"
            aria-label={niche.product.name}
            className="inline-flex items-center text-[var(--brand-ink)] transition-opacity hover:opacity-80 group-data-[collapsible=icon]:justify-center"
          >
            <BlockwiseLogo tokens />
          </Link>
        </SidebarHeader>
        <SidebarContent className="pt-2">
          {groups.map((group) => (
            <SidebarGroup key={group.section ?? "primary"}>
              {group.section ? (
                <SidebarGroupLabel className="px-2.5 text-[11px] font-extrabold uppercase tracking-[0.12em]">
                  {group.section}
                </SidebarGroupLabel>
              ) : null}
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isItemActive(pathname, item.href, navByVariant.self_serve);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href} aria-current={active ? "page" : undefined}>
                          <Icon aria-hidden />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter className="p-2">
          {/* Trial card lives in the sidebar footer; hidden when the rail is
              collapsed to icons. */}
          <div className="group-data-[collapsible=icon]:hidden">
            {trialStatus}
          </div>
          <a
            href="mailto:hello@blockwise.sale?subject=Blockwise%20support"
            className="inline-flex min-h-11 items-center gap-2 rounded-(--r-card) px-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center"
          >
            <LifeBuoy aria-hidden size={18} />
            <span className="group-data-[collapsible=icon]:hidden">Contact support</span>
          </a>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className={cn("pb-[calc(4.75rem+env(safe-area-inset-bottom)+var(--consent-banner-height,0px))] md:pb-0", isSelfServeHome && "self-serve-home-inset bg-(--surface)")}>
        <header className={cn("sticky top-0 z-20 flex items-center gap-2.5 border-b border-border px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md md:min-h-[60px] md:gap-3.5 md:px-7", isSelfServeHome ? "self-serve-home-topbar min-h-[56px] bg-(--surface)" : "min-h-[54px] bg-background/85")}>
          <SidebarTrigger className="-ml-1 hidden md:inline-flex" />

          {/* Desktop: keep the workspace breadcrumb on routes that need it. */}
          {!isSelfServeHome ? (
            <span className="hidden truncate font-display text-[15.5px] font-extrabold tracking-[-0.01em] md:inline">
              {workspaceName} <span className="font-normal text-(--faint)">/</span> {pageTitle}
            </span>
          ) : null}

          {/* Home keeps one title across breakpoints; other routes retain the
              condensed product brand on mobile. */}
          {isSelfServeHome ? (
            <h1 className="self-serve-home-title font-sans text-[20px] font-semibold tracking-[-0.02em]">
              Home
            </h1>
          ) : (
            <Link
              href="/self-serve"
              aria-label={niche.product.name}
              className="inline-flex items-center gap-2 text-foreground md:hidden"
            >
              <BlockwiseLogo tokens showWordmark={false} />
              <span className="font-display text-base font-extrabold tracking-[-0.015em]">
                {niche.product.name}
              </span>
            </Link>
          )}

          {/* Industry chip — config-driven, no legacy class */}
          {!isSelfServeHome ? (
            <span
              aria-label={`Workspace: ${workspaceName}`}
              className="hidden shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground lg:inline"
            >
              {niche.industry.label} · {workspaceRegion}
            </span>
          ) : null}

          <div className={cn("ml-auto inline-flex items-center gap-2.5 md:gap-3", isSelfServeHome && "self-serve-home-actions max-md:[&>button]:min-h-11 max-md:[&>button]:min-w-11 max-md:[&>button]:rounded-(--r-ctl)")}>
            <CommandMenu />
            {!isSelfServeHome ? <SidebarThemeToggle tokens /> : null}
            <AccountDropdown account={account} homeCompact={isSelfServeHome} />
          </div>
        </header>
        {children}
      </SidebarInset>

      <MobileBottomNav homeHref="/self-serve" account={account} homePilot={isSelfServeHome} />
    </SidebarProvider>
  );
}
