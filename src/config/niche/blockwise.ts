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
      { href: "/self-serve", label: "Home", icon: "home", mobileLabel: "Home" },
      { href: "/ad-studio", label: "Ad Studio", icon: "studio", mobileLabel: "Studio" },
      { href: "/results", label: "Performance", icon: "performance", mobileLabel: "Results" },
      { href: "/ad-radar", label: "Ad Radar", icon: "radar", feature: "adRadar" },
      { href: "/property-check", label: "Property Check", icon: "property", feature: "propertyCheck" },
      { href: "/leads", label: "Leads", icon: "leads", mobileLabel: "Leads" },
      { href: "/ad-studio/brand", label: "Brand Pack", icon: "brand", section: "Set up" },
      { href: "/settings", label: "Settings", icon: "settings", section: "Set up" },
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
