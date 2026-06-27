"use client";

import { useRouter } from "next/navigation";

import { AdRadarLocationForm } from "./ad-radar-location-form";

type LandingAdRadarScanProps = {
  buttonLabel: string;
  initialNote: string;
  initialValue: string;
  placeholder: string;
  useBestGuess?: boolean;
};

/**
 * Landing "free audit" entry point. Submitting the suburb/postcode routes to the
 * full /audit report (built from the same scraped Meta Ad Library data the Local
 * Ad Radar dialog used to show inline).
 */
export function LandingAdRadarScan({
  buttonLabel,
  initialNote,
  initialValue,
  placeholder,
  useBestGuess = false,
}: LandingAdRadarScanProps) {
  const router = useRouter();

  function openScan(searchTerm: string) {
    router.push(`/audit?location=${encodeURIComponent(searchTerm)}`);
  }

  return (
    <AdRadarLocationForm
      buttonLabel={buttonLabel}
      emptySearchTerm={initialValue}
      initialNote={initialNote}
      initialValue=""
      onSearch={openScan}
      placeholder={initialValue || placeholder}
      surface="landing"
      useBestGuess={useBestGuess}
      useBestGuessAsPlaceholder
    />
  );
}
