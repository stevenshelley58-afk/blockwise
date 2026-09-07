export type WalkthroughStepId = "create" | "approve" | "enquiries";

export type WalkthroughStep = {
  id: WalkthroughStepId;
  label: string;
  title: string;
  body: string;
  benefit: string;
};

export const WALKTHROUGH_STEPS = [
  {
    id: "create",
    label: "Create your ad",
    title: "Turn your offer into an on-brand ad.",
    body: "Start with a ready-made real-estate template, then add your message and agency details in the same workspace.",
    benefit: "A polished creative is ready for review without briefing a designer or opening Ads Manager.",
  },
  {
    id: "approve",
    label: "Approve your budget",
    title: "Set a budget you are comfortable with.",
    body: "Review your ad, budget and schedule before launch. Nothing goes live without your approval.",
    benefit: "Your team gets one clear approval point, with Meta ad spend shown separately and upfront.",
  },
  {
    id: "enquiries",
    label: "See your enquiries",
    title: "Follow up from the same campaign view.",
    body: "Incoming seller enquiries sit beside their source and current spend, so the next conversation is easy to find.",
    benefit: "Less tab-hopping means more time responding while an enquiry is still fresh.",
  },
] as const satisfies readonly WalkthroughStep[];

export type ExampleEnquiry = {
  name: string;
  location: string;
  source: string;
  received: string;
  status: "New" | "Contacted";
};

export const EXAMPLE_ENQUIRIES = [
  {
    name: "Jordan M.",
    location: "Mount Lawley",
    source: "Free appraisal ad",
    received: "12 min ago",
    status: "New",
  },
  {
    name: "Casey R.",
    location: "Inglewood",
    source: "Free appraisal ad",
    received: "Yesterday",
    status: "Contacted",
  },
] as const satisfies readonly ExampleEnquiry[];

export const EXAMPLE_BUDGET = {
  initialDaily: 30,
  days: 14,
  minDaily: 15,
  maxDaily: 75,
  spendToDate: 142,
} as const;
