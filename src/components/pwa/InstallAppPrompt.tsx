"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallAppPromptProps = {
  className?: string;
};

export function InstallAppPrompt({ className }: InstallAppPromptProps) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [requested, setRequested] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [installed, setInstalled] = useState(false);
  const [manualInstallCopy, setManualInstallCopy] = useState("Use your browser's install option to add Blockwise to your home screen.");

  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    const alreadyInstalled = window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
    setInstalled(alreadyInstalled);

    function getManualInstallCopy() {
      return /iPhone|iPad|iPod/i.test(navigator.userAgent)
        ? "On iPhone, tap Share, then Add to Home Screen."
        : "Use your browser's install option to add Blockwise to your home screen.";
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setInstalled(false);
    }

    function onInstallRequest() {
      setManualInstallCopy(getManualInstallCopy());
      setRequested(true);
      setHidden(false);
    }

    function onAppInstalled() {
      setInstalled(true);
      setInstallPrompt(null);
      setHidden(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("blockwise:install-app-request", onInstallRequest);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("blockwise:install-app-request", onInstallRequest);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (!requested || hidden || installed) {
    return null;
  }

  async function install() {
    const promptEvent = installPrompt;
    if (!promptEvent) {
      return;
    }

    setInstallPrompt(null);
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      setHidden(true);
    }
  }

  const hasNativePrompt = Boolean(installPrompt);
  const classes = className ? `pwa-install-prompt ${className}` : "pwa-install-prompt";

  return (
    <div className={classes} role="dialog" aria-label="Install Blockwise app">
      <div className="pwa-install-copy">
        <strong>{hasNativePrompt ? "Install Blockwise" : "Add Blockwise to your phone"}</strong>
        <p>{hasNativePrompt ? "Add it to your home screen for direct mobile access." : manualInstallCopy}</p>
      </div>
      <div className="pwa-install-actions">
        {hasNativePrompt ? (
          <button className="pwa-install-primary" type="button" onClick={install}>
            Install
          </button>
        ) : null}
        <button className="pwa-install-dismiss" type="button" onClick={() => setHidden(true)} aria-label="Dismiss install app prompt">
          Dismiss
        </button>
      </div>
    </div>
  );
}
