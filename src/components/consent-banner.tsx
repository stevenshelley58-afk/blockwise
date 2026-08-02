"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

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
    <div
      className="consent-banner tw fixed inset-x-0 bottom-0 z-100 flex flex-wrap items-center gap-4 border-t border-border bg-card px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-card-foreground shadow-float"
      role="region"
      aria-label="Cookie consent"
    >
      <p className="min-w-50 flex-1 text-sm leading-6 text-muted-foreground">
        We use cookies to understand how visitors use Blockwise and to improve our ads.{" "}
        <Link href="/privacy" className="font-semibold text-foreground underline underline-offset-4">
          Privacy policy
        </Link>
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button type="button" variant="signal" onClick={handleAccept}>
          Accept all
        </Button>
        <Button type="button" variant="outline" onClick={handleEssential}>
          Essential only
        </Button>
      </div>
    </div>
  );
}
