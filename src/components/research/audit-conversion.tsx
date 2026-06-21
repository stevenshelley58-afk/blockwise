"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";

type TrackingWindow = Window & {
  fbq?: (...args: unknown[]) => void;
  gtag?: (...args: unknown[]) => void;
};

function fire(event: string, market: string) {
  try {
    track(event, { market });
  } catch {
    // analytics is best-effort
  }
  if (typeof window === "undefined") return;
  const w = window as TrackingWindow;
  try {
    w.fbq?.("trackCustom", event, { market });
  } catch {
    // pixel may be blocked
  }
  try {
    w.gtag?.("event", event, { market });
  } catch {
    // gtag may be absent
  }
}

/** Fires an audit_view event on mount so viewers can be retargeted. */
export function AuditViewTracker({ market }: { market: string }) {
  useEffect(() => {
    fire("audit_view", market);
  }, [market]);
  return null;
}

/** Primary call to action: a tracked link into the signup / trial flow. */
export function AuditCtaButton({
  href,
  market,
  className,
  children,
}: {
  href: string;
  market: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => fire("audit_cta_click", market)}>
      {children}
    </Link>
  );
}
