"use client";

import { ChartNoAxesCombined, Download, Ellipsis, House, LifeBuoy, LogOut, Palette, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { niche } from "@/config/niche";
import { isItemActive, navByVariant, type NavItem } from "@/components/sidebar-nav";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type MobileBottomNavProps = {
  homeHref?: string;
  account: { email: string; name: string; role: string };
  homePilot?: boolean;
};

type MobileNavItem = NavItem & { mobileLabel?: string };

function customerItems(): { primaryItems: MobileNavItem[]; overflowItems: MobileNavItem[] } {
  const allItems = navByVariant.self_serve;
  const byHref = (href: string) => allItems.find((item) => item.href === href);
  const primaryItems = [byHref("/self-serve"), byHref("/ad-studio"), byHref("/results"), byHref("/leads")]
    .filter((item): item is NavItem => Boolean(item));
  const primaryHrefs = new Set(primaryItems.map((item) => item.href));
  return { primaryItems, overflowItems: allItems.filter((item) => !primaryHrefs.has(item.href)) };
}

function itemIsActive(pathname: string, item: MobileNavItem, homeHref: string) {
  if (item.href === "/ad-studio") return pathname === "/ad-studio" || pathname.startsWith("/ad-studio/");
  if (pathname.startsWith("/ad-studio/")) return false;
  if (item.href === homeHref) {
    return pathname === homeHref || pathname.startsWith(`${homeHref}/`);
  }
  return isItemActive(pathname, item.href, navByVariant.self_serve);
}

export function MobileBottomNav({ homeHref = "/self-serve", account, homePilot = false }: MobileBottomNavProps) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { primaryItems, overflowItems } = useMemo(() => customerItems(), []);
  const copy = niche.copy.shell;
  const activeItems = navByVariant.self_serve;
  const moreCurrent = !pathname.startsWith("/ad-studio/") && overflowItems.some((item) => itemIsActive(pathname, item, homeHref));
  const moreActive = moreOpen || moreCurrent;

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
      <nav className={`mobile-bottom-nav mobile-bottom-nav--customer${homePilot ? " mobile-bottom-nav--customer-home" : ""}`} aria-label="Primary mobile navigation">
        {primaryItems.map((item) => {
          const Icon = homePilot
            ? item.href === homeHref
              ? House
              : item.href === "/ad-studio"
                ? Palette
                : item.href === "/results"
                  ? ChartNoAxesCombined
                  : item.href === "/leads"
                    ? UsersRound
                    : item.icon
            : item.icon;
          const active = itemIsActive(pathname, item, homeHref);
          return (
            <Link className={active ? "mobile-bottom-nav-item active" : "mobile-bottom-nav-item"} href={item.href} key={item.href} aria-current={active ? "page" : undefined}>
              <Icon aria-hidden size={homePilot ? 22 : 21} strokeWidth={homePilot ? 1.9 : undefined} />
              <span>{item.mobileLabel ?? item.label}</span>
            </Link>
          );
        })}
        <button ref={moreButton} className={moreActive ? "mobile-bottom-nav-item active" : "mobile-bottom-nav-item"} type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen} aria-controls="mobile-more-sheet" aria-current={moreCurrent ? "page" : undefined} aria-pressed={moreActive}>
          {homePilot ? (
            <Ellipsis aria-hidden size={22} strokeWidth={1.9} />
          ) : (
            <span className="text-[18px]">⋯</span>
          )}
          <span>{copy.more}</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent onCloseAutoFocus={(event) => { event.preventDefault(); moreButton.current?.focus(); }} id="mobile-more-sheet" side="bottom" className="max-h-[min(76dvh,640px)] rounded-t-(--r-panel) pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="px-4 pt-5">
            <SheetTitle>{account.name}</SheetTitle>
            <SheetDescription>{account.role} · {account.email}</SheetDescription>
          </SheetHeader>
          {overflowItems.length > 0 ? (
            <div className="grid gap-1 px-3">
              {overflowItems.map((item) => {
                const Icon = item.icon;
                const active = itemIsActive(pathname, item, homeHref);
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setMoreOpen(false)} className={active ? "flex min-h-11 items-center gap-3 rounded-(--r-card) bg-(--accent-tint) px-3 text-sm font-semibold text-foreground" : "flex min-h-11 items-center gap-3 rounded-(--r-card) px-3 text-sm font-semibold text-foreground hover:bg-muted"}>
                    <Icon aria-hidden size={18} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ) : null}
          <div className="mt-auto grid gap-2 px-4 pt-2">
            <a href="mailto:hello@blockwise.sale?subject=Blockwise%20support" onClick={() => setMoreOpen(false)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-(--r-card) border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <LifeBuoy aria-hidden size={18} /> Contact support
            </a>
            <button type="button" onClick={requestInstallPrompt} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-(--r-card) border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted">
              <Download aria-hidden size={18} /> {copy.installApp}
            </button>
            <button type="button" onClick={() => void signOut()} disabled={isSigningOut} className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-(--r-card) border border-border bg-card px-4 text-sm font-semibold text-error hover:bg-muted disabled:opacity-60">
              <LogOut aria-hidden size={18} /> {isSigningOut ? "Signing out" : copy.signOut}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
