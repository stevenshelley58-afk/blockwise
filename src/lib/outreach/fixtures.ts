import { buildOutreachEmail, buildOutreachFollowUpEmail, toPublicOutreachReport, type EvidenceSegment, type OutreachAdExample, type OutreachAreaSnapshot, type OutreachProspect } from "./postcode-campaign.ts";

export const DEMO_OUTREACH_NOW = new Date("2026-09-07T08:00:00.000Z");
const ad = (id: string, pageName: string, headline: string, category: "listing" | "appraisal" | "branding"): OutreachAdExample => ({
  id, pageName, headline, category, format: "Single image", cta: category === "listing" ? "View property" : category === "appraisal" ? "Request appraisal" : "Learn more",
  body: category === "listing" ? "Open this weekend. Explore a home close to the city." : category === "appraisal" ? "Considering a move? Request a local appraisal." : "Meet the team behind your next move.",
  sourceUrl: `https://demo.blockwise.example/ads/${id}`, pageUrl: `https://demo.blockwise.example/pages/${id}`,
  observedAt: "2026-09-07T00:00:00.000Z", startedAt: "2026-09-01T00:00:00.000Z", mediaUrl: null, mediaRightsConfirmed: false,
});

/** Synthetic, deliberately isolated from the Ad Radar import. */
export const DEMO_OUTREACH_SNAPSHOT: OutreachAreaSnapshot = {
  postcode: "6000", coverageLabel: "Perth", suburbs: ["Perth"],
  evidence: { status: "recent_ads_observed", scanId: "demo-area-scan", scannedAt: "2026-09-07T00:00:00.000Z", completed: true, scopeVerified: true, source: "Synthetic preview", observedAdCount: 6 },
  adExamples: [
    ad("sample-1", "Example City Realty", "Your next city address", "listing"),
    ad("sample-2", "Example Local Property", "What could your home be worth?", "appraisal"),
    ad("sample-3", "Example West Homes", "A familiar face for your next move", "branding"),
    ad("sample-4", "Example Park Realty", "Open the door this Saturday", "listing"),
    ad("sample-5", "Example Central Property", "A local appraisal before you decide", "appraisal"),
    ad("sample-6", "Example Urban Homes", "Local knowledge. A personal approach.", "branding"),
  ], sourceRightsConfirmed: true,
};

export const DEMO_OUTREACH_PROSPECT: OutreachProspect = {
  externalRef: "demo-prospect", agentName: "Jordan Example", agencyName: "Example Personal Realty", recordedAgentLocation: "Perth WA", postcode: "6000",
  agentPageUrl: "https://demo.blockwise.example/agent", agencyPageUrl: "https://demo.blockwise.example/own-agency", contactEmail: "sample@example.test",
  contactProvenance: { source: "Synthetic fixture", capturedAt: "2026-09-07T00:00:00.000Z", verifiedAt: "2026-09-07T00:00:00.000Z" },
  advertisingEvidence: { ...DEMO_OUTREACH_SNAPSHOT.evidence, scanId: "demo-prospect-scan", observedAdCount: 1 },
  prospectAdExamples: [ad("sample-own", "Example Personal Realty", "Find your next place in Perth", "listing")],
  consentBasis: "Synthetic fixture only", consentRecordedAt: "2026-09-07T00:00:00.000Z", suppressionClear: true, sourceRightsConfirmed: true, scopeVerified: true, dataFreshAt: "2026-09-07T00:00:00.000Z", isDemo: true,
};

export function demoProspect(segment: EvidenceSegment = "recent_ads_observed"): OutreachProspect {
  return { ...DEMO_OUTREACH_PROSPECT, advertisingEvidence: { ...DEMO_OUTREACH_PROSPECT.advertisingEvidence, status: segment, observedAdCount: segment === "recent_ads_observed" ? 1 : 0, completed: segment !== "unknown" }, prospectAdExamples: segment === "recent_ads_observed" ? DEMO_OUTREACH_PROSPECT.prospectAdExamples : [] };
}

export function buildDemoOutreachReport(segment: EvidenceSegment = "recent_ads_observed") {
  return toPublicOutreachReport(DEMO_OUTREACH_SNAPSHOT, demoProspect(segment), DEMO_OUTREACH_NOW);
}

export function buildDemoOutreachPreview(options: { segment?: EvidenceSegment; followUp?: boolean; theme?: "light" | "dark" | "system" } = {}) {
  const input = { snapshot: DEMO_OUTREACH_SNAPSHOT, prospect: demoProspect(options.segment), reportUrl: `https://blockwise.sale/ad-reports/demo?segment=${options.segment ?? "recent_ads_observed"}`, businessIdentity: "Blockwise · Sample email", unsubscribeUrl: "https://blockwise.sale/ad-reports/demo/email#sample-unsubscribe", mode: "demo" as const, now: DEMO_OUTREACH_NOW, theme: options.theme };
  return options.followUp ? buildOutreachFollowUpEmail({ ...input, followUpCount: 0 }) : buildOutreachEmail(input);
}
