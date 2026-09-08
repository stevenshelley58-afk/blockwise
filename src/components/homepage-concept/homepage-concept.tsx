"use client";

import { ArrowRight, Check, ChevronDown, Mail, Menu, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";

import { HomepagePricing } from "@/components/homepage-concept/homepage-pricing";
import { ResultsReporting } from "@/components/homepage-concept/results-reporting";
import { WorkflowShowcase } from "@/components/homepage-concept/workflow-showcase";
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
  return <a className={`hc-button hc-button--primary ${className}`} href={TRIAL_SIGNUP_URL}>{children}</a>;
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

function HeroPreview() {
  return (
    <figure className="hc-hero-preview" aria-label="Example appraisal ad leading to an enquiry">
      <div className="hc-example-label">Example ad</div>
      <article className="hc-hero-ad">
        <header><span className="hc-hero-avatar">WCH</span><span><strong>West Coast Home Co</strong><small>Sponsored</small></span></header>
        <p>Thinking of selling? Get a free property appraisal.</p>
        <img src={withBasePath("/home/mt-lawley-federation.webp")} alt="" width="1080" height="1350" />
        <div className="hc-hero-ad-link"><span><strong>Request an appraisal</strong></span><b>Learn more</b></div>
      </article>
      <div className="hc-enquiry-cue"><ArrowRight aria-hidden="true" size={17} /><span><strong>Example enquiry</strong><small>New appraisal request</small></span><Check aria-hidden="true" size={16} /></div>
    </figure>
  );
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
        <section className="hc-hero" id="top"><div className="hc-shell hc-hero-grid"><div className="hc-hero-copy"><h1>More leads. Less ad management.</h1><p>Blockwise helps real estate agents create, review and run Facebook and Instagram ads in one place.</p><div className="hc-hero-actions"><TrialLink>{TRIAL_CTA_LABEL} <ArrowRight aria-hidden="true" size={17} /></TrialLink><span><Check aria-hidden="true" size={16} /> No card required. Meta ad spend is separate.</span></div></div><div className="hc-hero-visual"><HeroPreview /></div></div></section>
        <section className="hc-process" id="how-it-works"><div className="hc-shell"><WorkflowShowcase /></div></section>
        <ResultsReporting />
        <HomepagePricing />
        <section className="hc-faq" id="faq"><div className="hc-shell hc-faq-grid"><div className="hc-section-copy"><h2>FAQ</h2><p>Useful details before you start.</p></div><div className="hc-faq-groups">{FAQ_GROUPS.map((group, groupIndex) => <details className="hc-faq-group" key={group.heading}><summary><h3 id={`hc-faq-group-${groupIndex}`}>{group.heading}</h3><ChevronDown aria-hidden="true" size={20} /></summary><div className="hc-faq-list">{group.faqs.map((faq) => <details key={faq.question}><summary><span>{faq.question}</span><ChevronDown aria-hidden="true" size={18} /></summary><div className="hc-faq-answer"><p>{faq.answer}</p>{"links" in faq && faq.links?.length ? <p className="hc-faq-links">{faq.links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}</p> : null}</div></details>)}</div></details>)}</div></div></section>
        <section className="hc-trial" id="trial"><div className="hc-shell hc-trial-grid"><div><h2>Ready to make your next ad?</h2><p>Start with three Feed and Story packs. No card is required, and you only pay if you choose a paid plan.</p></div><div className="hc-trial-action"><TrialLink>{TRIAL_CTA_LABEL} <ArrowRight aria-hidden="true" size={17} /></TrialLink><p><ShieldCheck aria-hidden="true" size={17} /> Meta ad spend is paid separately.</p></div></div></section>
      </main>
      <footer className="hc-footer"><div className="hc-shell"><div><img src={withBasePath("/brand/blockwise-logo.svg")} alt="Blockwise" width="134" height="30" /><p>Real estate ads, made manageable.</p></div><nav aria-label="Footer navigation"><a href={PRICING_HREF}>Pricing</a><a href={CONTACT_HREF}><Mail aria-hidden="true" size={15} /> Contact</a><a href={PRIVACY_HREF}>Privacy</a><a href={TERMS_HREF}>Terms</a><a href="https://blockwise.sale/data-deletion">Data deletion</a></nav><small>{BUSINESS_IDENTITY}</small></div></footer>
    </div>
  );
}
