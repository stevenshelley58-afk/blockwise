import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import { renderEmail } from "../email-design/renderer.ts";
import type { EmailMessage } from "../email-design/types.ts";

/**
 * Contract for the postcode outbound adapter.
 *
 * A postcode is deliberately a string. It is the recorded location on an
 * agent or agency source record, not an ad-targeting instruction and not a
 * definitive suburb. A single postcode can cover several suburbs.
 */
export const postcodeSchema = z.string().regex(/^\d{4}$/u, "Postcode must be a four-digit string.");

const httpsUrlSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Use an absolute HTTPS URL.");

export const outreachAdExampleSchema = z.object({
  id: z.string().trim().min(1).max(160),
  pageName: z.string().trim().min(1).max(160),
  headline: z.string().trim().max(240).nullable().default(null),
  body: z.string().trim().max(700).nullable().default(null),
  sourceUrl: httpsUrlSchema.nullable().default(null),
  pageUrl: httpsUrlSchema.nullable().default(null),
  observedAt: z.string().datetime().nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  mediaUrl: httpsUrlSchema.nullable().default(null),
  mediaRightsConfirmed: z.boolean().default(false),
  category: z.enum(["listing", "appraisal", "branding", "other"]).optional(),
  format: z.string().trim().max(80).optional(),
  cta: z.string().trim().max(100).optional(),
});

export type OutreachAdExample = z.infer<typeof outreachAdExampleSchema>;

export const outreachScanEvidenceSchema = z.object({
  status: z.enum(["recent_ads_observed", "no_ads_found_after_successful_recent_scan", "unknown"]),
  scanId: z.string().trim().min(1).max(160),
  scannedAt: z.string().datetime(),
  completed: z.boolean(),
  scopeVerified: z.boolean(),
  source: z.string().trim().min(1).max(120),
  observedAdCount: z.number().int().min(0).max(100000),
});

export type OutreachScanEvidence = z.infer<typeof outreachScanEvidenceSchema>;

export const outreachAreaSnapshotSchema = z.object({
  postcode: postcodeSchema,
  coverageLabel: z.string().trim().min(1).max(240),
  suburbs: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  evidence: outreachScanEvidenceSchema,
  adExamples: z.array(outreachAdExampleSchema).max(12).default([]),
  sourceRightsConfirmed: z.boolean(),
});

export type OutreachAreaSnapshot = z.infer<typeof outreachAreaSnapshotSchema>;

export const outreachProspectSchema = z.object({
  externalRef: z.string().trim().max(160).optional(),
  agentName: z.string().trim().min(1).max(160),
  agencyName: z.string().trim().max(200).nullable().default(null),
  recordedAgentLocation: z.string().trim().max(240).nullable().default(null),
  postcode: postcodeSchema,
  agentPageUrl: httpsUrlSchema.nullable().default(null),
  agencyPageUrl: httpsUrlSchema.nullable().default(null),
  contactEmail: z.string().email().max(320),
  /** Evidence tied to this agent/page, distinct from area coverage. */
  advertisingEvidence: outreachScanEvidenceSchema,
  prospectAdExamples: z.array(outreachAdExampleSchema).max(12).default([]),
  contactProvenance: z.object({
    source: z.string().trim().min(1).max(240),
    capturedAt: z.string().datetime(),
    verifiedAt: z.string().datetime().nullable().default(null),
  }),
  consentBasis: z.string().trim().min(1).max(500),
  consentRecordedAt: z.string().datetime().nullable().default(null),
  suppressionClear: z.boolean(),
  sourceRightsConfirmed: z.boolean(),
  scopeVerified: z.boolean(),
  dataFreshAt: z.string().datetime(),
  isDemo: z.boolean().default(false),
});

export type OutreachProspect = z.infer<typeof outreachProspectSchema>;

export const outreachDraftImportSchema = z.object({
  mode: z.enum(["validate", "import"]).default("validate"),
  idempotencyKey: z.string().trim().min(16).max(200).optional(),
  reportBaseUrl: httpsUrlSchema,
  businessIdentity: z.string().trim().min(1).max(240),
  supportUrl: httpsUrlSchema.nullable().default(null),
  unsubscribeUrl: httpsUrlSchema,
  snapshot: outreachAreaSnapshotSchema,
  prospect: outreachProspectSchema,
});

export type OutreachDraftImport = z.infer<typeof outreachDraftImportSchema>;

export type EvidenceSegment = "recent_ads_observed" | "no_ads_found_after_successful_recent_scan" | "unknown";

export const MAX_EVIDENCE_AGE_HOURS = 72;

export type EvidenceDecision = {
  segment: EvidenceSegment;
  usable: boolean;
  fresh: boolean;
  reason: string;
};

/**
 * Failed, stale, incomplete, or out-of-scope scans always become unknown.
 * This is the central guard against turning a crawler failure into an
 * absence claim.
 */
export function classifyEvidence(evidence: OutreachScanEvidence, now = new Date()): EvidenceDecision {
  const ageMs = now.getTime() - new Date(evidence.scannedAt).getTime();
  const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_EVIDENCE_AGE_HOURS * 60 * 60 * 1000;
  const usable = evidence.completed && evidence.scopeVerified && fresh && evidence.source.trim().length > 0;
  if (!usable) {
    return {
      segment: "unknown",
      usable: false,
      fresh,
      reason: !fresh ? "scan_stale" : !evidence.completed ? "scan_incomplete" : !evidence.scopeVerified ? "scope_unverified" : "scan_source_missing",
    };
  }
  if (evidence.status === "recent_ads_observed" && evidence.observedAdCount > 0) {
    return { segment: "recent_ads_observed", usable: true, fresh: true, reason: "recent_ads_observed" };
  }
  if (evidence.status === "no_ads_found_after_successful_recent_scan" && evidence.observedAdCount === 0) {
    return {
      segment: "no_ads_found_after_successful_recent_scan",
      usable: true,
      fresh: true,
      reason: "successful_recent_scan_returned_no_ads",
    };
  }
  return { segment: "unknown", usable: false, fresh: true, reason: "evidence_status_count_mismatch" };
}

export type EligibilityReason =
  | "demo_data"
  | "contact_provenance_missing"
  | "consent_basis_missing"
  | "suppressed"
  | "source_rights_unconfirmed"
  | "stale_contact_data"
  | "stale_or_unusable_scan"
  | "scope_unverified"
  | "postcode_mismatch"
  | "insufficient_peer_examples"
  | "invalid_area_evidence";

export type EligibilityDecision = {
  eligible: boolean;
  reasons: EligibilityReason[];
  segment: EvidenceSegment;
};

export function evaluateOutreachEligibility(
  snapshot: OutreachAreaSnapshot,
  prospect: OutreachProspect,
  now = new Date(),
): EligibilityDecision {
  // Area coverage is shared context only. Eligibility is driven by a
  // prospect-specific page scan so one advertiser cannot inherit another's
  // evidence merely because both records share a postcode.
  const evidence = classifyEvidence(prospect.advertisingEvidence, now);
  const reasons: EligibilityReason[] = [];
  const contactAgeMs = now.getTime() - new Date(prospect.dataFreshAt).getTime();
  const contactFresh = Number.isFinite(contactAgeMs) && contactAgeMs >= 0 && contactAgeMs <= MAX_EVIDENCE_AGE_HOURS * 60 * 60 * 1000;

  if (prospect.isDemo) reasons.push("demo_data");
  if (!prospect.contactProvenance.source || !prospect.contactProvenance.capturedAt || !prospect.contactProvenance.verifiedAt) reasons.push("contact_provenance_missing");
  if (!prospect.consentBasis.trim() || !prospect.consentRecordedAt) reasons.push("consent_basis_missing");
  if (!prospect.suppressionClear) reasons.push("suppressed");
  if (!snapshot.sourceRightsConfirmed || !prospect.sourceRightsConfirmed || prospect.prospectAdExamples.some((example) => !example.sourceUrl && !example.pageUrl)) reasons.push("source_rights_unconfirmed");
  if (!contactFresh) reasons.push("stale_contact_data");
  const areaEvidence = classifyEvidence(snapshot.evidence, now);
  if (!areaEvidence.usable) reasons.push("stale_or_unusable_scan");
  if (!prospect.scopeVerified || !snapshot.evidence.scopeVerified) reasons.push("scope_unverified");
  if (snapshot.evidence.observedAdCount < snapshot.adExamples.length || snapshot.adExamples.some(ad => !ad.observedAt || !ad.sourceUrl || new Date(ad.observedAt).getTime() > now.getTime())) reasons.push("invalid_area_evidence");
  if (selectPeerExamples(snapshot, prospect).length < 2) reasons.push("insufficient_peer_examples");
  if (snapshot.postcode !== prospect.postcode) reasons.push("postcode_mismatch");

  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], segment: evidence.segment };
}

export type PublicAdExample = Pick<OutreachAdExample, "id" | "pageName" | "headline" | "body" | "sourceUrl" | "pageUrl" | "observedAt" | "startedAt" | "category" | "format" | "cta">;

export type PublicOutreachReport = {
  reportVersion: 1;
  postcode: string;
  coverageLabel: string;
  suburbs: string[];
  segment: EvidenceSegment;
  scannedAt: string;
  observedAdCount: number;
  adExamples: Array<PublicAdExample & { mediaUrl: string | null }>;
  prospectAdExamples: Array<PublicAdExample & { mediaUrl: string | null }>;
  prospect: {
    agentName: string;
    agencyName: string | null;
    recordedAgentLocation: string | null;
    postcode: string;
    agentPageUrl: string | null;
    agencyPageUrl: string | null;
  };
};

/** Remove contact, consent, CRM, and media data before a report is public. */
export function toPublicOutreachReport(snapshot: OutreachAreaSnapshot, prospect: OutreachProspect, now = new Date(), allowedMediaOrigins: readonly string[] = []): PublicOutreachReport {
  const decision = classifyEvidence(prospect.advertisingEvidence, now);
  const toPublicExample = (example: OutreachAdExample) => ({
    id: example.id,
    pageName: example.pageName,
    headline: example.headline,
    body: example.body,
    sourceUrl: example.sourceUrl,
    pageUrl: example.pageUrl,
    observedAt: example.observedAt,
    startedAt: example.startedAt,
    mediaUrl: permittedPublicMediaUrl(example, allowedMediaOrigins),
    ...(example.category ? { category: example.category } : {}),
    ...(example.format ? { format: example.format } : {}),
    ...(example.cta ? { cta: example.cta } : {}),
  });
  return {
    reportVersion: 1,
    postcode: snapshot.postcode,
    coverageLabel: snapshot.coverageLabel,
    suburbs: snapshot.suburbs,
    segment: decision.segment,
    scannedAt: snapshot.evidence.scannedAt,
    observedAdCount: snapshot.evidence.observedAdCount,
    adExamples: selectPeerExamples(snapshot, prospect).slice(0, 6).map(toPublicExample),
    prospectAdExamples: prospect.prospectAdExamples.slice(0, 6).map(toPublicExample),
    prospect: {
      agentName: prospect.agentName,
      agencyName: prospect.agencyName,
      recordedAgentLocation: prospect.recordedAgentLocation,
      postcode: prospect.postcode,
      agentPageUrl: prospect.agentPageUrl,
      agencyPageUrl: prospect.agencyPageUrl,
    },
  };
}

function permittedPublicMediaUrl(example: OutreachAdExample, allowedOrigins: readonly string[]): string | null {
  if (!example.mediaRightsConfirmed || !example.mediaUrl || allowedOrigins.length === 0) return null;
  try {
    const media = new URL(example.mediaUrl);
    if (media.protocol !== "https:" || !allowedOrigins.includes(media.origin)) return null;
    return media.toString();
  } catch {
    return null;
  }
}

export function configuredMediaOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.OUTREACH_MEDIA_ALLOWED_ORIGINS ?? "").split(",").map((value) => {
    try { return new URL(value.trim()).origin; } catch { return ""; }
  }).filter(Boolean);
}

function emailMedia(example: OutreachAdExample, allowedOrigins: readonly string[]): { image?: { src: string; alt: string } } {
  if (!example.mediaRightsConfirmed || !example.mediaUrl || allowedOrigins.length === 0) return {};
  try {
    const url = new URL(example.mediaUrl);
    return url.protocol === "https:" && allowedOrigins.includes(url.origin)
      ? { image: { src: url.toString(), alt: `${example.pageName} public ad example` } }
      : {};
  } catch {
    return {};
  }
}

export type OutreachAreaFacts = {
  activeAdCount: number;
  advertiserCount: number;
  longestRunningDays: number;
};

/** "area" names only the postcode. "peers" names two real advertisers from the data. */
export type OutreachSubjectStyle = "area" | "peers";

export type OutreachEmailInput = {
  snapshot: OutreachAreaSnapshot;
  prospect: OutreachProspect;
  reportUrl: string;
  businessIdentity: string;
  supportUrl?: string | null;
  unsubscribeUrl: string;
  mode?: "production" | "demo";
  allowedMediaOrigins?: readonly string[];
  now?: Date;
  theme?: "light" | "dark" | "system";
  /** Live area counters from the Ad Radar adapter. Falls back to snapshot counts. */
  areaSummary?: Partial<OutreachAreaFacts>;
  subjectStyle?: OutreachSubjectStyle;
};

/** Area counters for the email body, derived from the snapshot when no adapter summary is supplied. */
export function resolveAreaFacts(snapshot: OutreachAreaSnapshot, summary?: Partial<OutreachAreaFacts>): OutreachAreaFacts {
  const exampleAdvertisers = new Set(snapshot.adExamples.map((ad) => ad.pageName.trim().toLowerCase())).size;
  return {
    activeAdCount: summary?.activeAdCount ?? Math.max(snapshot.evidence.observedAdCount, snapshot.adExamples.length),
    advertiserCount: summary?.advertiserCount ?? exampleAdvertisers,
    longestRunningDays: summary?.longestRunningDays ?? 0,
  };
}

const CATEGORY_LABELS: Record<NonNullable<OutreachAdExample["category"]>, string> = {
  listing: "listing",
  appraisal: "appraisal",
  branding: "brand",
  other: "ad",
};

/** One line under an observed creative: what it says, its angle, how long it has held. */
function exampleLine(example: OutreachAdExample, now: Date): string {
  const copy = (example.headline || example.body || "").trim().replace(/\s+/gu, " ").slice(0, 90);
  const angle = example.category ? CATEGORY_LABELS[example.category] : null;
  const started = example.startedAt ? new Date(example.startedAt).getTime() : Number.NaN;
  const days = Number.isFinite(started) ? Math.max(0, Math.floor((now.getTime() - started) / 86_400_000)) : null;
  const meta = [angle, days === null ? null : `running ${days} days`].filter(Boolean).join(" · ");
  const quoted = copy ? `\u201c${copy}\u201d` : "";
  return [quoted, meta].filter(Boolean).join("\n");
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function areaSubject(postcode: string): string {
  return `I audited every property ad in ${postcode}`;
}

function peersSubject(examples: OutreachAdExample[], postcode: string, advertiserCount: number): string {
  const [first, second] = examples;
  if (!first) return areaSubject(postcode);
  const others = Math.max(advertiserCount - 2, 0);
  if (!second) return `${first.pageName} and ${others} others are advertising in ${postcode}`;
  if (others <= 0) return `${first.pageName} and ${second.pageName} are advertising in ${postcode}`;
  return `${first.pageName}, ${second.pageName} and ${others} others are advertising in ${postcode}`;
}

/** Select external advertiser examples, never label the recipient's own office as a peer. */
export function selectPeerExamples(snapshot: OutreachAreaSnapshot, prospect: OutreachProspect): OutreachAdExample[] {
  const normalise = (value: string | null) => (value ?? "").trim().toLowerCase().replace(/\/$/u, "");
  const ownPages = new Set([prospect.agentPageUrl, prospect.agencyPageUrl].filter(Boolean).map(normalise));
  const ownNames = new Set([prospect.agentName, prospect.agencyName].filter(Boolean).map(normalise));
  const ids = new Set<string>();
  const peers = snapshot.adExamples.filter(ad => {
    if (ids.has(ad.id) || (ad.pageUrl && ownPages.has(normalise(ad.pageUrl))) || ownNames.has(normalise(ad.pageName))) return false;
    ids.add(ad.id);
    return Boolean(ad.sourceUrl);
  });
  // Prefer different advertisers in the email's first two cards.
  const names = new Set<string>();
  const first: OutreachAdExample[] = [], rest: OutreachAdExample[] = [];
  for (const ad of peers) {
    const advertiser = normalise(ad.pageUrl || ad.pageName);
    if (names.has(advertiser)) rest.push(ad);
    else { names.add(advertiser); first.push(ad); }
  }
  return [...first, ...rest];
}

function emailFooter(input: OutreachEmailInput): EmailMessage["footer"] {
  const unsubscribe = httpsUrlSchema.parse(input.unsubscribeUrl);
  if (unsubscribe === input.reportUrl) throw new Error("Unsubscribe must use a separate, working destination.");
  return {
    reason: input.mode === "demo" ? "Sample data. Nothing is sent. Unsubscribe is disabled in this preview." : "I send this to agents advertising in the area. Unsubscribe and I will stop.",
    businessIdentity: input.businessIdentity,
    supportUrl: input.supportUrl ?? undefined,
    unsubscribeUrl: unsubscribe,
  };
}

/** Draft only. The caller supplies the same clock used to classify and freeze the report. */
export function buildOutreachEmail(input: OutreachEmailInput) {
  const reportUrl = httpsUrlSchema.parse(input.reportUrl);
  const segment = classifyEvidence(input.prospect.advertisingEvidence, input.now ?? new Date()).segment;
  let examples = selectPeerExamples(input.snapshot, input.prospect);
  if ((input.allowedMediaOrigins ?? []).length > 0) {
    const withMedia = examples.filter((e) => e.mediaUrl && e.mediaRightsConfirmed);
    const withoutMedia = examples.filter((e) => !e.mediaUrl || !e.mediaRightsConfirmed);
    examples = [...withMedia, ...withoutMedia];
  }
  examples = examples.slice(0, 2);
  if (examples.length < 2) throw new Error("Two sourced local ad examples are required for every email segment.");
  const area = input.snapshot.coverageLabel;
  const postcode = input.snapshot.postcode;
  const name = input.prospect.agentName.split(/\s+/u)[0] || "there";
  const observed = segment === "recent_ads_observed";
  const facts = resolveAreaFacts(input.snapshot, input.areaSummary);
  const ads = plural(facts.activeAdCount, "property ad", "property ads");
  const agencies = plural(facts.advertiserCount, "agency", "agencies");
  const longest = facts.longestRunningDays > 0 ? ` Longest running ${facts.longestRunningDays} days.` : "";
  const subject = input.subjectStyle === "peers"
    ? peersSubject(examples, postcode, facts.advertiserCount)
    : areaSubject(postcode);
  const message: EmailMessage = {
    kind: "postcode-outreach-preview",
    eyebrow: input.mode === "demo" ? "SAMPLE EMAIL" : `${area.toUpperCase()} · ${postcode}`,
    subject: `${input.mode === "demo" ? "[Sample] " : ""}${subject}`,
    preheader: `Every property ad in ${postcode}, audited. ${plural(facts.activeAdCount, "live ad", "live ads")}, ${agencies}.`,
    greeting: `Hi ${name},`,
    heading: `I audited every property ad in ${postcode}`,
    // Short lines beat sentences here: the reader is scanning for names they know.
    intro: observed
      ? `${ads} live right now, from ${agencies}. Yours is one of them.${longest} Two you will know:`
      : `${ads} live right now, from ${agencies}.${longest} Two you will know:`,
    sections: examples.map(example => ({
      heading: example.pageName,
      body: exampleLine(example, input.now ?? new Date()),
      ...emailMedia(example, input.allowedMediaOrigins ?? []),
    })),
    action: { label: "Open the full audit", href: reportUrl },
    note: `${input.snapshot.evidence.source}, observed ${input.snapshot.evidence.scannedAt.slice(0, 10)}. ${postcode} and nearby postcodes, matched on recorded agent location, not confirmed ad targeting. Free, no signup.`,
    signOff: "Steven\nPerth",
    transactional: false,
    footer: emailFooter(input),
  };
  const rendered = renderEmail(message, "quiet-card", input.theme ?? "system");
  return { ...rendered, templateId: "quiet-card-postcode-outreach", templateVersion: 1, wordCount: rendered.text.split(/\s+/u).length };
}

export function buildOutreachFollowUpEmail(input: OutreachEmailInput & { followUpCount: number }) {
  if (!followUpAllowed(input.followUpCount)) throw new Error("Only one outreach follow-up is permitted.");
  const examples = selectPeerExamples(input.snapshot, input.prospect);
  const extra = examples[2];
  if (!extra) throw new Error("A follow-up needs an additional sourced example.");
  const area = input.snapshot.coverageLabel;
  const postcode = input.snapshot.postcode;
  const facts = resolveAreaFacts(input.snapshot, input.areaSummary);
  const message: EmailMessage = {
    kind: "postcode-outreach-follow-up-preview",
    eyebrow: input.mode === "demo" ? "SAMPLE FOLLOW-UP" : "ONE MORE LOCAL EXAMPLE",
    subject: `${input.mode === "demo" ? "[Sample] " : ""}${extra.pageName} is still running ads in ${postcode}`,
    preheader: `One more from the ${area} snapshot, with its source link.`,
    greeting: `Hi ${input.prospect.agentName.split(/\s+/u)[0] || "there"},`,
    heading: "One more local ad",
    intro: `One more from the ${area} snapshot. The report keeps every example with its source link.`,
    sections: [{
      heading: extra.pageName,
      body: (extra.headline || extra.body || "Ad example").slice(0, 180),
      ...emailMedia(extra, input.allowedMediaOrigins ?? []),
      ...(extra.sourceUrl ? { link: { label: "See it in the Ad Library", href: extra.sourceUrl } } : {}),
    }],
    action: { label: `See all ${facts.activeAdCount} ads`, href: httpsUrlSchema.parse(input.reportUrl) },
    note: `${input.snapshot.evidence.source}, observed ${input.snapshot.evidence.scannedAt.slice(0, 10)}. Matched on recorded agent postcode ${postcode}, not confirmed ad targeting.`,
    signOff: "Steven\nBlockwise",
    transactional: false,
    footer: emailFooter(input),
  };
  const rendered = renderEmail(message, "quiet-card", input.theme ?? "system");
  return { ...rendered, templateId: "quiet-card-postcode-outreach-follow-up", templateVersion: 1, wordCount: rendered.text.split(/\s+/u).length };
}

const publicExampleSchema = outreachAdExampleSchema.omit({ mediaRightsConfirmed: true });
export const publicOutreachReportSchema = z.object({
  reportVersion: z.literal(1), postcode: postcodeSchema, coverageLabel: z.string(), suburbs: z.array(z.string()),
  segment: z.enum(["recent_ads_observed", "no_ads_found_after_successful_recent_scan", "unknown"]),
  scannedAt: z.string().datetime(), observedAdCount: z.number().int().nonnegative(),
  adExamples: z.array(publicExampleSchema).max(6), prospectAdExamples: z.array(publicExampleSchema).max(6),
  prospect: outreachProspectSchema.pick({ agentName: true, agencyName: true, recordedAgentLocation: true, postcode: true, agentPageUrl: true, agencyPageUrl: true }),
});

export function createOpaqueReportToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function followUpAllowed(followUpCount: number): boolean {
  return Number.isInteger(followUpCount) && followUpCount === 0;
}

