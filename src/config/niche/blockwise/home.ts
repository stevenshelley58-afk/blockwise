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
    weeklyTitle: "Last 7 days",
    weeklySpend: "Spend",
    weeklyClicks: "Link clicks",
    weeklyCpc: "Cost per link click",
    weeklyLeads: "Leads",
    syncedAt: (when) => `Synced ${when}`,
    viewPerformance: "View performance",
    vsPriorWeek: {
      higher: (percent) => `${percent}% higher than the prior week`,
      lower: (percent) => `${percent}% lower than the prior week`,
      level: "Level with the prior week",
    },
    demoNote: "Demo numbers for an example account, not yours.",
    demoAction: "Connect Meta",
    unavailableValue: "—",
    unavailableValueSpoken: "Not reported",
    unavailableNote: "No reporting for this workspace yet.",
    unavailableAction: "Connect Meta",
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
      "Your brand pack is ready and Meta is connected. Pick a sample, add your listing photos, and Blockwise generates on-brand Feed and Story creatives.",
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
      href: "/ad-studio/library",
      title: "Ad Library",
      subtitle: "Browse your generated Feed and Story creatives.",
    },
  ],
  leads: {
    title: "Leads",
    followUp: (count) =>
      count === 1 ? "1 not yet followed up" : `${count} not yet followed up`,
    viewAll: "View all",
    emptyTitle: "No leads yet",
    emptyBody: "Leads land here as soon as your first ad is live.",
    ctaLabel: "Create an ad",
    exampleNote: "Example leads",
  },
  localAds: {
    title: "Ads near you",
    viewAll: "View all",
    // The Perth default stands until a brand address gives us a postcode.
    fallbackArea: { searchTerm: "Perth, WA", place: "Perth" },
  },
};
