"use client";

import { useEffect } from "react";

import { getConsentStatus } from "@/components/consent-banner";
import { gtagConversionSignup } from "@/lib/analytics/gtag";
import "@/lib/analytics/pixel";

const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

export function ConfirmRegistrationTracker() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") !== "1") return;

    // Remove ?confirmed=1 from the URL to prevent double-firing on refresh.
    params.delete("confirmed");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    history.replaceState(null, "", newUrl);

    // Only fire the pixel event if the user has granted consent.
    if (getConsentStatus() === "granted") {
      try {
        window.fbq?.("track", "CompleteRegistration");
        if (GOOGLE_ADS_ID) gtagConversionSignup(GOOGLE_ADS_ID);
      } catch {
        // best-effort
      }
    }
  }, []);

  return null;
}
