// Google Ads / gtag helpers. All calls no-op when window.gtag is absent.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export function gtagConversionDemoForm(adsId: string): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "conversion", { send_to: `${adsId}/demo_form` });
}

export function gtagConversionSignup(adsId: string): void {
  // TODO: Call alongside CompleteRegistration in confirm-registration-tracker.tsx
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "conversion", { send_to: `${adsId}/signup` });
}
