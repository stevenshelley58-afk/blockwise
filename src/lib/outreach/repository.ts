import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOutreachEmail, configuredMediaOrigins, createOpaqueReportToken, evaluateOutreachEligibility, hashReportToken, outreachDraftImportSchema, publicOutreachReportSchema, toPublicOutreachReport, type OutreachAreaSnapshot, type PublicOutreachReport } from "./postcode-campaign.ts";

export class OutreachDraftError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) { super(message); this.name = "OutreachDraftError"; this.code = code; this.details = details; }
}

export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalValue(item)]));
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(value) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return value;
}
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
export function snapshotFingerprint(snapshot: OutreachAreaSnapshot): string { return fingerprint(snapshot); }

export type PersistedDraft = {
  id: string; reportUrl: string; reportToken: string; replayed: boolean;
  segment: PublicOutreachReport["segment"];
  eligibility: ReturnType<typeof evaluateOutreachEligibility>;
  email: ReturnType<typeof buildOutreachEmail>;
};

/** HMAC-authenticated adapter only. A single database transaction creates all three records. No outbox/provider path exists. */
export async function importOutreachDraft(supabase: SupabaseClient, input: unknown, now = new Date()): Promise<PersistedDraft | { valid: true; eligibility: ReturnType<typeof evaluateOutreachEligibility>; segment: PublicOutreachReport["segment"] }> {
  const parsed = outreachDraftImportSchema.safeParse(input);
  if (!parsed.success) throw new OutreachDraftError("invalid_contract", parsed.error.issues[0]?.message ?? "Invalid outreach draft.");
  const data = parsed.data, snapshot = data.snapshot, prospect = data.prospect;
  if (prospect.isDemo) throw new OutreachDraftError("demo_data_rejected", "Synthetic contacts cannot be imported.");
  if (new URL(data.reportBaseUrl).origin !== "https://blockwise.sale") throw new OutreachDraftError("invalid_report_origin", "Report links must use blockwise.sale.");
  if (new URL(data.unsubscribeUrl).pathname.startsWith("/ad-reports")) throw new OutreachDraftError("invalid_unsubscribe_destination", "Supply the working unsubscribe destination, not a report or preview link.");
  const eligibility = evaluateOutreachEligibility(snapshot, prospect, now);
  if (data.mode === "validate") return { valid: true, eligibility, segment: eligibility.segment };
  if (!eligibility.eligible) throw new OutreachDraftError("ineligible_contact", "The draft needs verified contact and area evidence.", eligibility);
  const token = createOpaqueReportToken();
  const reportUrl = new URL(`/ad-reports/${token}`, data.reportBaseUrl).toString();
  const allowedMediaOrigins = configuredMediaOrigins();
  const email = buildOutreachEmail({ snapshot, prospect, reportUrl, businessIdentity: data.businessIdentity, supportUrl: data.supportUrl, unsubscribeUrl: data.unsubscribeUrl, now, allowedMediaOrigins });
  const publicReport = toPublicOutreachReport(snapshot, prospect, now, allowedMediaOrigins);
  const { mode: _mode, idempotencyKey: _key, ...facts } = data;
  const idempotencyKey = data.idempotencyKey || fingerprint([prospect.contactEmail.toLowerCase(), snapshot.postcode, snapshot.evidence.scanId]);
  const { data: saved, error } = await supabase.rpc("outreach_import_draft", {
    p_snapshot: {
      postcode: snapshot.postcode, coverage_label: snapshot.coverageLabel, suburbs: snapshot.suburbs,
      scan_status: snapshot.evidence.status, scan_id: snapshot.evidence.scanId, scanned_at: snapshot.evidence.scannedAt,
      scan_completed: snapshot.evidence.completed, scope_verified: snapshot.evidence.scopeVerified, scan_source: snapshot.evidence.source,
      observed_ad_count: snapshot.evidence.observedAdCount, ad_examples: snapshot.adExamples, source_rights_confirmed: snapshot.sourceRightsConfirmed,
      snapshot_fingerprint: snapshotFingerprint(snapshot),
    },
    p_prospect: {
      external_ref: prospect.externalRef ?? null, agent_name: prospect.agentName, agency_name: prospect.agencyName, recorded_agent_location: prospect.recordedAgentLocation,
      postcode: prospect.postcode, agent_page_url: prospect.agentPageUrl, agency_page_url: prospect.agencyPageUrl,
      contact_email: prospect.contactEmail.toLowerCase(), contact_provenance: prospect.contactProvenance, advertising_evidence: prospect.advertisingEvidence,
      prospect_ad_examples: prospect.prospectAdExamples, consent_basis: prospect.consentBasis, consent_recorded_at: prospect.consentRecordedAt,
      suppression_clear: prospect.suppressionClear, source_rights_confirmed: prospect.sourceRightsConfirmed, scope_verified: prospect.scopeVerified,
      data_fresh_at: prospect.dataFreshAt, is_demo: false,
    },
    p_draft: {
      idempotency_key: idempotencyKey, import_fingerprint: fingerprint({ ...facts, prospect: { ...prospect, contactEmail: prospect.contactEmail.toLowerCase() } }),
      report_token_hash: hashReportToken(token), report_url: reportUrl, email_subject: email.subject, email_html: email.html, email_text: email.text,
      email_template_id: email.templateId, email_template_version: email.templateVersion, evidence_segment: eligibility.segment, public_report: publicReport,
    },
  });
  if (error || !saved?.draft) {
    const code = ["snapshot_conflict", "import_conflict", "draft_blocked"].find(code => error?.message?.includes(code)) || "draft_persist_failed";
    throw new OutreachDraftError(code, code === "draft_persist_failed" ? "The draft could not be saved. Retrying the same import is safe." : code.replaceAll("_", " "));
  }
  const draft = saved.draft;
  return {
    id: draft.id, reportUrl: draft.report_url, reportToken: new URL(draft.report_url).pathname.split("/").at(-1)!, replayed: saved.replayed === true,
    segment: draft.evidence_segment, eligibility,
    email: { subject: draft.email_subject, html: draft.email_html, text: draft.email_text, templateId: draft.email_template_id, templateVersion: draft.email_template_version, wordCount: draft.email_text.split(/\s+/u).length },
  };
}

/** Stored payload is frozen at creation. Unknown/revoked tokens never expose contacts or database diagnostics. */
export async function loadPublicOutreachReport(supabase: SupabaseClient, token: string, _now?: Date): Promise<PublicOutreachReport | null> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  const { data, error } = await supabase.from("outreach_campaign_drafts").select("public_report").eq("report_token_hash", hashReportToken(token)).eq("status", "draft").maybeSingle();
  if (error || !data) return null;
  const report = publicOutreachReportSchema.safeParse(data.public_report);
  if (!report.success) return null;
  const origins = configuredMediaOrigins();
  const safeMedia = (ad: PublicOutreachReport["adExamples"][number]) => ({ ...ad, mediaUrl: ad.mediaUrl && origins.includes(new URL(ad.mediaUrl).origin) ? ad.mediaUrl : null });
  return { ...report.data, adExamples: report.data.adExamples.map(safeMedia), prospectAdExamples: report.data.prospectAdExamples.map(safeMedia) };
}
