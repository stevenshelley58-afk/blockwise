"use client";

import { useEffect, useRef } from "react";

import type { AdStudioCampaignPack } from "@/lib/adstudio";

import type { SaveState } from "./use-ad-studio";
import type { CopyState } from "./use-copy";

type UseWorkbenchAutosaveInput = {
  saveDraft: (options?: { silent?: boolean }) => Promise<boolean>;
  saveState: SaveState;
  campaignGoal: string;
  copy: CopyState;
  destinationUrl: string;
  market: string;
  offerLabel: string;
  pack: AdStudioCampaignPack;
  primaryImage: string;
  selectedVariantIndex: number;
};

/** Debounced draft autosave while edits are pending, plus a flush on page exit. */
export function useWorkbenchAutosave({
  saveDraft,
  saveState,
  campaignGoal,
  copy,
  destinationUrl,
  market,
  offerLabel,
  pack,
  primaryImage,
  selectedVariantIndex,
}: UseWorkbenchAutosaveInput) {
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftRef = useRef<((options?: { silent?: boolean }) => Promise<boolean>) | null>(null);
  const saveStateRef = useRef<SaveState>("saved");

  useEffect(() => {
    saveDraftRef.current = saveDraft;
    saveStateRef.current = saveState;
  }, [saveDraft, saveState]);

  useEffect(() => {
    if (saveState !== "saving") return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const timer = setTimeout(() => {
      void saveDraft({ silent: true });
    }, 900);
    autoSaveTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [
    campaignGoal,
    copy,
    destinationUrl,
    market,
    offerLabel,
    pack,
    primaryImage,
    saveDraft,
    selectedVariantIndex,
    saveState,
  ]);

  useEffect(() => {
    function flushPendingDraft() {
      if (saveStateRef.current === "saving") {
        void saveDraftRef.current?.({ silent: true });
      }
    }

    window.addEventListener("pagehide", flushPendingDraft);
    window.addEventListener("beforeunload", flushPendingDraft);
    return () => {
      flushPendingDraft();
      window.removeEventListener("pagehide", flushPendingDraft);
      window.removeEventListener("beforeunload", flushPendingDraft);
    };
  }, []);
}
