import type { NicheConfig } from "./niche";
import { adRadar } from "./blockwise/ad-radar";
import { home } from "./blockwise/home";
import { leads } from "./blockwise/leads";
import { onboarding } from "./blockwise/onboarding";
import { performance } from "./blockwise/performance";
import { propertyCheck } from "./blockwise/property-check";
import { settings } from "./blockwise/settings";
import { shell } from "./blockwise/shell";

export const blockwise: NicheConfig = {
  key: "blockwise",
  product: {
    name: "Blockwise",
  },
  industry: {
    label: "Real estate",
    audienceNoun: "agent",
    audienceNounPlural: "agents",
    regionDefault: "AU",
  },
  terms: {
    offer: "listing",
    offers: "listings",
    area: "suburb",
    areas: "suburbs",
  },
  theme: {
    data: "#2a78d6",
    dataSoft: "rgba(42, 120, 214, 0.10)",
    dataTrack: "rgba(42, 120, 214, 0.16)",
  },
  nav: {
    items: [
      { href: "/self-serve", label: "Home" },
      { href: "/ad-studio", label: "Ad Studio" },
      { href: "/results", label: "Performance" },
      { href: "/ad-radar", label: "Ad Radar", feature: "adRadar" },
      { href: "/property-check", label: "Property Check", feature: "propertyCheck" },
      { href: "/leads", label: "Leads" },
      { href: "/ad-studio/brand", label: "Brand Pack", section: "Set up" },
      { href: "/settings", label: "Settings", section: "Set up" },
    ],
    mobileTabs: [
      { href: "/self-serve", label: "Home" },
      { href: "/ad-studio", label: "Studio" },
      { href: "/results", label: "Results" },
      { href: "/leads", label: "Leads" },
    ],
  },
  features: {
    adRadar: false,
    propertyCheck: false,
    suburbPages: false,
    guides: true,
  },
  copy: {
    shell,
    home,
    leads,
    performance,
    adRadar,
    propertyCheck,
    settings,
    onboarding,
  },
};
