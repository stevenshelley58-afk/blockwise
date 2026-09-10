"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";

import { getConsentStatus } from "@/components/consent-banner";
import { isAnalyticsExcludedPath } from "@/lib/analytics/events";
import { validClarityId } from "@/lib/analytics/marketing";

export function ClarityAnalytics({ projectId }: { projectId?: string }) {
  const [enabled, setEnabled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const sync = () => setEnabled(getConsentStatus() === "granted");
    sync();
    window.addEventListener("blockwise:consent-changed", sync);
    return () => window.removeEventListener("blockwise:consent-changed", sync);
  }, []);

  useLayoutEffect(() => () => { window.clarity?.("stop"); }, [enabled, pathname]);

  if (!enabled || !pathname || isAnalyticsExcludedPath(pathname) || !(pathname === "/" || pathname === "/pricing" || pathname === "/guides" || pathname.startsWith("/guides/")) || !validClarityId(projectId) || (typeof window !== "undefined" && (window.location.search || window.location.hash))) return null;

  return (
    <>
      <Script id="microsoft-clarity-init" strategy="afterInteractive">
        {"window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};window.clarity('consentv2',{ad_Storage:'granted',analytics_Storage:'granted'});"}
      </Script>
      <Script id="microsoft-clarity" src={"https://www.clarity.ms/tag/" + projectId} strategy="afterInteractive" />
    </>
  );
}
