/*
 * White-label niche layer. This directory is the ONLY place niche identity —
 * product nouns, industry copy, the vivid data hue, nav labels, and feature
 * flags — may live. Customer pages and components reference `niche.*` instead
 * of writing niche nouns inline, so cloning the product for a new vertical
 * means writing a sibling config folder and flipping the export in
 * `index.ts`. See docs/REBUILD-PLAN.md §5.
 *
 * Keep values plain data where possible; the few functions exist only for
 * pluralisation/interpolation and are safe because both server and client
 * code import this module directly (config is never serialised as props).
 */

export type NicheFeatures = {
  /** The address-report surface (Blockwise: Property Check). */
  propertyCheck: boolean;
  /** Public area/suburb report pages. */
  suburbPages: boolean;
  /** Marketing guides section. */
  guides: boolean;
};

export type NicheNavItem = {
  href: string;
  label: string;
  /** Grouping label rendered above the item (starts a new section). */
  section?: string;
  /** Feature flag that must be on for the item to render. */
  feature?: keyof NicheFeatures;
};

/** Shell chrome: command menu, topbar search, trial pill, mobile nav. */
export type ShellCopy = {
  commandMenu: {
    placeholder: string;
    navigateGroup: string;
    actionsGroup: string;
    createAd: string;
    empty: string;
  };
  searchButton: string;
  trial: {
    ended: string;
    active: string;
    daysLeft: (days: number) => string;
    packsLeft: (remaining: number, included: number) => string;
    used: (used: number) => string;
    upgrade: string;
  };
  installApp: string;
  signOut: string;
  more: string;
};

export type HomeSetupState = {
  heading: string;
  subtitle: string;
  ctaLabel: string;
};

export type HomeCopy = {
  states: {
    needsBrand: HomeSetupState;
    needsProvider: HomeSetupState;
    needsFirstAd: HomeSetupState;
    ready: {
      heading: string;
      subtitle: (workspaceName: string) => string;
      ctaLabel: string;
    };
  };
  kpis: {
    leads: string;
    vsPrior: string;
    costPerLead: string;
    adsLive: string;
    adsLiveUnit: (created: number) => string;
    publishedThisWeek: (count: number) => string;
    adPacksLeft: string;
    adsCreated: string;
    noAdsYet: string;
    adsPublished: (count: number) => string;
  };
  chart: {
    title: string;
    subtitle: string;
    viewPerformance: string;
    viewAsTable: string;
    emptyTitle: string;
    emptyBody: string;
  };
  setup: {
    title: string;
    subtitle: string;
    progressLabel: (done: number, total: number) => string;
    readyTitle: string;
    readySubtitle: string;
    readyBody: string;
    adLibrary: string;
    viewPerformance: string;
    steps: {
      brand: { title: string; description: string; doneLabel: string };
      connect: { title: string; description: string; doneLabel: string };
      publish: { title: string; description: string; doneLabel: string };
    };
    badges: { upNext: string; waiting: string };
  };
  quickActions: {
    href: string;
    title: string;
    subtitle: string;
    feature?: keyof NicheFeatures;
  }[];
};

export type LeadsCopy = {
  title: string;
  captured: (count: number) => string;
  syncedAt: (time: string) => string;
  syncCta: string;
  stats: {
    leads: string;
    highIntent: string;
    duplicates: string;
    duplicatesNote: string;
  };
  searchPlaceholder: string;
  filters: { all: string; highIntent: string; duplicates: string };
  exportCsv: string;
  columns: { lead: string; sourceAd: string; quality: string; status: string };
  showing: (shown: number, total: number) => string;
  empty: { title: string; body: string };
};

export type PerformanceCopy = {
  title: string;
  subtitle: string;
  ranges: { d7: string; d30: string; d90: string };
  charts: { spend: string; leads: string; cpl: string };
  states: {
    disconnectedTitle: string;
    disconnectedBody: string;
    connectCta: string;
    emptyTitle: string;
    emptyBody: string;
    staleNotice: (age: string) => string;
  };
};

export type AdRadarCopy = {
  title: string;
  lead: string;
  searchPlaceholder: string;
  includeSurrounding: string;
};

export type PropertyCheckCopy = {
  navLabel: string;
  heroTitle: string;
  heroLead: string;
  searchPlaceholder: string;
};

export type SettingsCopy = {
  title: string;
  sections: {
    account: string;
    connections: string;
    password: string;
    billing: string;
    workspace: string;
    team: string;
    notifications: string;
    danger: string;
  };
};

export type OnboardingCopy = {
  title: string;
  lead: string;
};

export type NicheConfig = {
  key: string;
  product: {
    name: string;
  };
  industry: {
    /** e.g. "Real estate" — workspace chip, brand metadata. */
    label: string;
    /** The customer's peers in copy, e.g. "agent"/"agents". */
    audienceNoun: string;
    audienceNounPlural: string;
    regionDefault: string;
  };
  /** Swappable nouns for shared surfaces. */
  terms: {
    /** The thing an ad promotes: "listing" (Blockwise) / "offer". */
    offer: string;
    offers: string;
    /** Geographic unit: "suburb" (Blockwise) / "area". */
    area: string;
    areas: string;
  };
  theme: {
    /** The one vivid data hue — charts, meters, sparklines only. */
    data: string;
    dataSoft: string;
    dataTrack: string;
  };
  nav: {
    items: NicheNavItem[];
    /** The four primary mobile tabs (bottom tab bar). */
    mobileTabs: { href: string; label: string }[];
  };
  features: NicheFeatures;
  copy: {
    shell: ShellCopy;
    home: HomeCopy;
    leads: LeadsCopy;
    performance: PerformanceCopy;
    adRadar: AdRadarCopy;
    propertyCheck: PropertyCheckCopy;
    settings: SettingsCopy;
    onboarding: OnboardingCopy;
  };
};
