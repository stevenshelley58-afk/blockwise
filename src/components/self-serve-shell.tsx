"use client";

import { Download, LogOut, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { CommandMenu } from "@/components/command-menu";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";
import { isItemActive, navByVariant, selfServeIcons, type NavItem } from "@/components/sidebar-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { niche } from "@/config/niche";
import { cssSpring } from "@/lib/motion";
import { useSmartPrefetch } from "@/lib/navigation/use-smart-prefetch";
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
function AccountDropdown({ account }: { account: Account }) {
  const copy = niche.copy.shell;
  const { signOut, isSigningOut } = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account"
          className="inline-grid size-8 cursor-pointer place-items-center rounded-full border border-border bg-(--accent-tint) font-display text-[11.5px] font-extrabold text-foreground transition-opacity duration-150 hover:opacity-80 md:size-9"
        >
          <Avatar className="size-full">
            <AvatarFallback className="bg-transparent font-display text-[11.5px] font-extrabold">
              {initialsFor(account.name)}
            </AvatarFallback>
          </Avatar>
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
  const { prefetchNow } = useSmartPrefetch();
  const groups = useMemo(() => groupNavItems(navByVariant.self_serve), []);
  const pageTitle = pageTitleForPath(pathname);

  useEffect(() => {
    void syncReadModelIdentity({ userId, workspaceId });
  }, [userId, workspaceId]);

  return (
    <SidebarProvider className="tw bg-background">
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
                  const active = isItemActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          aria-current={active ? "page" : undefined}
                          onPointerEnter={() => prefetchNow(item.href)}
                          onFocus={() => prefetchNow(item.href)}
                          onTouchStart={() => prefetchNow(item.href)}
                        >
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
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-20 flex min-h-[54px] items-center gap-2.5 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)] md:min-h-[60px] md:gap-3.5 md:px-7">
          <SidebarTrigger className="-ml-1 hidden md:inline-flex" />

          {/* Desktop: workspace / page breadcrumb */}
          <span className="hidden truncate font-display text-[15.5px] font-extrabold tracking-[-0.01em] md:inline">
            {workspaceName} <span className="font-normal text-(--faint)">/</span> {pageTitle}
          </span>

          {/* Mobile: condensed brand topbar */}
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

          {/* Industry chip — config-driven, no legacy class */}
          <span
            aria-label={`Workspace: ${workspaceName}`}
            className="hidden shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground lg:inline"
          >
            {niche.industry.label} · {workspaceRegion}
          </span>

          <div className="ml-auto inline-flex items-center gap-2.5 md:gap-3">
            <CommandMenu />
            <SidebarThemeToggle tokens />
            <AccountDropdown account={account} />
          </div>
        </header>
        {children}
      </SidebarInset>

      <SelfServeMobileNav account={account} />
    </SidebarProvider>
  );
}

// Mobile navigation for the self-serve shell: the five primary tabs from the
// niche config (bottom tab bar, mockup pattern) plus a "More" sheet for the
// remaining destinations. Hidden inside Ad Studio, which renders its own
// studio navigation.
function SelfServeMobileNav({ account }: { account: Account }) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);
  const { signOut, isSigningOut } = useSignOut();
  const { prefetchNow } = useSmartPrefetch();

  const copy = niche.copy.shell;

  const { tabItems, overflowItems } = useMemo(() => {
    const allItems = navByVariant.self_serve;
    const tabs = niche.nav.mobileTabs
      .map((tab) => allItems.find((item) => item.href === tab.href))
      .filter((item): item is NavItem => Boolean(item));
    const tabSet = new Set(tabs.map((item) => item.href));
    return { tabItems: tabs, overflowItems: allItems.filter((item) => !tabSet.has(item.href)) };
  }, []);

  if (pathname.startsWith("/ad-studio")) {
    return null;
  }

  return (
    <>
      <nav
        aria-label="Primary mobile navigation"
        className={`fixed inset-x-0 bottom-0 z-40 grid ${tabItems.length >= 5 ? "grid-cols-6" : "grid-cols-5"} gap-0.5 border-t border-border bg-sidebar px-1.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden`}
      >
        {tabItems.map((item) => {
          const Icon = selfServeIcons[item.href];
          const active = isItemActive(pathname, item.href);
          const tab = niche.nav.mobileTabs.find((entry) => entry.href === item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              onPointerEnter={() => prefetchNow(item.href)}
              onFocus={() => prefetchNow(item.href)}
              onTouchStart={() => prefetchNow(item.href)}
              style={{ transitionTimingFunction: cssSpring }}
              className={cn(
                "grid min-h-12 min-w-0 place-items-center gap-[3px] rounded-xl px-0.5 py-1 text-[9.5px] leading-[1.1] font-bold transition-[color,transform,background-color] duration-150 active:scale-[0.94] motion-reduce:transition-none",
                active ? "bg-(--accent-tint) text-foreground" : "text-(--faint)",
              )}
            >
              {Icon ? <Icon aria-hidden size={19} /> : null}
              <span className="max-w-full truncate">{tab?.label ?? item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          style={{ transitionTimingFunction: cssSpring }}
          className={cn(
            "grid min-h-12 min-w-0 cursor-pointer place-items-center gap-[3px] rounded-xl border-0 bg-transparent px-0.5 py-1 text-[9.5px] leading-[1.1] font-bold transition-[color,transform,background-color] duration-150 active:scale-[0.94] motion-reduce:transition-none",
            moreOpen ? "bg-(--accent-tint) text-foreground" : "text-(--faint)",
          )}
        >
          <MoreHorizontal aria-hidden size={20} />
          <span>{copy.more}</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[min(76dvh,640px)] rounded-t-(--r-panel) pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="px-4 pt-5">
            <SheetTitle>{account.name}</SheetTitle>
            <SheetDescription>
              {account.role} · {account.email}
            </SheetDescription>
          </SheetHeader>

          {overflowItems.length > 0 ? (
            <div className="grid gap-1 px-3">
              {overflowItems.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    onPointerEnter={() => prefetchNow(item.href)}
                    onFocus={() => prefetchNow(item.href)}
                    onTouchStart={() => prefetchNow(item.href)}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-(--r-card) px-3 text-sm font-semibold",
                      active
                        ? "bg-(--accent-tint) text-(--accent-strong)"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon aria-hidden size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ) : null}

          <div className="mt-auto grid gap-2 px-4 pt-2">
            <button
              type="button"
              onClick={() => {
                requestInstallPrompt();
                setMoreOpen(false);
              }}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-(--r-card) border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <Download aria-hidden size={18} />
              {copy.installApp}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={isSigningOut}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-(--r-card) border border-border bg-card px-4 text-sm font-semibold text-error hover:bg-muted disabled:opacity-60"
            >
              <LogOut aria-hidden size={18} />
              {isSigningOut ? "…" : copy.signOut}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
