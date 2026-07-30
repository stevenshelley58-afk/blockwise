"use client";

import { useCallback, useRef, useState } from "react";

export type StudioSection =
  | "home"
  | "media"
  | "edit"
  | "publish"
  | "brand"
  | "settings";
export type SaveState = "saved" | "saving" | "error";
export type MobileTab = "home" | "media" | "edit" | "publish" | "brand" | "settings";

export function useAdStudio(initialSection: StudioSection = "home") {
  const [section, setSection] = useState<StudioSection>(initialSection);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Generating ad");
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveStateInternal] = useState<SaveState>("saved");
  // null until a save actually happens client-side — rendering a wall-clock time
  // during SSR caused a hydration text mismatch on every page load.
  const [savedAtLabel, setSavedAtLabel] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>(initialSection);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  // L5: include save timestamp for better user feedback (set on save, not on render)
  const setSaveState = useCallback((state: SaveState) => {
    setSaveStateInternal(state);
    if (state === "saved") {
      setSavedAtLabel(`at ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`);
    }
  }, []);

  const statusText =
    saveState === "saving"
      ? "Saving..."
      : saveState === "error"
        ? `Could not save: ${saveError}`
        : savedAtLabel
          ? `Saved ${savedAtLabel}`
          : "Saved";

  return {
    section,
    setSection,
    showMore,
    setShowMore,
    busy,
    setBusy,
    busyMessage,
    setBusyMessage,
    toast,
    saveState,
    setSaveState,
    saveError,
    setSaveError,
    mobileTab,
    setMobileTab,
    showToast,
    statusText,
  };
}
