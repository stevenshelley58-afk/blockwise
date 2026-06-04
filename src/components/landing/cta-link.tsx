"use client";

import type { ReactNode } from "react";

import { trackDemoCtaClick } from "@/lib/analytics/pixel";

type CtaLinkProps = {
  /** Where on the page this CTA lives (sent to the pixel for attribution). */
  location: string;
  href?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Anchor for landing CTAs. Demo links fire a Meta Pixel intent event; signup links do not.
 */
export function CtaLink({ location, href = "#demo", className, children }: CtaLinkProps) {
  function handleClick() {
    if (href === "#demo") {
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
