"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getConsentStatus } from "@/components/consent-banner";
import { isMarketingPath, trackMarketingPageView } from "@/lib/analytics/marketing";

function validGoogleTagId(value: string | undefined): value is string {
  return Boolean(value && value.length >= 8 && value.charCodeAt(1) === 45);
}

export function MarketingAnalytics({
  metaPixelId,
  googleAdsId,
  ga4MeasurementId,
}: {
  metaPixelId: string;
  googleAdsId?: string;
  ga4MeasurementId?: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const pathname = usePathname();
  const googleTagId = validGoogleTagId(ga4MeasurementId) ? ga4MeasurementId : validGoogleTagId(googleAdsId) ? googleAdsId : undefined;

  useEffect(() => {
    const sync = () => setEnabled(getConsentStatus() === "granted");
    sync();
    window.addEventListener("blockwise:consent-changed", sync);
    return () => window.removeEventListener("blockwise:consent-changed", sync);
  }, []);

  useEffect(() => {
    if (enabled && googleReady && validGoogleTagId(ga4MeasurementId) && pathname) {
      trackMarketingPageView(pathname);
    }
  }, [enabled, ga4MeasurementId, googleReady, pathname]);

  if (!enabled) return null;
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('consent','grant');fbq('track','PageView');`}
      </Script>
      {googleTagId ? (
        <>
          <Script id="gtag-base" src={`https://www.googletagmanager.com/gtag/js?id=${googleTagId}`} strategy="afterInteractive" onLoad={() => setGoogleReady(true)} />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});gtag('set','send_page_view',false);gtag('config','${googleTagId}');`}
          </Script>
        </>
      ) : null}
    </>
  );
}
