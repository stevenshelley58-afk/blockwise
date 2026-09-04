"use client";

import {
  ArrowLeft,
  FolderOpen,
  LayoutGrid,
  Palette,
  SquarePen,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { cn } from "@/lib/utils";

type StudioShellProps = {
  children: ReactNode;
  workspaceName: string;
  accountName: string;
  metaConnectionStatus: "connected" | "attention" | "not_connected" | "unknown";
};

const items = [
  { href: "/ad-studio", label: "Create", icon: SquarePen, exact: true },
  { href: "/ad-studio/ads", label: "Ads", icon: LayoutGrid },
  { href: "/ad-studio/assets", label: "Assets", icon: FolderOpen },
  { href: "/ad-studio/brand", label: "Brand Pack", icon: Palette },
];

function activePath(pathname: string, href: string, exact?: boolean) {
  return exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function StudioShell({
  children,
  workspaceName,
  accountName,
  metaConnectionStatus,
}: StudioShellProps) {
  const pathname = usePathname() ?? "/ad-studio";
  const contextual =
    pathname.startsWith("/ad-studio/templates/") ||
    pathname.startsWith("/ad-studio/ads/");
  const connectionLabel =
    metaConnectionStatus === "connected"
      ? "Meta connected"
      : metaConnectionStatus === "attention"
        ? "Meta needs attention"
        : metaConnectionStatus === "unknown"
          ? "Meta connection status unavailable"
          : "Meta not connected";
  return (
    <div className={cn("tw flex bg-background text-foreground", contextual ? "h-dvh overflow-hidden" : "min-h-dvh")}>
      <aside
        className="hidden w-[220px] shrink-0 flex-col bg-(--ink) text-(--surface) md:flex"
        aria-label="Ad Studio navigation"
      >
        <div className="flex items-center gap-3 px-5 py-7">
          <Link
            href="/self-serve"
            aria-label="Back to Blockwise"
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-transparent text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <BlockwiseLogo tokens showWordmark={false} />
          </Link>
          <div>
            <p className="font-display text-[15.5px] font-extrabold leading-tight">
              Ad Studio
            </p>
            <p className="text-[11px] text-white/55">by Blockwise</p>
          </div>
        </div>
        <nav className="grid gap-1 px-3" aria-label="Studio destinations">
          {items.map(({ href, label, icon: Icon, exact }) => {
            const active = activePath(pathname, href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                  active ? "bg-white/10 text-white" : "text-white/65",
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
            className="truncate rounded-xl border border-white/10 px-3 py-2.5 text-[11px] text-white/65"
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
            href="/self-serve"
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[12px] font-semibold text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft size={17} aria-hidden />
            Back to Blockwise
          </Link>
          <p
            className="truncate px-3 text-[10px] text-white/35"
            title={`${workspaceName} · ${accountName}`}
          >
            {workspaceName} · {accountName}
          </p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {!contextual ? (
          <header className="flex min-h-14 items-center border-b border-border bg-(--ink) px-4 text-(--surface) md:hidden">
            <Link
              href="/self-serve"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-transparent text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Back to Blockwise"
            >
              <BlockwiseLogo tokens showWordmark={false} />
            </Link>
            <span className="min-w-0 truncate font-display text-[15.5px] font-extrabold">
              Ad Studio
            </span>
            <span
              className="ml-auto max-w-[42%] truncate text-[11px] text-white/60"
              title={workspaceName}
            >
              {workspaceName}
            </span>
          </header>
        ) : null}
        <main className={cn("min-w-0 flex-1", contextual ? "min-h-0 overflow-hidden" : "pb-24 md:pb-0")}>
          {children}
        </main>
        {!contextual ? (
          <nav
            className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-border bg-card px-1 pt-1.5 pb-[calc(.5rem+env(safe-area-inset-bottom))] md:hidden"
            aria-label="Studio mobile navigation"
          >
            {items.map(({ href, label, icon: Icon, exact }) => {
              const active = activePath(pathname, href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "grid min-h-11 place-items-center gap-0.5 rounded-xl px-1 text-[10px] font-bold",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon size={18} aria-hidden />
                  <span>{label === "Brand Pack" ? "Brand" : label}</span>
                </Link>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
