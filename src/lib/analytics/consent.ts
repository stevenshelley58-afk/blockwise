export const CONSENT_KEY = "bw-consent";
export type ConsentStatus = "granted" | "essential";
export function getConsentStatus(): ConsentStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "essential" ? value : null;
  } catch {
    return null;
  }
}
