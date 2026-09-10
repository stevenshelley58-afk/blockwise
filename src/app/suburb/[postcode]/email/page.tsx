import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { buildOutreachEmail, configuredMediaOrigins, type EvidenceSegment } from "@/lib/outreach/postcode-campaign.ts";
import {
  AD_RADAR_SCAN_ID,
  AD_RADAR_SOURCE,
  loadAdRadarSnapshot,
  type AdRadarAreaSummary,
} from "@/lib/outreach/ad-radar-snapshot.ts";
import type { OutreachProspect } from "@/lib/outreach/postcode-campaign.ts";
import { resolveAdRadarLocationSearch, resolveAdRadarPostcodeSuburbs } from "@/lib/research/ad-radar-location.ts";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import "@/components/outbound-report/report-view.css";

export const revalidate = 60;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { postcode } = await params;
  return {
    title: `Live email draft for ${postcode} | Blockwise`,
    robots: { index: false, follow: false },
  };
}

type PageProps = {
  params: Promise<{ postcode: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function previewProspect(postcode: string, segment: EvidenceSegment): OutreachProspect {
  const now = new Date().toISOString();
  return {
    agentName: "Alex",
    agencyName: null,
    recordedAgentLocation: null,
    postcode,
    agentPageUrl: null,
    agencyPageUrl: null,
    contactEmail: "preview@blockwise.sale",
    advertisingEvidence: {
      status: segment,
      scanId: AD_RADAR_SCAN_ID,
      scannedAt: now,
      completed: true,
      scopeVerified: true,
      source: AD_RADAR_SOURCE,
      observedAdCount: segment === "recent_ads_observed" ? 1 : 0,
    },
    prospectAdExamples:
      segment === "recent_ads_observed"
        ? [
            {
              id: "preview-own",
              pageName: "Preview Page",
              headline: "Preview ad",
              body: null,
              sourceUrl: "https://www.facebook.com/ads/library/?id=preview",
              pageUrl: null,
              observedAt: now,
              startedAt: null,
              mediaUrl: null,
              mediaRightsConfirmed: false,
            },
          ]
        : [],
    contactProvenance: { source: "live preview", capturedAt: now, verifiedAt: now },
    consentBasis: "Live preview only — no message is sent.",
    consentRecordedAt: now,
    suppressionClear: true,
    sourceRightsConfirmed: true,
    scopeVerified: true,
    dataFreshAt: now,
    isDemo: false,
  };
}

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://blockwise.sale";
}

export default async function SuburbEmailPreviewPage({ params, searchParams }: PageProps) {
  const { postcode } = await params;
  const query = await searchParams;

  if (!/^\d{4}$/u.test(postcode)) notFound();

  const location = resolveAdRadarLocationSearch(postcode, { includeSurroundingSuburbs: true });
  if (!location) notFound();

  const locationLabel =
    location.terms.find(
      (term) => !/^\d{4}$/u.test(term) && !/^(WA|Western Australia)$/iu.test(term),
    ) || location.label;

  const suburbs = resolveAdRadarPostcodeSuburbs(postcode);

  let snapshotResult: Awaited<ReturnType<typeof loadAdRadarSnapshot>>;
  try {
    const supabase = createSupabaseServiceClient();
    snapshotResult = await loadAdRadarSnapshot(supabase, {
      postcode,
      coverageLabel: locationLabel,
      suburbs: suburbs.length > 0 ? suburbs : undefined,
    });
  } catch (error) {
    console.error("email preview load failed", error);
    notFound();
  }

  const segment =
    (query.segment as EvidenceSegment) ??
    (snapshotResult.snapshot.evidence.status === "recent_ads_observed"
      ? "recent_ads_observed"
      : snapshotResult.snapshot.evidence.status);
  const style = (query.style as "area" | "peers") ?? "area";
  const theme = (query.theme as "light" | "dark") === "dark" ? "dark" : "light";

  let email: ReturnType<typeof buildOutreachEmail> | null = null;
  let buildError: string | null = null;
  try {
    email = buildOutreachEmail({
      snapshot: snapshotResult.snapshot,
      prospect: previewProspect(postcode, segment),
      reportUrl: `${siteUrl()}/${postcode}`,
      businessIdentity: "Blockwise",
      unsubscribeUrl: `${siteUrl()}/preferences/unsubscribe`,
      areaSummary: snapshotResult.summary,
      subjectStyle: style,
      allowedMediaOrigins: configuredMediaOrigins(),
      theme,
    });
  } catch (error) {
    buildError = error instanceof Error ? error.message : String(error);
  }

  const summary = snapshotResult.summary;

  const buildHref = (changes: Record<string, string>) => {
    const sp = new URLSearchParams({ segment, style, theme, ...changes });
    return `/suburb/${postcode}/email?${sp.toString()}`;
  };

  return (
    <main className="or-page">
      <div className="or-shell or-email-shell">
        <header className="or-topbar">
          <Link href="/" className="or-wordmark">
            blockwise
          </Link>
          <span className="or-preview-badge">Live email draft</span>
        </header>

        <h1 className="or-preview-title">
          {postcode} — {locationLabel}
        </h1>

        <nav className="or-demo-nav" aria-label="Email variants">
          <Link href={buildHref({ segment: "recent_ads_observed" })}>Ads found</Link>
          <Link href={buildHref({ segment: "no_ads_found_after_successful_recent_scan" })}>No ads found</Link>
          <Link href={buildHref({ style: style === "area" ? "peers" : "area" })}>
            {style === "area" ? "Peer names subject" : "Area subject"}
          </Link>
          <Link href={buildHref({ theme: theme === "dark" ? "light" : "dark" })}>
            {theme === "dark" ? "Light" : "Dark"}
          </Link>
          <Link href={`/${postcode}`}>View public report</Link>
        </nav>

        {buildError ? (
          <div className="or-preview-note" style={{ color: "#c0392b" }}>
            <strong>Cannot build email preview.</strong>
            <br />
            {buildError}
          </div>
        ) : (
          <>
            <p className="or-email-subject">
              <strong>Subject:</strong> {email!.subject}
            </p>

            <p className="or-preview-note">
              Real Ad Radar data. Recipient name and contact are placeholders. No message is sent from this page.
              {summary.activeAdCount > 0 && (
                <>
                  {" "}
                  {summary.activeAdCount} live ad{summary.activeAdCount === 1 ? "" : "s"} from{" "}
                  {summary.advertiserCount} agenc{summary.advertiserCount === 1 ? "y" : "ies"}. Longest running{" "}
                  {summary.longestRunningDays} days.
                </>
              )}
            </p>

            <iframe
              title="Live cold email draft"
              className="or-email-frame"
              sandbox="allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer"
              srcDoc={email!.html.replace("<head>", '<head><base target="_top"><meta name="referrer" content="no-referrer">')}
            />

            <details className="or-plain-text">
              <summary>Plain text</summary>
              <pre>{email!.text}</pre>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
