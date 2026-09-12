"use client";

import { Check, ChevronDown, Mail, Menu, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";

import { HeroAdShowcase } from "@/components/homepage-concept/hero-ad-showcase";
import { HomepageBooking } from "@/components/homepage-concept/homepage-booking";
import { HomepagePricing } from "@/components/homepage-concept/homepage-pricing";
import { ResultsReporting } from "@/components/homepage-concept/results-reporting";
import { WorkflowShowcase } from "@/components/homepage-concept/workflow-showcase";
import { Button } from "@/components/ui/button";
import {
  BUSINESS_IDENTITY,
  CONTACT_HREF,
  FAQ_GROUPS,
  LOGIN_HREF,
  PRICING_HREF,
  PRIVACY_HREF,
  TERMS_HREF,
  withBasePath,
} from "@/lib/homepage-concept/content";
import { TRIAL_CTA_LABEL, TRIAL_SIGNUP_URL } from "@/lib/homepage-concept/pricing";

function TrialLink({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Button asChild size="lg" variant="outline" className={className}><a href={TRIAL_SIGNUP_URL}>{children}</a></Button>;
}

function MobileMenu() {
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  return <details className="hc-mobile-menu" ref={menuRef}><summary aria-label="Open navigation"><Menu aria-hidden="true" size={20} /></summary><nav aria-label="Mobile navigation" onClick={() => menuRef.current?.removeAttribute("open")}><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><a href={LOGIN_HREF}>Log in</a></nav></details>;
}

export function HomepageConcept() {
  return (
    <div className="hc-root">
      <header className="hc-header">
        <a className="hc-logo" href="#top" aria-label="Blockwise home"><img src={withBasePath("/brand/blockwise-logo-white.svg")} alt="Blockwise" width="142" height="32" /></a>
        <nav className="hc-desktop-nav" aria-label="Primary navigation"><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav>
        <a className="hc-login" href={LOGIN_HREF}>Log in</a>
        <a className="hc-header-cta" href={TRIAL_SIGNUP_URL}>{TRIAL_CTA_LABEL}</a>
        <MobileMenu />
      </header>
      <main>
        <section className="hc-hero" id="top"><div className="hc-shell hc-hero-grid"><div className="hc-hero-copy"><h1><span>More leads.</span><span className="hc-hero-prompt">Less ad management.</span></h1><p>Blockwise helps real estate agents create, review and run Facebook and Instagram ads in one place.</p><div className="hc-hero-actions"><TrialLink className="max-[600px]:w-full">{TRIAL_CTA_LABEL}</TrialLink><span><Check aria-hidden="true" size={16} /> No card required.</span></div></div><div className="hc-hero-visual"><HeroAdShowcase /></div></div></section>
        <section className="hc-process" id="how-it-works"><div className="hc-shell"><WorkflowShowcase /></div></section>
        <ResultsReporting />
        <HomepagePricing />
        <section className="hc-faq" id="faq"><div className="hc-shell hc-faq-grid"><div className="hc-section-copy"><h2>FAQ</h2><p>Useful details before you start.</p></div><div className="hc-faq-groups">{FAQ_GROUPS.map((group, groupIndex) => <details className="hc-faq-group" key={group.heading} open={groupIndex === 0}><summary><h3 id={`hc-faq-group-${groupIndex}`}>{group.heading}</h3><ChevronDown aria-hidden="true" size={20} /></summary><div className="hc-faq-list">{group.faqs.map((faq) => <details key={faq.question}><summary><span>{faq.question}</span><ChevronDown aria-hidden="true" size={18} /></summary><div className="hc-faq-answer"><p>{faq.answer}</p>{"links" in faq && faq.links?.length ? <p className="hc-faq-links">{faq.links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</p> : null}</div></details>)}</div></details>)}</div></div></section>
        <section className="hc-trial" id="trial"><div className="hc-shell hc-trial-grid"><div><h2>Ready to make your next ad?</h2><p>Start with three Feed and Story packs. No card is required, and you only pay if you choose a paid plan.</p></div><div className="hc-trial-action"><TrialLink>{TRIAL_CTA_LABEL}</TrialLink><p><ShieldCheck aria-hidden="true" size={17} /> Meta ad spend is paid separately.</p></div></div></section>
        <HomepageBooking />
      </main>
      <footer className="hc-footer"><div className="hc-shell"><div><img src={withBasePath("/brand/blockwise-logo.svg")} alt="Blockwise" width="134" height="30" /><p>Real estate ads, made manageable.</p></div><nav aria-label="Footer navigation"><a href={PRICING_HREF}>Pricing</a><a href={CONTACT_HREF}><Mail aria-hidden="true" size={15} /> Contact</a><a href={PRIVACY_HREF}>Privacy</a><a href={TERMS_HREF}>Terms</a><a href="https://blockwise.sale/data-deletion">Data deletion</a></nav><small>{BUSINESS_IDENTITY}</small></div></footer>
    </div>
  );
}
