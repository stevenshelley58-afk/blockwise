"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

type AnalyticsProps = Record<string, string | number | boolean>;

type TrackingWindow = Window & {
  fbq?: (...args: unknown[]) => void;
  gtag?: (...args: unknown[]) => void;
};

function fire(event: string, props: AnalyticsProps = {}) {
  try {
    track(event, props);
  } catch {
    // analytics is best-effort
  }
  if (typeof window === "undefined") return;
  const w = window as TrackingWindow;
  try {
    w.fbq?.("trackCustom", event, props);
  } catch {
    // pixel may be blocked
  }
  try {
    w.gtag?.("event", event, props);
  } catch {
    // gtag may be absent
  }
}

/** Fires audit_page_viewed once on mount with the filtered audit properties. */
export function AuditAnalytics({ data }: { data: AnalyticsProps }) {
  useEffect(() => {
    fire("audit_page_viewed", data);
  }, [data]);
  return null;
}

/** In-page anchor that fires a tracking event on click. */
export function TrackedAnchor({
  href,
  event,
  data,
  className,
  children,
}: {
  href: string;
  event: string;
  data?: AnalyticsProps;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={className} onClick={() => fire(event, data)}>
      {children}
    </a>
  );
}

/** Tracked link into a route (signup / trial). */
export function AuditCtaButton({
  href,
  event = "signup_clicked",
  data,
  className,
  children,
}: {
  href: string;
  event?: string;
  data?: AnalyticsProps;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={className} onClick={() => fire(event, data)}>
      {children}
    </Link>
  );
}

/** Fires an event once when its children scroll into view. */
export function InViewTracker({
  event,
  data,
  children,
}: {
  event: string;
  data?: AnalyticsProps;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired.current) {
            fired.current = true;
            fire(event, data);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [event, data]);
  return <div ref={ref}>{children}</div>;
}

/** <details> accordion that fires competitor_evidence_opened the first time it opens. */
export function TrackedDetails({
  summary,
  data,
  defaultOpen,
  children,
}: {
  summary: string;
  data?: AnalyticsProps;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const fired = useRef(false);
  const openProps = defaultOpen ? { open: true } : {};
  return (
    <details
      {...openProps}
      onToggle={(event) => {
        if (event.currentTarget.open && !fired.current) {
          fired.current = true;
          fire("competitor_evidence_opened", { ...data, section: summary });
        }
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

/** Sticky mobile CTA that hides while the lead form is in view so it never covers the submit button. */
export function MobileCta({
  href,
  label,
  data,
}: {
  href: string;
  label: string;
  data?: AnalyticsProps;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const target = document.getElementById("lead");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setHidden(entry.isIntersecting);
      },
      { threshold: 0.15 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  if (hidden) return null;
  return (
    <div className="mobile-cta">
      <a
        className="lp-btn lp-btn-primary lp-btn-wide"
        href={href}
        onClick={() => fire("primary_cta_clicked", { ...data, placement: "mobile_sticky" })}
      >
        {label}
      </a>
    </div>
  );
}
