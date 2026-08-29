"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const CONSENT_KEY = "bw-consent";

export type ConsentStatus = "granted" | "essential";

export function getConsentStatus(): ConsentStatus | null {
  if (typeof window === "undefined") return null;
  const val = localStorage.getItem(CONSENT_KEY);
  if (val === "granted" || val === "essential") return val;
  return null;
}

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
  window.dispatchEvent(new CustomEvent("blockwise:consent-changed", { detail: { status } }));
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = getConsentStatus();
    if (stored) {
      applyConsent(stored);
    } else {
      setVisible(true);
    }
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
