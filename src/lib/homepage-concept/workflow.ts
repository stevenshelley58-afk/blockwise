/** Local fixtures for a labelled homepage example. Nothing is published or saved. */
export const WORKFLOW_STEPS = [
  { id: "choose", label: "Choose" },
  { id: "customise", label: "Customise" },
  { id: "review", label: "Budget & review" },
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];

/** One illustrative appraisal campaign runs through the whole homepage. */
export const WORKFLOW_AD = {
  campaign: "Free property appraisal",
  agency: "West Coast Home Co",
  initials: "WCH",
  suburb: "Mt Lawley, WA",
  domain: "EXAMPLE.COM",
  defaultCopy: "Thinking of selling in Mt Lawley? Find out what your home could be worth.",
  defaultTitle: "Free property appraisal",
  linkTitle: "Request an appraisal",
} as const;

/** Three visual treatments for the same appraisal campaign. */
export const WORKFLOW_TEMPLATES = [
  {
    id: "classic",
    label: "Classic",
    image: "/home/mt-lawley-federation.webp",
    detail: "Property appraisal",
  },
  {
    id: "editorial",
    label: "Editorial",
    image: "/home/home-dusk.webp",
    detail: "Property appraisal",
  },
  {
    id: "minimal",
    label: "Minimal",
    image: "/home/home-pool.webp",
    detail: "Property appraisal",
  },
] as const;

export const WORKFLOW_REVIEW = {
  audience: "Mt Lawley +10 km",
  durations: [7, 14, 30] as const,
  defaultDuration: 14,
  defaultDailyBudget: 20,
  minDailyBudget: 10,
  maxDailyBudget: 100,
} as const;
