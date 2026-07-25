"use client";

import { Download, LogOut, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AccountMenu } from "@/components/account-menu";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { SidebarThemeToggle } from "@/components/sidebar-theme-toggle";
import { isItemActive, navByVariant, type NavItem } from "@/components/sidebar-nav";
import { TrialStatusPill, type TrialStatus } from "@/components/trial-status-pill";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
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

type SelfServeShellProps = {
  children: React.ReactNode;
  workspaceName: string;
  workspaceRegion: string;
  account: {
    email: string;
    name: string;
    role: string;
  };
  initialTrialStatus: TrialStatus | null;
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

export function SelfServeShell({
  children,
  workspaceName,
  workspaceRegion,
  account,
  initialTrialStatus,
}: SelfServeShellProps) {
  const pathname = usePathname() ?? "";
  const groups = useMemo(() => groupNavItems(navByVariant.self_serve), []);

  return (
    <SidebarProvider className="tw">
      <Sidebar collapsible="icon">
        <SidebarHeader className="p-3">
          <Link
            href="/self-serve"
            aria-label="Blockwise"
            className="inline-flex items-center text-[var(--brand-ink)] transition-opacity hover:opacity-80 group-data-[collapsible=icon]:justify-center"
          >
            <BlockwiseLogo />
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
          {/* Trial pill moves out of the topbar into the sidebar footer; hide it
              when the rail is collapsed to icons. */}
          <div className="group-data-[collapsible=icon]:hidden">
            <TrialStatusPill initialStatus={initialTrialStatus} />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-10 flex min-h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md md:px-7">
          <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
          <Link
            href="/self-serve"
            aria-label="Blockwise"
            className="inline-flex items-center text-foreground md:hidden"
          >
            <BlockwiseLogo showWordmark={false} />
          </Link>
          <span className="workspace-chip" aria-label={`Workspace: ${workspaceName}`}>
            {workspaceName} - {workspaceRegion}
          </span>
          <div className="ml-auto inline-flex items-center gap-3">
            <SidebarThemeToggle />
            <AccountMenu email={account.email} name={account.name} role={account.role} />
          </div>
        </header>
        {children}
      </SidebarInset>

      <SelfServeMobileNav account={account} />
    </SidebarProvider>
  );
}

// Mobile navigation for the self-serve shell: four primary destinations plus a
// "More" sheet for the rest. Hidden inside Ad Studio, which renders its own
// studio navigation.
const MOBILE_PRIMARY_HREFS = ["/self-serve", "/ad-studio", "/ad-radar", "/results"];

const MOBILE_PRIMARY_LABELS: Record<string, string> = {
  "/self-serve": "Home",
  "/ad-studio": "Studio",
  "/ad-radar": "Radar",
  "/results": "Performance",
};

function SelfServeMobileNav({
  account,
}: {
  account: { email: string; name: string; role: string };
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const { primaryItems, overflowItems } = useMemo(() => {
    const allItems = navByVariant.self_serve;
    const primary = MOBILE_PRIMARY_HREFS.map((href) => allItems.find((item) => item.href === href)).filter(
      (item): item is NavItem => Boolean(item),
    );
    const primarySet = new Set(primary.map((item) => item.href));
    return { primaryItems: primary, overflowItems: allItems.filter((item) => !primarySet.has(item.href)) };
  }, []);

  if (pathname.startsWith("/ad-studio")) {
    return null;
  }

  async function signOut() {
    setIsSigningOut(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function requestInstallPrompt() {
    window.dispatchEvent(new CustomEvent("blockwise:install-app-request"));
    setMoreOpen(false);
  }

  return (
    <>
      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 gap-1 border-t border-border bg-background/95 px-2.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
      >
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "grid min-h-13 min-w-0 place-items-center gap-[3px] rounded-(--r-card) px-0.5 py-1 text-[11px] leading-[1.1] font-bold",
                active ? "bg-(--accent-tint) text-(--accent-strong)" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden size={21} />
              <span className="max-w-full truncate">{MOBILE_PRIMARY_LABELS[item.href] ?? item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          className={cn(
            "grid min-h-13 min-w-0 cursor-pointer place-items-center gap-[3px] rounded-(--r-card) border-0 bg-transparent px-0.5 py-1 text-[11px] leading-[1.1] font-bold",
            moreOpen ? "bg-(--accent-tint) text-(--accent-strong)" : "text-muted-foreground",
          )}
        >
          <MoreHorizontal aria-hidden size={22} />
          <span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[min(76dvh,640px)] rounded-t-(--r-panel) pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="px-4 pt-5">
            <SheetTitle>{account.name}</SheetTitle>
            <SheetDescription>
              {account.role} - {account.email}
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
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-(--r-card) px-3 text-sm font-semibold",
                      active ? "bg-(--accent-tint) text-(--accent-strong)" : "text-foreground hover:bg-muted",
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
              onClick={requestInstallPrompt}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-(--r-card) border border-border bg-(--surface) px-4 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <Download aria-hidden size={18} />
              Install app
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={isSigningOut}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-(--r-card) border border-border bg-(--surface) px-4 text-sm font-semibold text-(--rose) hover:bg-muted disabled:opacity-60"
            >
              <LogOut aria-hidden size={18} />
              {isSigningOut ? "Signing out" : "Sign out"}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
