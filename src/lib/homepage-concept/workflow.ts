/** Preview fixtures only. No listing, approval or provider integration. */
export const WORKFLOW_STEPS = ["Choose", "Customise", "Review"] as const;
export const WORKFLOW_PHASES = [
  { label: "Browse templates", step: 0, duration: 1800 },
  { label: "Template selected", step: 0, duration: 1400 },
  { label: "Customise the ad", step: 1, duration: 1100 },
  { label: "Editing post copy", step: 1, duration: 2200 },
  { label: "Editing the creative", step: 1, duration: 2000 },
  { label: "Review campaign", step: 2, duration: 950 },
  { label: "Campaign details filled", step: 2, duration: 1200 },
  { label: "Approve campaign", step: 2, duration: 550 },
  { label: "Campaign approved", step: 2, duration: 2200 },
] as const;
export const WORKFLOW_STEP_STARTS = [0, 2, 5] as const;
export const WORKFLOW_TEMPLATES = [
  { id: "appraisal", label: "Appraisal", image: "/home/home-dusk.webp", title: "A new perspective", detail: "Discover your home's value" },
  { id: "listing", label: "Property listing", image: "/home/subiaco-townhouse.webp", title: "Discover Subiaco", detail: "3 beds  ·  2 baths  ·  2 cars" },
  { id: "guide", label: "Suburb guide", image: "/home/home-pool.webp", title: "Life, locally", detail: "Your neighbourhood guide" },
] as const;
export const WORKFLOW_AD = {
  agency: "West Coast Home Co",
  initials: "WCH",
  startingCopy: "A fresh start in Subiaco. Explore the property.",
  editedCopy: "Your next chapter starts in Subiaco. View this Saturday.",
  startingTitle: "Discover Subiaco",
  editedTitle: "18 Olive Street",
  subtitle: "Subiaco, WA",
  domain: "WESTCOASTHOME.CO",
} as const;
export function workflowFrame(phase: number) {
  const index = Math.max(0, Math.min(WORKFLOW_PHASES.length - 1, Math.trunc(phase)));
  return {
    index,
    ...WORKFLOW_PHASES[index],
    template: index === 0 ? 0 : 1,
    postEdited: index >= 3,
    titleEdited: index >= 4,
    filled: index >= 6,
    pressing: index === 7,
    approved: index === 8,
  };
}
export function nextWorkflowPhase(phase: number) {
  return (phase + 1) % WORKFLOW_PHASES.length;
}
