import type { Metadata } from "next";
import Link from "next/link";
import { buildDemoOutreachPreview } from "@/lib/outreach/fixtures";
import { previewSegment } from "@/lib/outreach/preview-options";
import "@/components/outbound-report/report-view.css";
export const metadata: Metadata = { title: "Cold email preview", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function DemoEmailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const segment = previewSegment(params.segment), followUp = params.followup === "1", theme = params.theme === "dark" ? "dark" : "light";
  const email = buildDemoOutreachPreview({ segment, followUp, theme });
  const href = (changes: Record<string, string>) => `/ad-reports/demo/email?${new URLSearchParams({ segment, followup: followUp ? "1" : "0", theme, ...changes }).toString()}`;
  return <main className="or-page"><div className="or-shell or-email-shell"><header className="or-topbar"><Link href="/" className="or-wordmark">blockwise</Link><span className="or-preview-badge">Sample email</span></header><h1 className="or-preview-title">Your first introduction.</h1>
    <nav className="or-demo-nav" aria-label="Email variants"><Link href={href({ segment: "recent_ads_observed" })}>Ads found</Link><Link href={href({ segment: "no_ads_found_after_successful_recent_scan" })}>No ads found</Link><Link href={href({ segment: "unknown" })}>Unknown</Link><Link href={href({ followup: followUp ? "0" : "1" })}>{followUp ? "First email" : "Follow-up"}</Link><Link href={href({ theme: theme === "dark" ? "light" : "dark" })}>{theme === "dark" ? "Light" : "Dark"}</Link><Link href={`/ad-reports/demo?segment=${segment}`}>View matching report</Link></nav>
    <p className="or-email-subject"><strong>Subject:</strong> {email.subject}</p><p className="or-preview-note">Fictional agents and ads. Sending is off.</p>
    <iframe title="Quiet card cold email" className="or-email-frame" sandbox="allow-top-navigation-by-user-activation" referrerPolicy="no-referrer" srcDoc={email.html.replace("<head>", '<head><base target="_top"><meta name="referrer" content="no-referrer">')} />
    <details className="or-plain-text"><summary>Plain text</summary><pre>{email.text}</pre></details><p className="or-footer" id="sample-unsubscribe">Sample only. No subscription or unsubscribe action occurs here.</p>
  </div></main>;
}
