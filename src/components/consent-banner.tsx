"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { CONSENT_KEY, getConsentStatus, type ConsentStatus } from "@/lib/analytics/consent";
export { CONSENT_KEY, getConsentStatus } from "@/lib/analytics/consent";

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
  try {
    window.gtag?.("consent", "update", {
      ad_storage: status === "granted" ? "granted" : "denied",
      ad_user_data: status === "granted" ? "granted" : "denied",
      ad_personalization: status === "granted" ? "granted" : "denied",
      analytics_storage: status === "granted" ? "granted" : "denied",
    });
  } catch {
    // The optional Google tag may not have loaded.
  }
  try {
    window.clarity?.("consentv2", {
      ad_Storage: status === "granted" ? "granted" : "denied",
      analytics_Storage: status === "granted" ? "granted" : "denied",
    });
    if (status !== "granted") window.clarity?.("stop");
  } catch {
    // Optional session recording must never interrupt consent changes.
  }
  window.dispatchEvent(new CustomEvent("blockwise:consent-changed", { detail: { status } }));
}

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const open = () => setVisible(true);
    window.addEventListener("blockwise:consent-open", open);
    const syncModalState = () => {
      setModalOpen(Boolean(document.querySelector('[role="dialog"][data-state="open"]')));
    };
    syncModalState();
    const modalObserver = new MutationObserver(syncModalState);
    modalObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state", "role"] });
    const stored = getConsentStatus();
    if (stored) {
      applyConsent(stored);
    } else {
      setVisible(true);
    }
    return () => {
      window.removeEventListener("blockwise:consent-open", open);
      modalObserver.disconnect();
      document.documentElement.style.setProperty("--consent-banner-height", "0px");
    };
  }, []);

  useEffect(() => {
    const node = bannerRef.current;
    const root = document.documentElement;
    const clear = () => {
      root.style.setProperty("--consent-banner-height", "0px");
      // Releases the page-bottom space reserved while the banner is on screen.
      root.classList.remove("bw-consent-visible");
    };
    if (!node || !visible || modalOpen) {
      clear();
      return;
    }
    const publishHeight = () => {
      root.style.setProperty("--consent-banner-height", `${node.getBoundingClientRect().height}px`);
      // Lets a page reserve space so the banner never covers the end of the page.
      root.classList.add("bw-consent-visible");
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(node);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [modalOpen, visible]);

  /**
   * The banner renders last in the document, so tabbing to it would mean
   * walking the whole page. Move focus to the primary choice once, on the
   * first appearance, and never steal it back when the banner is reopened
   * from the privacy policy. Focusing also makes a screen reader read it.
   */
  const focusMoved = useRef(false);
  useEffect(() => {
    if (!visible || modalOpen || focusMoved.current) return;
    const button = acceptRef.current;
    if (!button) return;
    focusMoved.current = true;
    button.focus({ preventScroll: true });
  }, [modalOpen, visible]);

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

  if (!visible || modalOpen) return null;

  return (
    <div ref={bannerRef} className="consent-banner" role="region" aria-label="Cookie consent">
      <p className="consent-banner__text">
        <span className="consent-banner__copy">
          We use cookies to understand how visitors use Blockwise and to improve our ads.
        </span>{" "}
        <Link href="/privacy" className="consent-banner__link">
          Privacy policy
        </Link>
      </p>
      <div className="consent-banner__actions">
        <button ref={acceptRef} type="button" className="consent-banner__btn consent-banner__btn--primary" onClick={handleAccept}>
          Accept all
        </button>
        <button type="button" className="consent-banner__btn consent-banner__btn--secondary" onClick={handleEssential}>
          Essential only
        </button>
      </div>
    </div>
  );
}

/** Reopens the existing banner; no parallel consent state or tracking code. */
export function CookiePreferencesButton() {
  return (
    <button type="button" className="consent-banner__btn consent-banner__btn--secondary"
      onClick={() => window.dispatchEvent(new CustomEvent("blockwise:consent-open"))}>
      Change cookie preferences
    </button>
  );
}
