"use client";

import { useRef, useState } from "react";

export type StudioSection =
  | "campaign"
  | "templates"
  | "brand"
  | "media"
  | "copy"
  | "audience"
  | "publish"
  | "settings";
export type SaveState = "saved" | "saving" | "error";
export type MobileTab = "campaign" | "media" | "copy" | "publish";

export function useAdStudio() {
  const [section, setSection] = useState<StudioSection>("campaign");
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("Generating ad");
  const [toast, setToast] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("campaign");

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }

  // L5: include save timestamp for better user feedback
  function formatSaveTime() {
    return `at ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}`;
  }

  const statusText =
    saveState === "saving"
      ? "Saving..."
      : saveState === "error"
        ? `Could not save: ${saveError}`
        : `Saved ${formatSaveTime()}`;

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
