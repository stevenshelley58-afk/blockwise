"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { CONSENT_KEY, getConsentStatus, type ConsentStatus } from "@/lib/analytics/consent";
export { CONSENT_KEY, getConsentStatus } from "@/lib/analytics/consent";

function applyConsent(status: ConsentStatus): void {
  if (typeof window === "undefined") return;
  try {
    if (status === "granted") {
      window.fbq?.("consent", "grant");
    } else {
      window.fbq?.("consent", "revoke");
    }
  } catch {
    // best-effort
  }
  try {
    window.gtag?.("consent", "update", {
      ad_storage: status === "granted" ? "granted" : "denied",
      ad_user_data: status === "granted" ? "granted" : "denied",
      ad_personalization: status === "granted" ? "granted" : "denied",
      analytics_storage: status === "granted" ? "granted" : "denied",
    });
  } catch {
    // The optional Google tag may not have loaded.
  }
  try {
    window.clarity?.("consentv2", {
      ad_Storage: status === "granted" ? "granted" : "denied",
      analytics_Storage: status === "granted" ? "granted" : "denied",
    });
    if (status !== "granted") window.clarity?.("stop");
  } catch {
    // Optional session recording must never interrupt consent changes.
  }
  window.dispatchEvent(new CustomEvent("blockwise:consent-changed", { detail: { status } }));
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const open = () => setVisible(true);
    window.addEventListener("blockwise:consent-open", open);
    const stored = getConsentStatus();
    if (stored) {
      applyConsent(stored);
    } else {
      setVisible(true);
    }
    return () => window.removeEventListener("blockwise:consent-open", open);
  }, []);

  function handleAccept() {
    localStorage.setItem(CONSENT_KEY, "granted");
    applyConsent("granted");
    setVisible(false);
  }

  function handleEssential() {
    localStorage.setItem(CONSENT_KEY, "essential");
    applyConsent("essential");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="consent-banner" role="region" aria-label="Cookie consent">
      <p className="consent-banner__text">
        We use cookies to understand how visitors use Blockwise and to improve our ads.{" "}
        <Link href="/privacy" className="consent-banner__link">
          Privacy policy
        </Link>
      </p>
      <div className="consent-banner__actions">
        <button type="button" className="consent-banner__btn consent-banner__btn--primary" onClick={handleAccept}>
          Accept all
        </button>
        <button type="button" className="consent-banner__btn consent-banner__btn--secondary" onClick={handleEssential}>
          Essential only
        </button>
      </div>
    </div>
  );
}

/** Reopens the existing banner; no parallel consent state or tracking code. */
export function CookiePreferencesButton() {
  return (
    <button type="button" className="consent-banner__btn consent-banner__btn--secondary"
      onClick={() => window.dispatchEvent(new CustomEvent("blockwise:consent-open"))}>
      Change cookie preferences
    </button>
  );
}
