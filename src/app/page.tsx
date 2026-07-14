import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";

import {
  DesktopControl,
  DesktopDoneForYou,
  DesktopFaq,
  DesktopFooter,
  DesktopFreeTrial,
  DesktopHeader,
  DesktopHero,
  DesktopManagedSetup,
  DesktopPropertyCheck,
  DesktopSignal,
  DesktopUpdates,
} from "@/components/home-landing/home-desktop";
import {
  MobileControl,
  MobileDoneForYou,
  MobileFaq,
  MobileFooter,
  MobileFreeTrial,
  MobileHeader,
  MobileHero,
  MobileManagedSetup,
  MobilePropertyCheck,
  MobileSignal,
  MobileUpdates,
  MobileWorkflow,
} from "@/components/home-landing/home-mobile";
import { RevealObserver } from "@/components/home-landing/reveal-observer";

import "./homepage.css";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  fallback: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
});

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Marketing homepage — "Local ad intelligence" redesign implemented from
 * `Blockwise homepage redesign/design_handoff_blockwise_homepage`.
 *
 * The handoff ships two separately designed layouts (desktop + mobile), with
 * different section order and content per breakpoint. Each anchor section
 * renders once and contains both breakpoint variants (CSS-toggled at 768px);
 * the mobile section order is applied with flex `order` so ids stay unique
 * and every anchor works at both sizes.
 */
export default function HomePage() {
  return (
    <div className={`hw-page ${hanken.className}`}>
      <noscript>
        {/* Without JS the reveal observer never runs — show everything. */}
        <style>{`[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <DesktopHeader />
      <MobileHeader />

      <main className="hw-main">
        <section id="top">
          <DesktopHero />
          <MobileHero />
        </section>
        <section id="start">
          <DesktopSignal />
          <MobileSignal />
        </section>
        <section id="workflow">
          {/* Mobile-only section — the desktop layout replaces it with the
              connector-based "From signal to ad" flow above. */}
          <MobileWorkflow />
        </section>
        <section id="done-for-you">
          <DesktopDoneForYou />
          <MobileDoneForYou />
        </section>
        <section id="control">
          <DesktopControl />
          <MobileControl />
        </section>
        <section id="updates">
          <DesktopUpdates />
          <MobileUpdates />
        </section>
        <section id="property-check">
          <DesktopPropertyCheck />
          <MobilePropertyCheck />
        </section>
        <section id="free-trial">
          <DesktopFreeTrial />
          <MobileFreeTrial />
        </section>
        <section id="managed-setup">
          <DesktopManagedSetup />
          <MobileManagedSetup />
        </section>
        <section id="faq">
          <DesktopFaq />
          <MobileFaq />
        </section>
      </main>

      <DesktopFooter />
      <MobileFooter />

      <RevealObserver />
    </div>
  );
}
