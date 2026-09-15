"use client";

import {
  ArrowLeft,
  Film,
  Home,
  Library,
  LayoutTemplate,
  Palette,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { MobileBottomNav } from "@/components/app/mobile-bottom-nav";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { cn } from "@/lib/utils";

type StudioShellProps = {
  children: ReactNode;
  workspaceName: string;
  homeHref?: string;
  account: { email: string; name: string; role: string };
  metaConnectionStatus: "connected" | "attention" | "not_connected" | "unknown";
};

const items = [
  { href: "/ad-builder", label: "Home", icon: Home, exact: true },
  { href: "/ad-builder/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/ad-builder/video", label: "Video", icon: Film },
  { href: "/ad-builder/library", label: "Library", icon: Library, matches: ["/ad-builder/library", "/ad-builder/ads", "/ad-builder/assets"] },
  { href: "/ad-builder/brand", label: "Brand Pack", icon: Palette },
];

function activePath(pathname: string, href: string, exact?: boolean) {
  return exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

/*
 * Ad Builder is the dark theme of this same app, not a second design system, so
 * the theme is the shared `[data-theme="studio-dark"]` token block — nothing
 * here re-declares a colour.
 *
 * The attribute is written in two places for two different reasons:
 *
 *  1. On the shell's own <div> (below), so the tree is already correct in the
 *     server-rendered HTML and there is no flash of light before hydration.
 *  2. On <html>, from this effect, because Radix portals Sheet / Dialog /
 *     AlertDialog / Select / Popover / DropdownMenu to document.body — outside
 *     the shell's <div> — and a scope that only wrapped the shell would leave
 *     every overlay rendering in the light palette.
 *
 * The mount count and the saved previous value are module-scoped on purpose:
 * during a route transition two Studio surfaces can be mounted at the same
 * time, and the second one's cleanup must not undo the first one's attribute.
 * The first mount in records what the app had and sets the theme; only the last
 * unmount restores it, so leaving Ad Builder returns the app to light and the
 * handover in between never flickers.
 */
let studioThemeMounts = 0;
let studioThemePrevious: string | null = null;

function useStudioDarkThemeOnDocument() {
  useEffect(() => {
    const root = document.documentElement;
    if (studioThemeMounts === 0) {
      studioThemePrevious = root.getAttribute("data-theme");
      root.setAttribute("data-theme", "studio-dark");
    }
    studioThemeMounts += 1;
    return () => {
      studioThemeMounts -= 1;
      if (studioThemeMounts > 0) return;
      if (studioThemePrevious === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", studioThemePrevious);
      studioThemePrevious = null;
    };
  }, []);
}

export function StudioShell({
  children,
  workspaceName,
  account,
  homeHref = "/ad-studio",
  metaConnectionStatus,
}: StudioShellProps) {
  const pathname = usePathname() ?? "/ad-builder";
  useStudioDarkThemeOnDocument();
  const contextual = pathname.startsWith("/ad-builder/ads/");
  const connectionLabel =
    metaConnectionStatus === "connected"
      ? "Meta connected"
      : metaConnectionStatus === "attention"
        ? "Meta needs attention"
        : metaConnectionStatus === "unknown"
          ? "Meta connection status unavailable"
          : "Meta not connected";
  return (
    <div
      data-theme="studio-dark"
      className={cn("tw flex bg-background text-foreground", contextual ? "h-dvh overflow-hidden" : "min-h-dvh")}
    >
      <aside
        className="hidden w-[220px] shrink-0 flex-col bg-(--surface) text-(--muted) md:flex"
        aria-label="Ad Builder navigation"
      >
        <div className="flex items-center gap-3 px-5 py-7">
          <Link
            href="/ad-studio"
            aria-label="Back to Blockwise"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-transparent text-(--ink) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BlockwiseLogo tokens showWordmark={false} />
          </Link>
          <div>
            <p className="font-display text-[15.5px] font-extrabold leading-tight">
              Ad Builder
            </p>
            <p className="text-[11px] text-(--muted)">by Blockwise</p>
          </div>
        </div>
        <nav className="grid gap-1 px-3" aria-label="Studio destinations">
          {items.map(({ href, label, icon: Icon, exact, matches }) => {
            const active = matches
              ? matches.some(match => activePath(pathname, match))
              : activePath(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors hover:bg-(--ink)/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-(--ink)/10 text-(--ink)" : "text-(--muted)",
                )}
              >
                <Icon size={18} aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-2 px-3 pb-5">
          <div
            className="truncate rounded-xl border border-(--line) px-3 py-2.5 text-[11px] text-(--muted)"
            title={connectionLabel}
          >
            <span
              className={cn(
                "mr-2 inline-block size-1.5 rounded-full",
                metaConnectionStatus === "connected"
                  ? "bg-success"
                  : "bg-(--faint)",
              )}
              aria-hidden
            />
            {connectionLabel}
          </div>
          <Link
            href="/ad-studio"
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[12px] font-semibold text-(--muted) hover:bg-(--ink)/10 hover:text-(--ink) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={17} aria-hidden />
            Back to Blockwise
          </Link>
          <p
            className="truncate px-3 text-[10px] text-(--muted)/70"
            title={`${workspaceName} · ${account.name}`}
          >
            {workspaceName} · {account.name}
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {!contextual ? (
          <header className="flex min-h-14 items-center border-b border-(--line) bg-(--surface) px-4 text-(--muted) md:hidden">
            <Link
              href="/ad-studio"
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-1 text-[12px] font-semibold text-(--ink) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft size={16} aria-hidden />
              <span>Blockwise</span>
            </Link>
            <span className="ml-3 min-w-0 truncate font-display text-[15.5px] font-extrabold text-(--ink)">
              Ad Builder
            </span>
            <span
              className="ml-auto max-w-[42%] truncate text-[11px] text-(--muted)"
              title={workspaceName}
            >
              {workspaceName}
            </span>
          </header>
        ) : null}
        <main className={cn("min-w-0 flex-1", contextual ? "min-h-0 overflow-hidden pb-[calc(5rem+env(safe-area-inset-bottom)+var(--consent-banner-height,0px))] md:pb-0" : "pb-[calc(5rem+env(safe-area-inset-bottom)+var(--consent-banner-height,0px))] md:pb-0")}>
          {children}
        </main>
        <MobileBottomNav homeHref={homeHref} account={account} />
      </div>
    </div>
  );
}
