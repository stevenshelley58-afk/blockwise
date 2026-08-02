import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { PageViewTracker } from "@/components/page-view-tracker";
import { ConsentBanner } from "@/components/consent-banner";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

// Structural legacy selectors stay in a low cascade layer; Atlantic is the
// single unlayered visual authority shared by every surface.
import "./tailwind.css";
import "@/design-system/atlantic.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const META_PIXEL_ID = "1699948581050851";
const META_APP_ID = process.env.META_APP_ID;
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://blockwise.sale";
const SITE_TITLE = "Blockwise | Real Estate Meta Ads Workflow";
const SITE_DESCRIPTION =
  "Create, approve, publish, and track Meta ad campaigns through your own ad account. Start with email and create three complete ads before adding a card.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s · Blockwise",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Blockwise",
  keywords: [
    "real estate ads",
    "real estate lead generation",
    "Meta ads for agents",
    "listing leads",
    "real estate marketing",
    "Perth real estate",
  ],
  authors: [{ name: "Blockwise" }],
  openGraph: {
    type: "website",
    siteName: "Blockwise",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_AU",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  facebook: META_APP_ID ? { appId: META_APP_ID } : undefined,
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-AU"
      className={`${inter.variable} ${ibmPlexMono.variable}`}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        {/* Set the Atlantic light condition before paint to avoid a flash. */}
        <Script id="atlantic-theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('bw-theme')||'light';document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){}`}
        </Script>
      </head>
      <body>
        {/* Meta Pixel Code — consent default deny (GDPR/PECR) */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window,document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('consent', 'default', {ad_storage: 'denied', analytics_storage: 'denied'});
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');`}
        </Script>
        {/* End Meta Pixel Code */}
        {GOOGLE_ADS_ID ? (
          <>
            <Script
              id="gtag-base"
              src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`}
              strategy="afterInteractive"
            />
            <Script id="gtag-init" strategy="afterInteractive">
              {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${GOOGLE_ADS_ID}',{ad_storage:'denied',analytics_storage:'denied'});`}
            </Script>
          </>
        ) : null}
        {children}
        <ServiceWorkerRegistrar />
        <PageViewTracker />
        <ConsentBanner />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
