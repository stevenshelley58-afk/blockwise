"use client";

import { Plug, X } from "lucide-react";
import { useEffect, useState } from "react";

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

  return bannerHidden ? (
    <section
      aria-live="polite"
      className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-(--line) bg-(--surface-subtle) px-3.5 py-2"
    >
      <span className="inline-flex items-center gap-2 text-[12px] font-bold">
        <span className="size-[7px] rounded-full bg-warning" aria-hidden />
        {demoChip}
      </span>
      <span className="flex items-center gap-3 text-[12px] font-bold">
        <a href={metaConnectHref} className="cursor-pointer font-bold text-foreground underline-offset-2 hover:underline">
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
      className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-(--r-card) border border-(--line) bg-(--surface-subtle) px-4 py-3.5 shadow-card"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-1 size-[8px] shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0 text-[13px] leading-snug">
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
  );
}
