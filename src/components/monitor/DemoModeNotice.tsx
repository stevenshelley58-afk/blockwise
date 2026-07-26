"use client";

import { ChartNoAxesCombined, Plug, Radar, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { niche } from "@/config/niche";

const BANNER_HIDE_KEY = "bw-results-demo-banner-hidden";

const ghostButton =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-(--line-heavy) bg-card px-3.5 text-[12.5px] font-bold text-foreground transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card";
const inkButton =
  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-(--ink) px-4 text-[12.5px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.97]";

/**
 * Shown on Results while the workspace has no Meta connection and the
 * dashboard is filled with demo data. The full notice can be hidden into a
 * small strip; everything disappears automatically once Meta is connected.
 */
export function DemoModeNotice({ metaConnectHref }: { metaConnectHref: string }) {
  const demoChip = niche.copy.performance.demoChip;
  const [showGuide, setShowGuide] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(false);

  useEffect(() => {
    try {
      setBannerHidden(window.localStorage.getItem(BANNER_HIDE_KEY) === "true");
    } catch {
      setBannerHidden(false);
    }
  }, []);

  function hideBanner() {
    setBannerHidden(true);
    try {
      window.localStorage.setItem(BANNER_HIDE_KEY, "true");
    } catch {
      // Ignore unavailable storage; the in-session state is enough.
    }
  }

  function showBanner() {
    setBannerHidden(false);
    try {
      window.localStorage.removeItem(BANNER_HIDE_KEY);
    } catch {
      // Ignore unavailable storage; the in-session state is enough.
    }
  }

  return (
    <>
      {bannerHidden ? (
        <section
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-(--line) bg-(--surface-subtle) px-3.5 py-2"
        >
          <span className="inline-flex items-center gap-2 text-[12px] font-bold">
            <span className="size-[7px] rounded-full bg-warning" aria-hidden />
            {demoChip}
          </span>
          <span className="flex items-center gap-3 text-[12px] font-bold">
            <a href={metaConnectHref} className="cursor-pointer text-data underline-offset-2 hover:underline">
              Connect Meta
            </a>
            <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={showBanner}>
              Show
            </button>
          </span>
        </section>
      ) : (
        <section
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-4 py-3.5 shadow-card"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-1 size-[8px] shrink-0 rounded-full bg-warning" aria-hidden />
            <div className="text-[13px] leading-snug">
              <strong className="font-bold">{demoChip}</strong>{" "}
              <span className="text-muted-foreground">
                Connect Meta to replace it with your real spend, leads, and ads.
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a className={inkButton} href={metaConnectHref}>
              <Plug aria-hidden size={13} />
              Connect Meta
            </a>
            <button className={ghostButton} type="button" onClick={() => setShowGuide(true)}>
              Setup guide
            </button>
            <button
              className={`${ghostButton} px-2.5`}
              type="button"
              aria-label="Hide demo data notice"
              onClick={hideBanner}
            >
              <X aria-hidden size={13} />
            </button>
          </div>
        </section>
      )}

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="max-w-[440px] rounded-(--r-panel)">
          <DialogHeader>
            <DialogTitle className="font-display text-[19px] font-extrabold tracking-[-0.015em]">
              Welcome to Blockwise
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed">
              Everything on this page is <strong className="text-foreground">demo data</strong> — a preview of what
              Performance looks like once your ads are running. Getting set up takes about a minute.
            </DialogDescription>
          </DialogHeader>

          <ol className="grid gap-3.5">
            <GuideStep icon={<Plug aria-hidden size={15} />} title="Connect your Meta ad account">
              The demo data is dropped the moment you connect — only your real results are shown.
            </GuideStep>
            <GuideStep icon={<ChartNoAxesCombined aria-hidden size={15} />} title="Watch Performance fill with your numbers">
              Spend, leads, cost per lead, and ad-by-ad performance — updated automatically.
            </GuideStep>
            <GuideStep icon={<Radar aria-hidden size={15} />} title="Spy on competitors in Ad Radar">
              See the real ads other agencies are running in your postcodes right now.
            </GuideStep>
          </ol>

          <DialogFooter className="gap-2 sm:justify-start">
            <a className={inkButton} href={metaConnectHref}>
              Connect Meta
            </a>
            <button className={ghostButton} type="button" onClick={() => setShowGuide(false)}>
              Explore the demo first
            </button>
          </DialogFooter>

          <p className="text-[11.5px] text-(--faint)">
            You can connect any time from{" "}
            <a href="/settings" className="font-semibold text-muted-foreground underline underline-offset-2">
              Settings
            </a>
            .
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GuideStep({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--accent-tint) text-foreground">
        {icon}
      </span>
      <div className="text-[12.5px] leading-snug">
        <strong className="font-bold">{title}</strong>
        <p className="mt-0.5 text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
