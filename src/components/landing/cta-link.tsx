"use client";

import type { ReactNode } from "react";

import { trackCtaClick, trackDemoCtaClick } from "@/lib/analytics/pixel";

type CtaLinkProps = {
  /** Where on the page this CTA lives — used as the `cta` label for attribution. */
  location: string;
  href?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Anchor for landing CTAs. Every click fires a `cta_click` custom event with
 * the location label. Links to `#managed-setup` (book-a-walkthrough) also
 * fire a `BookDemoClick` for analytics continuity.
 */
export function CtaLink({ location, href = "#managed-setup", className, children }: CtaLinkProps) {
  function handleClick() {
    trackCtaClick(location, { href });
    if (href.endsWith("#managed-setup")) {
      trackDemoCtaClick(location);
    }
  }

  return (
    <a
      href={href}
      className={className}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
