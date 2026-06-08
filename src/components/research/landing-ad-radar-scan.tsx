"use client";

import { useState } from "react";

import { AdRadarLocationForm } from "./ad-radar-location-form";
import { PublicAdRadarDialog } from "./public-ad-radar-dialog";

type LandingAdRadarScanProps = {
  buttonLabel: string;
  initialNote: string;
  initialValue: string;
  placeholder: string;
  useBestGuess?: boolean;
};

export function LandingAdRadarScan({
  buttonLabel,
  initialNote,
  initialValue,
  placeholder,
  useBestGuess = false,
}: LandingAdRadarScanProps) {
  const [location, setLocation] = useState(initialValue);
  const [open, setOpen] = useState(false);

  function openScan(searchTerm: string) {
    setLocation(searchTerm);
    setOpen(true);
  }

  return (
    <>
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
      <PublicAdRadarDialog location={location} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
