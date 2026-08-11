// Customer-typed on-image fields render on the ad verbatim; the vision QA then
// verifies these exact strings. Distinct values prove nothing was invented or
// paraphrased.
export const KILL_TEST_COPY: Record<string, string> = {
  // Distinct customer copy, but deliberately matched to the locked sample's
  // character count and word rhythm. The visual-likeness gate scores text-box
  // bounds and line rhythm, so a one-line placeholder would invalidate the ad
  // system this E2E is meant to prove.
  headline: "Find your coastal home today",
  body: "Your coastal partner for all real estate needs.",
  price: "$847,500",
  address: "12 MARINE PDE, SCARBOROUGH WA 6019",
  phone: "+61 411 222 333",
  "website handle": "@scarboroughhomes",
};

function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolve deliberate E2E copy from an input's real accessible label. An
 * unfamiliar field stops the run instead of producing a false QA claim with
 * placeholder text.
 */
export function customerCopyForAccessibleLabel(label: string, inputId: string): string {
  const normalisedLabel = normaliseLabel(label);
  const matches = Object.entries(KILL_TEST_COPY).filter(([key]) => normalisedLabel.includes(key));
  if (matches.length !== 1) {
    throw new Error(
      `Ad Studio E2E cannot bind on-image copy input ${JSON.stringify(inputId)} to KILL_TEST_COPY: ` +
        `accessible label was ${JSON.stringify(label)}.`,
    );
  }
  return matches[0][1];
}
