import type { HomeCopy } from "../niche";

export const home: HomeCopy = {
  states: {
    needsBrand: {
      heading: "Set up your brand.",
      subtitle:
        "Add your logo and colours once — Blockwise turns them into ad-ready creatives.",
      ctaLabel: "Set up brand",
    },
    needsProvider: {
      heading: "Connect Meta.",
      subtitle:
        "Link your ad account so finished ads publish straight to your own campaigns.",
      ctaLabel: "Connect Meta",
    },
    needsFirstAd: {
      heading: "Create your first ad.",
      subtitle:
        "Your brand is ready. Turn a listing into Feed and Story creatives in minutes.",
      ctaLabel: "Create ad",
    },
    ready: {
      heading: "Welcome back.",
      subtitle: (workspaceName) => `Here's where ${workspaceName} stands today.`,
      ctaLabel: "Create ad",
    },
  },
  kpis: {
    leads: "Leads · 30 days",
    vsPrior: "vs prior 30 days",
    costPerLead: "Cost per lead",
    adsLive: "Ads live",
    adsLiveUnit: (created) => `of ${created} created`,
    publishedThisWeek: (count) =>
      count === 1 ? "1 published this week" : `${count} published this week`,
    adPacksLeft: "Ad packs left",
    adsCreated: "Ads created",
    noAdsYet: "No ads yet",
    adsPublished: (count) =>
      count === 1 ? "1 ad published" : `${count} ads published`,
  },
  chart: {
    title: "Leads captured",
    subtitle: "Last 30 days",
    viewPerformance: "View performance",
    viewAsTable: "View as table",
    emptyTitle: "No leads yet",
    emptyBody: "Leads land here as soon as your first ad is live.",
  },
  setup: {
    title: "Setup",
    subtitle: "Finish setup to go live.",
    progressLabel: (done, total) => `${done} of ${total} complete`,
    readyTitle: "Ready to publish",
    readySubtitle: "Everything is connected. Turn your next listing into a live ad.",
    readyBody:
      "Your brand pack is ready and Meta is connected. Pick a proven sample, add your listing photos, and Blockwise generates on-brand Feed and Story creatives.",
    adLibrary: "Ad library",
    viewPerformance: "View ad performance",
    steps: {
      brand: {
        title: "Brand pack",
        description: "Logo, colours and key details",
        doneLabel: "Complete",
      },
      connect: {
        title: "Connect Meta",
        description: "Link your ad account",
        doneLabel: "Connected",
      },
      publish: {
        title: "First ad",
        description: "Publish to Feed and Story",
        doneLabel: "Published",
      },
    },
    badges: { upNext: "Up next", waiting: "Waiting" },
  },
  quickActions: [
    {
      href: "/ad-radar",
      title: "Ad Radar",
      subtitle: "See top-performing ads from agents near you.",
      feature: "adRadar",
    },
    {
      href: "/property-check",
      title: "Property Check",
      subtitle: "Instant insights and ad ideas for any listing.",
      feature: "propertyCheck",
    },
    {
      href: "/ad-studio/library",
      title: "Ad library",
      subtitle: "Browse your generated Feed and Story creatives.",
    },
  ],
};
