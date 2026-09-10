"use client";

import { trackMarketingEvent } from "@/lib/analytics/marketing";

import Link from "next/link";

function fireSafe(event: string, properties: Record<string, string | number>) {
  try { const w = window as Window & { fbq?: (...args: unknown[]) => void; gtag?: (...args: unknown[]) => void }; w.fbq?.("trackCustom", event, properties); trackMarketingEvent(event, properties); } catch {}
}

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";

import type { PublicAdRadarCard } from "@/lib/research/public-ad-radar";
import type { SuburbReportInsights } from "@/lib/research/suburb-report-insights";


import { emailSuburbReport, type ReportEmailState } from "./actions";

type NearbyArea = { postcode: string; suburb: string; count: number };

type SuburbReportClientProps = {
  ads: PublicAdRadarCard[];
  coverageLabel: string;
  insights: SuburbReportInsights;
  nearby: NearbyArea[];
  playScan: boolean;
  postcode: string;
  suburb: string;
};

const initialEmailState: ReportEmailState = { ok: false };

export function SuburbReportClient(props: SuburbReportClientProps) {
  const { ads, coverageLabel, insights, nearby, playScan, postcode, suburb } = props;
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

  const reportLabel = coverageLabel ? postcode : suburb;
  const longest = insights.longestRunningAd;
  const longestMedia = longest?.media[0]?.url ?? null;
  const trialHref = gateHref(postcode, "trial");

  return (
    <main className="sr-page">
      {showScan ? <ScanOverlay suburb={suburb} postcode={postcode} step={scanStep} count={scanCount} /> : null}
      <header className="sr-topbar">
        <div className="sr-topbar-inner">
          <Link className="sr-logo" href="/">blockwise</Link>
          <span className="sr-live-chip"><span />{reportLabel}{coverageLabel ? "" : ` ${postcode}`} · live</span>
          <div className="sr-topbar-actions">
            <button className="sr-button sr-button-ghost" type="button" onClick={() => setEmailOpen(true)}>Email me this audit</button>
            <GateLink href={trialHref} intent="trial" postcode={postcode} className="sr-button sr-button-dark">Create three ads free</GateLink>
          </div>
        </div>
      </header>

      <div className="sr-shell">
        <section className="sr-report-header" aria-labelledby="report-title">
          <p className="sr-eyebrow">Free area audit · no account needed</p>
          <h1 id="report-title">Every live ad {coverageLabel ? `across ${postcode}` : `in ${suburb}`}, audited.</h1>
          <p className="sr-meta">{coverageLabel ? `${coverageLabel} · ` : ""}Updated today · Free to browse, all of it</p>
          <div className="sr-stats">
            <Stat value={String(ads.length)} label="live ads observed" />
            <Stat value={String(insights.distinctAdvertiserCount)} label="local advertisers" />
            <Stat value={`${insights.topCategoryShare}%`} label={`${insights.topCategory} · top category`} />
            <Stat value={insights.longestRunningDays ? `${insights.longestRunningDays} days` : "New"} label="longest-running ad" />
          </div>
        </section>

        {longest ? (
          <section className="sr-section" aria-labelledby="longevity-title">
            <SectionHeading id="longevity-title" title="The ad that will not switch off" note={`The strongest signal in this ${postcode} audit`} />
            <article className="sr-longevity">
              {longestMedia ? <div className="sr-longevity-media"><img src={longestMedia} alt={`Ad creative from ${longest.pageName}`} loading="lazy" /></div> : null}
              <div className="sr-longevity-body">
                <p className="sr-longevity-days">{insights.longestRunningDays} days live</p>
                <h3>{longest.pageName}</h3>
                <p>{longest.headline || longest.body || "Observed local ad"}</p>
                <p>Agencies switch ads off when they stop working. {longest.pageName} has kept this one live for at least {insights.longestRunningDays} days, which usually means it is still producing enquiries. Copy the angle, not the artwork.</p>
              </div>
            </article>
          </section>
        ) : null}

        {ads.length === 0 ? (
          <EmptyState suburb={suburb} postcode={postcode} nearby={nearby} trialHref={trialHref} />
        ) : (
          <>
            <section className="sr-section" aria-labelledby="snapshot-title">
              <SectionHeading id="snapshot-title" title="Market snapshot" note={`Who's buying attention in ${postcode}, based on the ads observed today`} />
              <div className="sr-snapshot">
                <div className="sr-chart" aria-label="Observed ads by category">
                  <h2>{insights.chartTitle}</h2>
                  {insights.chartRows.map((row) => {
                    const total = insights.chartRows.reduce((sum, entry) => sum + entry.count, 0);
                    const width = total ? Math.max(3, Math.round((row.count / total) * 100)) : 0;
                    return <div className="sr-chart-row" key={row.label}><span>{row.label}</span><i><b style={{ transform: `scaleX(${width / 100})` }} /></i><strong>{row.count}</strong></div>;
                  })}
                </div>
                <div className="sr-insights">
                  {insights.insights.map((insight) => <article key={insight.kind}><span className="sr-insight-mark" aria-hidden>↗</span><div><h2>{insight.title}</h2><p>{insight.body}</p></div></article>)}
                </div>
              </div>
            </section>

            <section className="sr-section" aria-labelledby="gaps-title">
              <SectionHeading id="gaps-title" title="Gaps you could own" note={insights.gapNote} />
              <div className="sr-concepts">
                {insights.gapConcepts.map((concept) => (
                  <article className="sr-concept" key={concept.key}>
                    <span className="sr-concept-label">{concept.label}</span>
                    <div className="sr-concept-preview"><span>Your photo or logo</span><div><h2>{concept.headline}</h2><p>{concept.body}</p><b>{concept.cta}</b></div></div>
                    <p>{concept.rationale}</p>
                    <GateLink href={gateHref(postcode, "remix")} intent="remix" postcode={postcode} className="sr-button sr-button-ghost sr-button-wide">Make this yours in AdStudio →</GateLink>
                  </article>
                ))}
              </div>
            </section>

            <section className="sr-section" aria-labelledby="next-title">
              <SectionHeading id="next-title" title="What to do with this" note="Three practical moves before you spend anything" />
              <div className="sr-insights">
                <article><span className="sr-insight-mark" aria-hidden>&#8599;</span><div><h2>One ad, one offer, one CTA</h2><p>Write one clear homeowner problem, one offer and one action per ad. Distinct messages give Meta distinct signals and make your own results readable.</p></div></article>
                <article><span className="sr-insight-mark" aria-hidden>&#8599;</span><div><h2>Fund learning, not a ratio</h2><p>Give a new angle enough delivery to learn from, then change one decision at a time. Splitting a small budget across many ideas teaches you nothing.</p></div></article>
                <article><span className="sr-insight-mark" aria-hidden>&#8599;</span><div><h2>Judge contactable homeowners</h2><p>Cheap leads that never answer are not cheaper. Measure cost per valid, contactable homeowner and per appraisal, not cost per form fill.</p></div></article>
              </div>
            </section>

            <section className="sr-section" aria-labelledby="ads-title">
              <SectionHeading id="ads-title" title="The actual ads" note={`All ${ads.length} observed ads, longest-running first`} />
              <div className="sr-ad-grid">
                {ads.slice(0, visibleCount).map((ad) => <ReportAdCard key={ad.id} ad={ad} postcode={postcode} suburb={suburb} longestId={insights.longestRunningAd?.id ?? null} longestDays={insights.longestRunningDays} />)}
              </div>
              {visibleCount < ads.length ? <div className="sr-load-more"><button className="sr-button sr-button-ghost" type="button" onClick={() => setVisibleCount((count) => Math.min(count + 9, ads.length))}>Show more ads</button><p>Showing {Math.min(visibleCount, ads.length)} of {ads.length}, all free to browse</p></div> : null}
            </section>

            <AuditGenerator postcode={postcode} suburb={suburb} />

            <section className="sr-cta-band">
              <div><h2>{reportLabel} changes every week. Keep watching it.</h2><p>This report stays free. A free trial adds tools on top:</p><ul><li>Alerts when a new advertiser appears in {reportLabel}</li><li>Track each advertiser's launches and changes</li><li>Use an observed ad as an AdStudio starting point</li></ul></div>
              <div className="sr-cta-actions"><GateLink href={trialHref} intent="trial" postcode={postcode} className="sr-button sr-button-light">Start your free trial →</GateLink><button type="button" onClick={() => setEmailOpen(true)}>Or just email me this audit</button><small>14 days free · No credit card · Your audit stays free either way</small></div>
            </section>
          </>
        )}
      </div>
      <EmailReportDialog open={emailOpen} onClose={() => setEmailOpen(false)} postcode={postcode} suburb={suburb} />
    </main>
  );
}

function ScanOverlay({ suburb, postcode, step, count }: { suburb: string; postcode: string; step: number; count: number }) {
  const steps = [`Finding live ads across ${postcode}`, `Matching ads to ${suburb} and surrounds`, "Profiling advertisers and categories", "Finding gaps you could test"];
  return <div className="sr-scan" role="status" aria-live="polite"><div className="sr-scan-inner"><p>Free area audit</p><h1>Auditing {suburb} <span>{postcode}</span></h1><p>Building your audit from the ads observed right now.</p><ol>{steps.map((label, index) => <li className={index <= step ? "is-active" : ""} key={label}><span>{index < step ? "✓" : index === step ? "◌" : ""}</span>{label}</li>)}</ol><strong>{count}</strong><small>live ads found so far</small></div><div className="sr-scan-map" aria-hidden><b>{suburb}, WA</b><span>scanning…</span><i /><i /><i /><i /></div></div>;
}

function Stat({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }
function SectionHeading({ id, title, note }: { id: string; title: string; note: string }) { return <div className="sr-section-heading"><h2 id={id}>{title}</h2><p>{note}</p></div>; }

function ReportAdCard({ ad, postcode, suburb, longestId, longestDays }: { ad: PublicAdRadarCard; postcode: string; suburb: string; longestId: string | null; longestDays: number }) {
  const media = ad.media[0];
  const initials = ad.pageName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <article className="sr-ad-card"><header>{ad.pageImageUrl ? <img src={ad.pageImageUrl} alt="" loading="lazy" /> : <span>{initials}</span>}<div><h3>{ad.pageName}</h3><p>{ad.adType || "Local advertiser"}</p></div><div className="sr-platforms">{ad.platforms.map((platform) => <b key={platform}>{platform.slice(0, 2).toUpperCase()}</b>)}</div></header><div className="sr-ad-media">{media ? (media.kind === "video" ? <video src={media.url} poster={media.posterUrl ?? undefined} controls playsInline preload="none" aria-label={`Video ad from ${ad.pageName}`} /> : <img src={media.url} alt={`Ad creative from ${ad.pageName}`} loading="lazy" />) : <div><span>Creative unavailable</span></div>}{ad.id === longestId ? <em>⏱ {longestDays} days · longest in {suburb}</em> : null}</div><div className="sr-ad-copy"><h3>{ad.headline || ad.description || "Observed local ad"}</h3><p>{ad.body || ad.description || "Copy was not available."}</p><footer><span className="sr-active-dot" />{ad.durationLabel || "Recently observed"}<b>{ad.destinationDomain || "Destination unavailable"}</b></footer></div><div className="sr-ad-actions"><GateLink href={gateHref(postcode, "track")} intent="track" postcode={postcode}>Track advertiser</GateLink><GateLink href={gateHref(postcode, "remix")} intent="remix" postcode={postcode}>Remix in AdStudio</GateLink></div></article>;
}

function EmptyState({ suburb, postcode, nearby, trialHref }: { suburb: string; postcode: string; nearby: NearbyArea[]; trialHref: string }) {
  return <section className="sr-empty"><h2>No live ads were observed for {suburb} today.</h2><p>That does not mean nobody is advertising. It means the current public dataset did not return a match for {postcode} or its surrounds.</p>{nearby.length ? <div><h3>Try a nearby report</h3>{nearby.map((area) => <Link key={area.postcode} href={`/suburb/${area.postcode}`}>{area.suburb} {area.postcode}<span>{area.count} ads</span></Link>)}</div> : null}<GateLink href={trialHref} intent="trial" postcode={postcode} className="sr-button sr-button-dark">Create three ads free</GateLink></section>;
}

function GateLink({ href, intent, postcode, className, children }: { href: string; intent: string; postcode: string; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={className} onClick={() => fireSafe("report_gate_clicked", { postcode, intent })}>{children}</Link>;
}

function EmailReportDialog({ open, onClose, postcode, suburb }: { open: boolean; onClose: () => void; postcode: string; suburb: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(emailSuburbReport, initialEmailState);
  useEffect(() => { const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); else if (!open && dialog.open) dialog.close(); }, [open]);
  useEffect(() => { if (state.ok) fireSafe("report_email_submitted", { postcode }); }, [postcode, state.ok]);
  return <dialog className="sr-email-dialog" ref={ref} onCancel={onClose} onClose={onClose}><button className="sr-dialog-close" type="button" onClick={onClose} aria-label="Close">×</button>{state.ok ? <div className="sr-email-success"><span>✓</span><h2>Sent. It's yours.</h2><p>PS: a free account adds alerts and tracking while this audit stays free.</p><button className="sr-button sr-button-dark" type="button" onClick={onClose}>Back to the audit</button></div> : <><h2>Send this audit to your inbox</h2><p>One email with a live link to your {suburb} audit. No drip sequence.</p><form action={action}><input type="hidden" name="postcode" value={postcode} /><input type="hidden" name="suburb" value={suburb} /><label htmlFor="report-email">Email address</label><div><input id="report-email" name="email" type="email" autoComplete="email" required placeholder="you@business.com.au" /><button className="sr-button sr-button-dark" disabled={pending} type="submit">{pending ? "Sending…" : "Send it"}</button></div>{state.error ? <p className="sr-form-error" role="alert">{state.error}</p> : null}</form><small>The link remains available as the observed ad set changes.</small></>}</dialog>;
}

function gateHref(postcode: string, intent: "track" | "remix" | "trial") { return `/signup?src=suburb-report&postcode=${postcode}&intent=${intent}`; }

type AuditPreviewAd = {
  index: number;
  previewUrl: string;
  angleLabel: string;
  rationale: string;
  headline: string;
};

type AuditBundle = {
  auditId: string;
  businessName: string;
  ads: AuditPreviewAd[];
};

function AuditGenerator({ postcode, suburb }: { postcode: string; suburb: string }) {
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<AuditBundle | null>(null);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const cleanWebsite = website.trim();
    const cleanName = name.trim();
    if (!cleanWebsite && !cleanName) {
      setError("Add your agency website or your agency name.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/audit/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postcode, website: cleanWebsite, name: cleanName, suburb }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<AuditBundle> & { error?: unknown };
      if (!response.ok || typeof data.auditId !== "string" || !Array.isArray(data.ads)) {
        setError(typeof data.error === "string" ? data.error : "We could not build your ads. Try again.");
        return;
      }
      setBundle({ auditId: data.auditId, businessName: typeof data.businessName === "string" ? data.businessName : "", ads: data.ads as AuditPreviewAd[] });
      fireSafe("audit_generated", { postcode });
    } catch {
      setError("We could not build your ads. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClaim() {
    if (!bundle || claiming) return;
    setClaiming(true);
    setError(null);
    try {
      const response = await fetch("/api/audit/ads/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId: bundle.auditId }),
      });
      if (response.status === 401) {
        window.location.href = `/signup?src=suburb-report&postcode=${encodeURIComponent(postcode)}&intent=trial&auditId=${encodeURIComponent(bundle.auditId)}`;
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { adIds?: unknown; error?: unknown };
      if (!response.ok || !Array.isArray(data.adIds) || data.adIds.length === 0) {
        setError(typeof data.error === "string" ? data.error : "We could not save these ads. Try again.");
        return;
      }
      fireSafe("audit_claimed", { postcode });
      window.location.href = "/ad-studio";
    } catch {
      setError("We could not save these ads. Check your connection and try again.");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <section className="sr-audit-generator" aria-labelledby="audit-generator-title">
      <h2 id="audit-generator-title">See how your agency could look</h2>
      <p>Enter your agency website or name. We will find your brand colours, match them to our templates, and show you 3 ads aimed at the gap in your local market.</p>
      <form className="sr-audit-form" onSubmit={handleGenerate}>
        <input type="text" name="website" autoComplete="url" placeholder="https://youragency.com.au" aria-label="Agency website" value={website} onChange={(event) => setWebsite(event.target.value)} />
        <input type="text" name="name" autoComplete="organization" placeholder="Or your agency name" aria-label="Agency name" value={name} onChange={(event) => setName(event.target.value)} />
        <button className="sr-button sr-button-dark" type="submit" disabled={busy}>{busy ? "Building your ads…" : "Generate my 3 ads"}</button>
      </form>
      {error ? <p className="sr-form-error" role="alert">{error}</p> : null}
      {bundle ? (
        <div className="sr-preview-grid">
          {bundle.ads.map((ad) => (
            <div className="sr-preview-card" key={ad.index}>
              <img src={ad.previewUrl} alt={ad.headline} loading="lazy" />
              <h3>{ad.angleLabel}</h3>
              <p>{ad.rationale}</p>
            </div>
          ))}
          <div className="sr-cta-block">
            <button className="sr-button sr-button-light" type="button" onClick={handleClaim} disabled={claiming}>{claiming ? "Saving…" : "Free trial — run these 3 ads today in under 5 mins"}</button>
            <p className="sr-note">No credit card required. Ads saved to your Ad Studio library.</p>
          </div>
          <div className="sr-pricing-block">
            <h4>Want to run them yourself?</h4>
            <p>Blockwise Ad Studio starts with a 14-day free trial. <Link href="/pricing">See pricing</Link>.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
