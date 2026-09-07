"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getConsentStatus } from "@/components/consent-banner";
import { isMarketingPath } from "@/lib/analytics/marketing";

function validProjectId(value: string | undefined): value is string {
  return Boolean(value && value.length >= 8 && value.length <= 64);
}

export function ClarityAnalytics({ projectId }: { projectId?: string }) {
  const [enabled, setEnabled] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const sync = () => setEnabled(getConsentStatus() === "granted");
    sync();
    window.addEventListener("blockwise:consent-changed", sync);
    return () => window.removeEventListener("blockwise:consent-changed", sync);
  }, []);

  if (!enabled || !pathname || !isMarketingPath(pathname) || !validProjectId(projectId)) return null;

  return (
    <>
      <Script id="microsoft-clarity-init" strategy="afterInteractive">
        {"window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};window.clarity('consent');"}
      </Script>
      <Script id="microsoft-clarity" src={"https://www.clarity.ms/tag/" + projectId} strategy="afterInteractive" />
    </>
  );
}
