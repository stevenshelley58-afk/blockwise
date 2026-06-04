import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import Script from "next/script";

import "./globals.css";
import "./meta-monitor.css";
import "./landing.css";

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

const META_PIXEL_ID = "1699948581050851";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://blockwise.sale";
const SITE_TITLE = "Blockwise — Create and launch real estate ads from one platform";
const SITE_DESCRIPTION =
  "Build Facebook and Instagram campaigns from a simple brief. Connect your ad account, approve every ad, set the budget and track results inside Blockwise. Free 7-day trial, no card required.";

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
  alternates: { canonical: "/" },
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
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en-AU"
      className={`${inter.variable} ${manrope.variable}`}
      data-sidebar-theme="dark"
      suppressHydrationWarning
    >
      <head>
        {/* Set sidebar theme before paint to avoid a flash */}
        <Script id="sidebar-theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('bw-sidebar')||'dark';document.documentElement.setAttribute('data-sidebar-theme',t);}catch(e){}`}
        </Script>
      </head>
      <body>
        {/* Meta Pixel Code */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window,document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '${META_PIXEL_ID}');
          fbq('track', 'PageView');`}
        </Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
        {/* End Meta Pixel Code */}
        {children}
      </body>
    </html>
  );
}
