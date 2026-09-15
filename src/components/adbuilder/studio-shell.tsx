"use client";

import {
  ArrowLeft,
  Film,
  Home,
  Library,
  LayoutTemplate,
  Palette,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { MobileBottomNav } from "@/components/app/mobile-bottom-nav";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { Button } from "@/components/ui/button";
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
 * Ad Builder is a light product with a dark rail, not a second app.
 *
 * The `data-theme="studio-dark"` attribute is scoped to the rail and to the
 * mobile header, and to nothing else. That works because the block in
 * theme-monochrome.css restates the `--ui-*` bridge aliases as well as the raw
 * roles: a custom property's `var()` is substituted on the element that declares
 * it, so a NESTED scope only reaches `bg-(--surface)`, `text-(--ink)`,
 * `border-(--line)`, `ring-ring`, `bg-cta` and `bg-success` if it re-declares
 * the aliases too. It does.
 *
 * The attribute is deliberately NOT mirrored onto <html> and NOT set on this
 * component's own <div>. The canvas, the dialogs, the sheets and every portaled
 * overlay are the light theme; the rail is dark so the builder reads as a tool
 * inside the app rather than a second product. See DESIGN.md "Ad Builder theme".
 */

export function StudioShell({
  children,
  workspaceName,
  account,
  homeHref = "/ad-studio",
  metaConnectionStatus,
}: StudioShellProps) {
  const pathname = usePathname() ?? "/ad-builder";
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
      className={cn("tw flex bg-background text-foreground", contextual ? "h-dvh overflow-hidden" : "min-h-dvh")}
    >
      <aside
        data-theme="studio-dark"
        className="hidden w-[220px] shrink-0 flex-col border-r border-(--line) bg-(--surface) text-(--muted) md:flex"
        aria-label="Ad Builder navigation"
      >
        <div className="p-3">
          <Link
            href="/ad-studio"
            aria-label="Blockwise home"
            className="inline-flex items-center rounded-(--r-ctl) text-(--brand-ink) transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BlockwiseLogo tokens />
          </Link>
        </div>
        <div className="px-3 pt-1">
          <Button asChild className="w-full justify-start">
            <Link href="/ad-builder/templates" aria-label="Create a new ad from a reviewed template">
              <Plus className="size-4" aria-hidden />
              New ad
            </Link>
          </Button>
        </div>
        <nav className="mt-2 grid gap-1 px-3" aria-label="Studio destinations">
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
          <header
            data-theme="studio-dark"
            className="flex min-h-14 items-center border-b border-(--line) bg-(--surface) px-4 text-(--muted) md:hidden"
          >
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
