"use client";

import { NoticeBar } from "@/components/ui/notice-bar";
import { niche } from "@/config/niche";

/**
 * Results' demo statement. It is the same bar Home's blocks of figures close
 * on, saying the same sentence: a workspace with no Meta connection reads an
 * example report, and this is the one place on the page that says so. The
 * example disappears by itself once Meta is connected, so the bar carries no
 * way to hide it.
 */
export function DemoModeNotice({ metaConnectHref }: { metaConnectHref: string }) {
  const copy = niche.copy.performance;

  return (
    <NoticeBar
      // The dashboard is a grid with its own gaps: the bar states none of its own.
      className="mt-0"
      text={copy.demoNote}
      action={{ href: metaConnectHref, label: copy.states.connectCta }}
    />
  );
}
