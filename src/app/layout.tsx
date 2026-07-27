import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";

import { PageViewTracker } from "@/components/page-view-tracker";
import { ConsentBanner } from "@/components/consent-banner";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";

// globals.css and landing.css are imported by tailwind.css into the `legacy`
// cascade layer so Tailwind utilities win on the rebuilt customer surface.
// theme-monochrome.css stays last and unlayered — it is the token override.
import "./tailwind.css";
import "./theme-monochrome.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const META_PIXEL_ID = "1699948581050851";
const META_APP_ID = process.env.META_APP_ID;
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://blockwise.sale";
const SITE_TITLE = "Blockwise | Real Estate Meta Ads Workflow";
const SITE_DESCRIPTION =
  "Help real estate teams create, approve, export, and track Meta ad campaigns through their own ad account. Free 7-day trial, no card required.";

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
      className={`${inter.variable} ${manrope.variable} ${jetbrainsMono.variable}`}
      data-sidebar-theme="light"
      suppressHydrationWarning
    >
      <head>
        {/* Set sidebar theme before paint to avoid a flash */}
        <Script id="sidebar-theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('bw-sidebar')||'light';document.documentElement.setAttribute('data-sidebar-theme',t);}catch(e){}`}
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
      </body>
    </html>
  );
}
