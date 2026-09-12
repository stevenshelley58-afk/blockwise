"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useState } from "react";

import { getConsentStatus } from "@/components/consent-banner";
import { isMarketingPath, marketingPageLocation, setGa4Collection, trackMarketingPageView, validGa4Id } from "@/lib/analytics/marketing";

export function MarketingAnalytics({
  metaPixelId,
  ga4MeasurementId,
}: {
  metaPixelId: string;
  ga4MeasurementId?: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const sync = () => setEnabled(getConsentStatus() === "granted");
    sync();
    window.addEventListener("blockwise:consent-changed", sync);
    return () => window.removeEventListener("blockwise:consent-changed", sync);
  }, []);

  useLayoutEffect(() => {
    setGa4Collection(ga4MeasurementId, enabled && !!pathname && isMarketingPath(pathname));
    return () => setGa4Collection(ga4MeasurementId, false);
  }, [enabled, ga4MeasurementId, pathname]);

  useEffect(() => {
    if (enabled && googleReady && validGa4Id(ga4MeasurementId) && pathname) {
      trackMarketingPageView(pathname);
    }
  }, [enabled, ga4MeasurementId, googleReady, pathname]);

  if (!enabled || !pathname || !isMarketingPath(pathname)) return null;
  const googleTagId = validGa4Id(ga4MeasurementId) ? ga4MeasurementId : undefined;
  const googleConfig = { send_page_view: false, page_location: marketingPageLocation(window.location.origin, pathname), page_referrer: "", page_title: "Blockwise", allow_google_signals: false, allow_ad_personalization_signals: false };

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaPixelId}');fbq('consent','grant');fbq('track','PageView');`}
      </Script>
      {googleTagId ? (
        <>
          <Script id="gtag-base" src={`https://www.googletagmanager.com/gtag/js?id=${googleTagId}`} strategy="afterInteractive" onReady={() => setGoogleReady(true)} />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());gtag('consent','default',{ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',analytics_storage:'granted'});${`gtag('config',${JSON.stringify(googleTagId)},${JSON.stringify(googleConfig)});`}`}
          </Script>
        </>
      ) : null}
    </>
  );
}
