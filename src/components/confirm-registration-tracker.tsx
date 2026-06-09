"use client";

import { useEffect } from "react";

import { getConsentStatus } from "@/components/consent-banner";
import "@/lib/analytics/pixel";

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
      } catch {
        // best-effort
      }
    }
  }, []);

  return null;
}
