import type { Metadata } from "next";

import {
  ControlFold,
  FaqSection,
  FreeTrial,
  ManagedSetup,
  PropertyCheck,
  StartBand,
  Updates,
  WorkflowBand,
} from "@/components/home-landing/home-sections";
import { NightOpsHero } from "@/components/home-landing/night-ops-hero";
import { SiteFooter, SiteHeader } from "@/components/home-landing/site-chrome";

import "./homepage.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <div className="hw-page">
      <SiteHeader />
      <main>
        <section id="top"><NightOpsHero /></section>
        <section id="start"><StartBand /></section>
        <section id="workflow"><WorkflowBand /></section>
        <section id="control"><ControlFold /></section>
        <section id="updates"><Updates /></section>
        <section id="property-check"><PropertyCheck /></section>
        <section id="free-trial"><FreeTrial /></section>
        <section id="managed-setup"><ManagedSetup /></section>
        <section id="faq"><FaqSection /></section>
      </main>
      <SiteFooter />
    </div>
  );
}
