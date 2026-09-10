import Link from "next/link";
import { ArrowUpRight, ExternalLink, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicOutreachReport } from "@/lib/outreach/postcode-campaign";

type Ad = PublicOutreachReport["adExamples"][number];
const CATEGORIES = { listing: "Property listings", appraisal: "Appraisals", branding: "Agent branding", other: "Other ads" } as const;

export function OutboundReportView({ report, signupHref, isPreview = false }: { report: PublicOutreachReport; signupHref: string; isPreview?: boolean }) {
  const examples = report.adExamples.slice(0, 6);
  const own = report.prospectAdExamples.slice(0, 6);
  const groups = (Object.keys(CATEGORIES) as Array<keyof typeof CATEGORIES>).map(category => ({ category, ads: examples.filter(ad => (ad.category ?? "other") === category) })).filter(group => group.ads.length > 0);
  const hasOwn = report.segment === "recent_ads_observed";
  return <main className="or-page"><div className="or-shell">
    <header className="or-topbar">
      <Link href="/" className="or-wordmark" aria-label="Blockwise home"><span className="or-mark" aria-hidden="true"><span /><span /><span /></span>blockwise</Link>
      <span className={isPreview ? "or-preview-badge" : "or-report-badge"}>{isPreview ? "Sample report" : "Advertising snapshot"}</span>
    </header>
    {isPreview ? <nav className="or-demo-nav" aria-label="Preview options">
      <Link href="/ad-reports/demo?segment=recent_ads_observed">Ads found</Link>
      <Link href="/ad-reports/demo?segment=no_ads_found_after_successful_recent_scan">No ads found</Link>
      <Link href="/ad-reports/demo?segment=unknown">Unknown</Link>
      <Link href={`/ad-reports/demo/email?segment=${report.segment}`}>Preview email <ArrowUpRight size={14} aria-hidden="true" /></Link>
    </nav> : null}
    <section className="or-hero" aria-labelledby="report-title">
      <div><p className="or-eyebrow"><MapPin size={13} aria-hidden="true" />Agent postcode {report.postcode}</p><h1 id="report-title">Local ads.<br /><span>{report.coverageLabel}.</span></h1><p className="or-date">Snapshot: {date(report.scannedAt)}</p></div>
      <div className="or-location-visual" aria-label={`Recorded postcode ${report.postcode}`}><span className="or-location-grid" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} />)}</span><strong className="or-location-postcode">{report.postcode}</strong><span className="or-location-suburb">{report.suburbs.join(" · ")}</span></div>
    </section>
    {isPreview ? <p className="or-preview-note" role="note">Fictional agents and ads. No live Ad Radar data.</p> : null}
    <section className="or-fact-grid" aria-label="Snapshot facts"><Fact value={String(report.observedAdCount)} label="Ads in the area sample" /><Fact value={String(examples.length)} label="Local examples below" /><Fact value={date(report.scannedAt)} label="Checked" /></section>
    <section className="or-section" aria-labelledby="ads-heading"><div className="or-section-heading"><h2 id="ads-heading">What local agents are showing.</h2><span className="or-count">{examples.length} examples</span></div>
      {examples.length ? <div className="or-category-grid">{groups.map(({ category, ads }) => <section className="or-category" key={category} aria-labelledby={`category-${category}`}><header><h3 className="or-category-kicker" id={`category-${category}`}>{CATEGORIES[category]}</h3><span className="or-category-count">{ads.length}</span></header><div className="or-ad-list">{ads.map(ad => <AdCard ad={ad} isPreview={isPreview} key={ad.id} />)}</div></section>)}</div> : <p>No local examples are available in this snapshot.</p>}
    </section>
    <section className="or-section" aria-labelledby="own-heading"><div className="or-section-heading"><h2 id="own-heading">{hasOwn ? "Your ads, alongside the local sample." : "Your page."}</h2></div>
      {hasOwn && own.length ? <div className="or-own-list">{own.map(ad => <AdCard ad={ad} isPreview={isPreview} key={ad.id} />)}</div> : <p className="or-page-status">{report.segment === "no_ads_found_after_successful_recent_scan" ? "No ads found on your verified page in this check." : hasOwn ? "Ads were observed. Creative examples are not available in this report." : "Your advertising status is unconfirmed."}</p>}
    </section>
    <section className="or-cta" aria-labelledby="cta-heading"><div><p className="or-eyebrow">Your next ad</p><h2 id="cta-heading">{hasOwn ? "Try a different local message." : "Create your first local ad."}</h2><p className="or-offer">Three Feed + Story ad packs free. No card. Meta ad spend is separate.</p></div><Button asChild size="lg"><Link href={signupHref} referrerPolicy="no-referrer">Create my first ad free<ArrowUpRight size={17} aria-hidden="true" /></Link></Button></section>
    <footer className="or-footer"><p>Scope: recorded agent postcode, not confirmed ad targeting or service area. Source coverage is limited to the dated sample.</p><p>Comparisons cover visible creative only, not results, spend, leads or rankings. Only use creative assets you own or have permission to use.</p><div><Link href="/privacy" referrerPolicy="no-referrer">Privacy</Link><Link href="/terms" referrerPolicy="no-referrer">Terms</Link></div></footer>
  </div></main>;
}

function Fact({ value, label }: { value: string; label: string }) { return <article className="or-fact"><strong>{value}</strong><span>{label}</span></article>; }
function AdCard({ ad, isPreview }: { ad: Ad; isPreview: boolean }) {
  const source = ad.sourceUrl || ad.pageUrl;
  return <article className="or-ad-card" data-ad-id={ad.id}>
    <div className="or-ad-visual">{ad.mediaUrl ? <img src={ad.mediaUrl} alt={ad.headline || `Ad from ${ad.pageName}`} loading="lazy" referrerPolicy="no-referrer" /> : isPreview ? <div className={`or-sample-art or-sample-${ad.category ?? "other"}`} aria-label="Sample creative"><span>{ad.category === "listing" ? "OPEN HOME" : ad.category === "appraisal" ? "YOUR NEXT MOVE" : "LOCAL PROPERTY"}</span><strong>{ad.headline}</strong><i aria-hidden="true" /></div> : <div className="or-ad-placeholder"><span>Image unavailable</span></div>}</div>
    <div className="or-ad-copy"><div className="or-ad-meta"><strong>{ad.pageName}</strong><span>{date(ad.observedAt)}</span></div><h3>{ad.headline || "Ad example"}</h3>{ad.body ? <p>{ad.body}</p> : null}<div className="or-ad-bottom"><span>{ad.format || "Format not recorded"}{ad.cta ? ` · ${ad.cta}` : ""}</span>{source && !isPreview ? <a href={source} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">Source <ExternalLink size={12} aria-hidden="true" /></a> : <span>{isPreview ? "Sample creative" : "Source unavailable"}</span>}</div></div>
  </article>;
}
function date(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Perth" }).format(new Date(value)) : "Not recorded"; }
