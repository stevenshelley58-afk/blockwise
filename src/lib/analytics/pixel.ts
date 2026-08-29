/**
 * Typed Meta Pixel (fbq) helpers for the marketing site.
 *
 * The base pixel snippet is injected in `src/app/layout.tsx` and fires a
 * `PageView` on load. These helpers fire conversion + intent events from
 * client components. They no-op safely on the server or before the pixel
 * script has initialised.
 */

type FbqArgs =
  | ["track", string, Record<string, unknown>?]
  | ["trackCustom", string, Record<string, unknown>?]
  | ["init", string]
  | ["consent", "grant" | "revoke"];

declare global {
  interface Window {
    fbq?: (...args: FbqArgs) => void;
  }
}

function fbq(...args: FbqArgs): void {
  if (typeof window === "undefined") return;
  try {
    window.fbq?.(...args);
  } catch {
    // Pixel is best-effort; never let analytics break the UI.
  }
}

/** Standard "Lead" conversion — fire when a demo/access request is submitted. */
export function trackLead(params?: Record<string, unknown>): void {
  fbq("track", "Lead", params);
}

/** Standard "Contact" event — generic contact intent. */
export function trackContact(params?: Record<string, unknown>): void {
  fbq("track", "Contact", params);
}

/**
 * Custom intent event — fire when a visitor clicks any tracked CTA.
 * Use the `label` to distinguish hero, nav, trial, pricing, faq-walkthrough, etc.
 * Pair with a separate "BookDemoClick" event for managed-setup CTAs.
 */
export function trackCtaClick(label: string, params?: Record<string, unknown>): void {
  fbq("trackCustom", "cta_click", { cta: label, ...(params ?? {}) });
}

/** Custom intent event — fire when a visitor clicks a "Book a demo" CTA. */
export function trackDemoCtaClick(location: string): void {
  fbq("trackCustom", "BookDemoClick", { location });
}
