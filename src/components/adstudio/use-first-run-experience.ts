"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AdStudioCampaignPack } from "@/lib/adstudio";

import type { CopyState } from "./use-copy";

export type NewAdStep = "source" | "template";

export type FirstRunExperienceOptions = {
  /** Initial pack — used to decide whether to auto-open the New Ad dialog. */
  initialPack: AdStudioCampaignPack;
  /** Set by the page when the user is on the trial-onboarding ?first=1 route. */
  firstRun: boolean;
  /**
   * Called once a fresh uploaded image should trigger an auto-generated ad.
   * Returns when the copy has been written.
   */
  onAutoDesign: (uploadedSrc: string) => Promise<void> | void;
  /**
   * Optional gate: the magic moment only fires when the copy on the screen
   * still matches what was seeded (no manual edits). Receives the current
   * copy and the snapshot taken at mount.
   */
  copyUntouched: (current: CopyState) => boolean;
  /** True while a copy generation is already running. */
  generating: boolean;
  /** Setter to switch the rail section (e.g. to "copy" after auto-design). */
  setSection: (section: "copy") => void;
  /** Busy indicator: shows the "Designing your ad from your photo..." overlay. */
  setBusy: (busy: boolean) => void;
  setBusyMessage: (message: string) => void;
};

/**
 * Owns the "first ad" onboarding:
 *  - the New Ad dialog state (open / step / templateId)
 *  - the auto-open of the dialog when a fresh user lands with no variants
 *  - the magic-moment: when a user uploads an image to a brand-new, untouched
 *    ad, automatically generate copy so the upload visibly produces an ad.
 *
 * Extracted from the workbench so the gates (untouched copy, first-run,
 * no-variants, once-per-session) all live in one readable place.
 */
export function useFirstRunExperience(options: FirstRunExperienceOptions) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<NewAdStep>("source");
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // First open with no ad yet: show the New Ad popup (templates / reuse / radar).
  useEffect(() => {
    if (options.initialPack.variants.length === 0) {
      setStep("source");
      setOpen(true);
    }
  }, [options.initialPack.variants.length]);

  const openNewAd = useCallback((nextTemplateId?: string, nextStep: NewAdStep = "source") => {
    setTemplateId(nextTemplateId);
    setStep(nextStep);
    setOpen(true);
  }, []);

  const closeNewAdDialog = useCallback(() => {
    setOpen(false);
    setTemplateId(undefined);
  }, []);

  /**
   * Magic-moment handler. Call this after an image has been uploaded; it
   * checks the gates and (when they pass) kicks off an auto-design.
   *
   * Returns the uploaded src so the caller can update the canvas; returns
   * undefined if the magic moment didn't fire (caller's choice to handle).
   */
  const handleUploadedImage = useCallback(
    async (uploaded: { src: string; label: string } | undefined, currentCopy: CopyState) => {
      if (!uploaded) return;
      const isNewAd = options.firstRun || options.initialPack.variants.length === 0;
      if (autoDesignedRef.current || options.generating || !isNewAd) return;
      if (!options.copyUntouched(currentCopy)) return;
      autoDesignedRef.current = true;
      options.setSection("copy");
      options.setBusy(true);
      options.setBusyMessage("Designing your ad from your photo...");
      try {
        await options.onAutoDesign(uploaded.src);
      } finally {
        options.setBusy(false);
      }
    },
    [options],
  );

  // Once per session: prevents the magic moment firing twice in a row.
  const autoDesignedRef = useRef(false);

  return {
    // New Ad dialog
    newAdOpen: open,
    newAdTemplateId: templateId,
    newAdStep: step,
    openNewAd,
    closeNewAdDialog,
    // Mobile ad details sheet
    mobileAdDetailsOpen: mobileSheetOpen,
    setMobileAdDetailsOpen: setMobileSheetOpen,
    // Magic moment
    handleUploadedImage,
  };
}
