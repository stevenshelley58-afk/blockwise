"use client";

import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { StudioNavigation, type StudioSection } from "@/components/adstudio/studio-navigation";

function sectionForPath(pathname: string, tab: string | null): StudioSection {
  if (pathname.startsWith("/ad-studio/brand")) return "brand";
  if (pathname.includes("/library")) return tab === "assets" ? "assets" : "ads";
  return "create";
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/ad-studio";
  const searchParams = useSearchParams();
  const active = sectionForPath(pathname, searchParams.get("tab"));

  return (
    <div className="tw flex min-h-dvh bg-background text-foreground">
      <aside className="hidden w-[220px] shrink-0 flex-col bg-(--ink) px-3 py-5 text-white lg:flex" aria-label="Ad Studio workspace">
        <Link href="/ad-studio" aria-label="Ad Studio home" className="mb-8 flex items-center gap-2.5 px-2 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
          <span className="grid size-8 place-items-center rounded-(--r-control) bg-white text-(--ink)">
            <BlockwiseLogo tokens showWordmark={false} className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-[15px] font-extrabold tracking-[-0.02em]">Ad Studio</span>
            <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-white/50">Private workbench</span>
          </span>
        </Link>

        <StudioNavigation active={active} />

        <div className="mt-auto grid gap-3 px-2">
          <div className="rounded-(--r-control) border border-white/10 px-3 py-2.5 text-xs text-white/65">
            <span className="flex items-center gap-1.5 font-semibold text-white/85"><CheckCircle2 aria-hidden className="size-3.5" /> Meta connection</span>
            <span className="mt-1 block leading-relaxed">Manage connection and permissions in Settings.</span>
          </div>
          <Link href="/self-serve" className="inline-flex min-h-11 items-center gap-2 rounded-(--r-control) bg-white/10 px-3 text-sm font-semibold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
            <ArrowLeft aria-hidden className="size-4" />
            Back to Blockwise
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center border-b border-border bg-card px-4 lg:hidden">
          <Link href="/ad-studio" aria-label="Ad Studio home" className="flex items-center gap-2 font-display text-base font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BlockwiseLogo tokens showWordmark={false} className="size-6" />
            Ad Studio
          </Link>
          <Link href="/self-serve" className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft aria-hidden className="size-4" />
            Exit
          </Link>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
        <div className="lg:hidden">
          <StudioNavigation active={active} mobile />
        </div>
      </div>
    </div>
  );
}
