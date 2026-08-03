"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

import { getConsentStatus } from "@/components/consent-banner";

export function MarketingAnalytics({
  metaPixelId,
  googleAdsId,
}: {
  metaPixelId: string;
  googleAdsId?: string;
}) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(getConsentStatus() === "granted");
    sync();
    window.addEventListener("blockwise:consent-changed", sync);
    return () => window.removeEventListener("blockwise:consent-changed", sync);
  }, []);

  if (!enabled) return null;
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('consent','grant');fbq('track','PageView');`}
      </Script>
      {googleAdsId ? (
        <>
          <Script id="gtag-base" src={`https://www.googletagmanager.com/gtag/js?id=${googleAdsId}`} strategy="afterInteractive" />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('consent','default',{ad_storage:'granted',analytics_storage:'granted'});gtag('config','${googleAdsId}');`}
          </Script>
        </>
      ) : null}
    </>
  );
}
