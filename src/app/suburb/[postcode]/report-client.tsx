"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import type { PublicAdRadarCard } from "@/lib/research/public-ad-radar";
import type { SuburbReportInsights } from "@/lib/research/suburb-report-insights";
import { REPORT_CATEGORIES } from "@/lib/research/suburb-report-insights";

import { emailSuburbReport, type ReportEmailState } from "./actions";

type NearbyArea = { postcode: string; suburb: string; count: number };

type SuburbReportClientProps = {
  ads: PublicAdRadarCard[];
  insights: SuburbReportInsights;
  isSurrounds: boolean;
  nearby: NearbyArea[];
  playScan: boolean;
  postcode: string;
  suburb: string;
};

const initialEmailState: ReportEmailState = { ok: false };

export function SuburbReportClient(props: SuburbReportClientProps) {
  const { ads, insights, isSurrounds, nearby, playScan, postcode, suburb } = props;
  const [visibleCount, setVisibleCount] = useState(9);
  const [showScan, setShowScan] = useState(playScan);
  const [scanStep, setScanStep] = useState(0);
  const [scanCount, setScanCount] = useState(0);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    fireSafe("report_viewed", { postcode, adCount: ads.length });
  }, [ads.length, postcode]);

  useEffect(() => {
    if (!playScan) return;
    const start = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setScanStep(Math.min(3, Math.floor(elapsed / 620)));
      setScanCount(Math.min(ads.length, Math.round((elapsed / 2500) * ads.length)));
    }, 80);
    const done = window.setTimeout(() => setShowScan(false), 2600);
    return () => { window.clearInterval(tick); window.clearTimeout(done); };
  }, [ads.length, playScan]);

  const reportLabel = `${suburb}${isSurrounds ? " + surrounds" : ""}`;
  const trialHref = gateHref(postcode, "trial");

  return (
    <main className="sr-page">
      {showScan ? <ScanOverlay suburb={suburb} postcode={postcode} step={scanStep} count={scanCount} /> : null}
      <header className="sr-topbar">
        <div className="sr-topbar-inner">
          <Link className="sr-logo" href="/">blockwise</Link>
          <span className="sr-live-chip"><span />{reportLabel} {postcode} · live</span>
          <div className="sr-topbar-actions">
            <button className="sr-button sr-button-ghost" type="button" onClick={() => setEmailOpen(true)}>Email me this report</button>
            <GateLink href={trialHref} intent="trial" postcode={postcode} className="sr-button sr-button-dark">Start free trial</GateLink>
          </div>
        </div>
      </header>

      <div className="sr-shell">
        <section className="sr-report-header" aria-labelledby="report-title">
          <p className="sr-eyebrow">Free suburb report · no account needed</p>
          <h1 id="report-title">Every live ad in {reportLabel}, in one place.</h1>
          <p className="sr-meta">Observed from the Meta Ad Library · Updated today · Free to browse, all of it</p>
          <div className="sr-stats">
            <Stat value={String(ads.length)} label="live ads observed" />
            <Stat value={String(insights.distinctAdvertiserCount)} label="local advertisers" />
            <Stat value={`${insights.topCategoryShare}%`} label={`${insights.topCategory} · top category`} />
            <Stat value={insights.longestRunningDays ? `${insights.longestRunningDays} days` : "New"} label="longest-running ad" />
          </div>
        </section>

        {ads.length === 0 ? (
          <EmptyState suburb={suburb} postcode={postcode} nearby={nearby} trialHref={trialHref} />
        ) : (
          <>
            <section className="sr-section" aria-labelledby="snapshot-title">
              <SectionHeading id="snapshot-title" title="Market snapshot" note={`Who's buying attention in ${postcode}, based on the ads observed today`} />
              <div className="sr-snapshot">
                <div className="sr-chart" aria-label="Observed ads by category">
                  <h2>Live ads by category</h2>
                  {REPORT_CATEGORIES.map((category) => {
                    const count = insights.categoryCounts[category];
                    const width = ads.length ? Math.max(3, Math.round((count / ads.length) * 100)) : 0;
                    return <div className="sr-chart-row" key={category}><span>{category}</span><i><b style={{ transform: `scaleX(${width / 100})` }} /></i><strong>{count}</strong></div>;
                  })}
                </div>
                <div className="sr-insights">
                  {insights.insights.map((insight) => <article key={insight.kind}><span className="sr-insight-mark" aria-hidden>↗</span><div><h2>{insight.title}</h2><p>{insight.body}</p></div></article>)}
                </div>
              </div>
            </section>

            <section className="sr-section" aria-labelledby="gaps-title">
              <SectionHeading id="gaps-title" title="Gaps you could own" note={`Three concepts based on categories with lighter representation in ${reportLabel}`} />
              <div className="sr-concepts">
                {insights.gapConcepts.map((concept) => (
                  <article className="sr-concept" key={concept.category}>
                    <span className="sr-concept-label">{concept.label}</span>
                    <div className="sr-concept-preview"><span>Your photo or logo</span><div><h2>{concept.headline}</h2><p>{concept.body}</p><b>{concept.cta}</b></div></div>
                    <p>{concept.rationale}</p>
                    <GateLink href={gateHref(postcode, "remix")} intent="remix" postcode={postcode} className="sr-button sr-button-ghost sr-button-wide">Make this yours in AdStudio →</GateLink>
                  </article>
                ))}
              </div>
            </section>

            <section className="sr-section" aria-labelledby="ads-title">
              <SectionHeading id="ads-title" title="The actual ads" note={`All ${ads.length} observed ads, longest-running first`} />
              <div className="sr-ad-grid">
                {ads.slice(0, visibleCount).map((ad) => <ReportAdCard key={ad.id} ad={ad} postcode={postcode} suburb={suburb} longestId={insights.longestRunningAd?.id ?? null} longestDays={insights.longestRunningDays} />)}
              </div>
              {visibleCount < ads.length ? <div className="sr-load-more"><button className="sr-button sr-button-ghost" type="button" onClick={() => setVisibleCount((count) => Math.min(count + 9, ads.length))}>Show more ads</button><p>Showing {Math.min(visibleCount, ads.length)} of {ads.length}, all free to browse</p></div> : null}
            </section>

            <section className="sr-cta-band">
              <div><h2>{reportLabel} changes every week. Keep watching it.</h2><p>This report stays free. A free trial adds tools on top:</p><ul><li>Alerts when a new advertiser appears in {reportLabel}</li><li>Track each advertiser's launches and changes</li><li>Use an observed ad as an AdStudio starting point</li></ul></div>
              <div className="sr-cta-actions"><GateLink href={trialHref} intent="trial" postcode={postcode} className="sr-button sr-button-light">Start your free trial →</GateLink><button type="button" onClick={() => setEmailOpen(true)}>Or just email me this report</button><small>14 days free · No credit card · Your report stays free either way</small></div>
            </section>
          </>
        )}
      </div>
      <EmailReportDialog open={emailOpen} onClose={() => setEmailOpen(false)} postcode={postcode} suburb={suburb} />
    </main>
  );
}

function ScanOverlay({ suburb, postcode, step, count }: { suburb: string; postcode: string; step: number; count: number }) {
  const steps = ["Pulling live ads from the Meta Ad Library", `Matching ads to ${suburb} and surrounds`, "Profiling advertisers and categories", "Finding gaps you could test"];
  return <div className="sr-scan" role="status" aria-live="polite"><div className="sr-scan-inner"><p>Free suburb report</p><h1>Scanning {suburb} <span>{postcode}</span></h1><p>Building your report from the ads observed right now.</p><ol>{steps.map((label, index) => <li className={index <= step ? "is-active" : ""} key={label}><span>{index < step ? "✓" : index === step ? "◌" : ""}</span>{label}</li>)}</ol><strong>{count}</strong><small>live ads found so far</small></div><div className="sr-scan-map" aria-hidden><b>{suburb}, WA</b><span>scanning…</span><i /><i /><i /><i /></div></div>;
}

function Stat({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function SectionHeading({ id, title, note }: { id: string; title: string; note: string }) { return <div className="sr-section-heading"><h2 id={id}>{title}</h2><p>{note}</p></div>; }

function ReportAdCard({ ad, postcode, suburb, longestId, longestDays }: { ad: PublicAdRadarCard; postcode: string; suburb: string; longestId: string | null; longestDays: number }) {
  const media = ad.media[0];
  const initials = ad.pageName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <article className="sr-ad-card"><header>{ad.pageImageUrl ? <img src={ad.pageImageUrl} alt="" loading="lazy" /> : <span>{initials}</span>}<div><h3>{ad.pageName}</h3><p>{ad.adType || "Local advertiser"}</p></div><div className="sr-platforms">{ad.platforms.map((platform) => <b key={platform}>{platform.slice(0, 2).toUpperCase()}</b>)}</div></header><div className="sr-ad-media">{media ? (media.kind === "video" ? <video poster={media.posterUrl ?? undefined} preload="none" aria-label={`Video ad from ${ad.pageName}`} /> : <img src={media.url} alt={`Ad creative from ${ad.pageName}`} loading="lazy" />) : <div><span>Creative unavailable</span></div>}{ad.id === longestId ? <em>⏱ {longestDays} days · longest in {suburb}</em> : null}</div><div className="sr-ad-copy"><h3>{ad.headline || ad.description || "Observed local ad"}</h3><p>{ad.body || ad.description || "Copy was not available from the source."}</p><footer><span className="sr-active-dot" />{ad.durationLabel || "Recently observed"}<b>{ad.destinationDomain || "Destination unavailable"}</b></footer></div><div className="sr-ad-actions"><GateLink href={gateHref(postcode, "track")} intent="track" postcode={postcode}>Track advertiser</GateLink><GateLink href={gateHref(postcode, "remix")} intent="remix" postcode={postcode}>Remix in AdStudio</GateLink></div></article>;
}

function EmptyState({ suburb, postcode, nearby, trialHref }: { suburb: string; postcode: string; nearby: NearbyArea[]; trialHref: string }) {
  return <section className="sr-empty"><p className="sr-eyebrow">Coverage is still growing</p><h2>No live ads were observed for {suburb} today.</h2><p>That does not mean nobody is advertising. It means the current public dataset did not return a match for {postcode} or its surrounds.</p>{nearby.length ? <div><h3>Try a nearby report</h3>{nearby.map((area) => <Link key={area.postcode} href={`/suburb/${area.postcode}`}>{area.suburb} {area.postcode}<span>{area.count} ads</span></Link>)}</div> : null}<GateLink href={trialHref} intent="trial" postcode={postcode} className="sr-button sr-button-dark">Start free trial</GateLink></section>;
}

function GateLink({ href, intent, postcode, className, children }: { href: string; intent: string; postcode: string; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={className} onClick={() => fireSafe("report_gate_clicked", { postcode, intent })}>{children}</Link>;
}

function EmailReportDialog({ open, onClose, postcode, suburb }: { open: boolean; onClose: () => void; postcode: string; suburb: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(emailSuburbReport, initialEmailState);
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }, [open]);
  useEffect(() => { if (state.ok) fireSafe("report_email_submitted", { postcode }); }, [postcode, state.ok]);
  return <dialog className="sr-email-dialog" ref={ref} onCancel={onClose} onClose={onClose}><button className="sr-dialog-close" type="button" onClick={onClose} aria-label="Close">×</button>{state.ok ? <div className="sr-email-success"><span>✓</span><h2>Sent. It's yours.</h2><p>PS: a free account adds alerts and tracking while this report stays free.</p><button className="sr-button sr-button-dark" type="button" onClick={onClose}>Back to report</button></div> : <><h2>Send this report to your inbox</h2><p>One email with a live link to your {suburb} report. No drip sequence.</p><form action={action}><input type="hidden" name="postcode" value={postcode} /><input type="hidden" name="suburb" value={suburb} /><label htmlFor="report-email">Email address</label><div><input id="report-email" name="email" type="email" autoComplete="email" required placeholder="you@business.com.au" /><button className="sr-button sr-button-dark" disabled={pending} type="submit">{pending ? "Sending…" : "Send it"}</button></div>{state.error ? <p className="sr-form-error" role="alert">{state.error}</p> : null}</form><small>The link remains available as the observed ad set changes.</small></>}</dialog>;
}

function gateHref(postcode: string, intent: "track" | "remix" | "trial") { return `/signup?src=suburb-report&postcode=${postcode}&intent=${intent}`; }
function fireSafe(event: string, properties: Record<string, string | number>) { try { track(event, properties); } catch { /* analytics is best effort */ } if (typeof window === "undefined") return; const analyticsWindow = window as Window & { fbq?: (...args: unknown[]) => void; gtag?: (...args: unknown[]) => void }; try { analyticsWindow.fbq?.("trackCustom", event, properties); } catch {} try { analyticsWindow.gtag?.("event", event, properties); } catch {} }
