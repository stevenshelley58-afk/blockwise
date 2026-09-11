/*
 * White-label niche layer. This directory is the ONLY place niche identity —
 * product nouns, industry copy, the vivid data hue, nav labels, and feature
 * flags — may live. Customer pages and components reference `niche.*` instead
 * of embedding product-specific copy. A new vertical means writing a sibling config folder and flipping the export in index.ts.
 * See docs/architecture/extension-guide.md for the extension path.
 */

export type NicheFeatures = {
  /** The competitor ad-library surface (Blockwise: Ad Radar). */
  adRadar: boolean;
  /** The address-report surface (Blockwise: Property Check). */
  propertyCheck: boolean;
  /** Public area/suburb report pages. */
  suburbPages: boolean;
  /** Internal hero design playground; never enable in a customer deployment. */
  heroLab: boolean;
  /** Marketing guides section. */
  guides: boolean;
};

export type NicheNavItem = {
  href: string;
  label: string;
  /** Structural icon name, rendered by the shared customer shell. */
  icon: "home" | "studio" | "performance" | "radar" | "property" | "leads" | "brand" | "settings" | "help";
  /** Include this destination in the mobile tab bar, using this shorter label. */
  mobileLabel?: string;
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
    rendersLeft: (remaining: number, included: number) => string;
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
    weeklyTitle: string;
    weeklySpend: string;
    weeklyClicks: string;
    weeklyCpc: string;
    weekScope: string;
    syncedAt: (when: string) => string;
    viewPerformance: string;
    /** Spoken descriptions of the week-on-week change; the band shows only the percentage. */
    vsPriorWeek: {
      higher: (percent: number) => string;
      lower: (percent: number) => string;
      level: string;
    };
    demoBadge: string;
    demoNote: string;
    demoAction: string;
    unavailableValue: string;
    unavailableValueSpoken: string;
    unavailableNote: string;
    unavailableAction: string;
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
  leads: {
    title: string;
    followUp: (count: number) => string;
    viewAll: string;
    emptyTitle: string;
    emptyBody: string;
    ctaLabel: string;
  };
  perthAds: {
    title: string;
    viewAll: string;
  };
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
  /**
   * Column labels. `lead`/`suburb`/`sourceAd`/`quality`/`delivery`/`status` head
   * the on-screen table; `name`/`email`/`phone`/`capturedAt` exist so the CSV
   * export header is config-driven too (no niche nouns in the component).
   */
  columns: {
    lead: string;
    name: string;
    email: string;
    phone: string;
    suburb: string;
    sourceAd: string;
    quality: string;
    delivery: string;
    status: string;
    capturedAt: string;
  };
  status: { newLead: string; possibleDuplicate: string };
  showing: (shown: number, total: number) => string;
  neverSynced: string;
  noMatches: string;
  empty: { title: string; body: string };
  disconnected: { title: string; body: string; connectCta: string };
};

export type PerformanceCopy = {
  title: string;
  subtitle: string;
  ranges: { d7: string; d30: string; d90: string };
  /** Compact labels for the mobile chip row, where the full words do not fit. */
  rangesShort: { d7: string; d30: string; d90: string };
  charts: { spend: string; leads: string; cpl: string };
  cplGapNote: string;
  leadResults: { title: string; subtitle: string };
  /** Per-area performance panel — "area" is `terms.area` for this niche. */
  areaBreakdown: { title: string; empty: string };
  budgetPacing: string;
  demoChip: string;
  viewExample: string;
  refresh: string;
  refreshing: string;
  customRange: string;
  states: {
    disconnectedTitle: string;
    disconnectedBody: string;
    connectCta: string;
    emptyTitle: string;
    emptyBody: string;
    staleNotice: (age: string) => string;
    notSynced: string;
  };
};

export type AdRadarCopy = {
  title: string;
  lead: string;
  searchPlaceholder: string;
  /** Assistive line under the search input naming what can be searched. */
  searchScope: string;
  filters: {
    agency: string;
    agent: string;
    allAgencies: string;
    allAgents: string;
  };
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

export type HelpCopy = {
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
    help: HelpCopy;
  };
};
