import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";

import {
  ControlFold,
  DoneForYou,
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

const manrope = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-manrope" });
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <div className={`hw-page ${manrope.variable} ${inter.variable}`}>
      <SiteHeader />
      <main>
        <section id="top"><NightOpsHero /></section>
        <section id="start"><StartBand /></section>
        <section id="workflow"><WorkflowBand /></section>
        <section id="done-for-you"><DoneForYou /></section>
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
