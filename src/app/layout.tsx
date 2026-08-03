import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { PageViewTracker } from "@/components/page-view-tracker";
import { ConsentBanner } from "@/components/consent-banner";
import { MarketingAnalytics } from "@/components/marketing-analytics";
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
        <MarketingAnalytics metaPixelId={META_PIXEL_ID} googleAdsId={GOOGLE_ADS_ID} />
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
