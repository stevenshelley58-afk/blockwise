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
 * Anchor that scrolls to the demo form and fires a Meta Pixel intent event.
 * Falls back to a normal in-page link if JS/pixel is unavailable.
 */
export function CtaLink({ location, href = "#demo", className, children }: CtaLinkProps) {
  return (
    <a
      href={href}
      className={className}
      onClick={() => trackDemoCtaClick(location)}
    >
      {children}
    </a>
  );
}
