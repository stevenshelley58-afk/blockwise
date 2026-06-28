import Link from "next/link";

import { ExternalLink, ImageOff, Play } from "lucide-react";

import { formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import type { MetaAdPerformance } from "@/lib/meta-monitor/types";

import { AdManagementControls } from "./AdManagementControls";

export function adCardDomId(adId: string): string {
  return `meta-ad-${adId}`;
}

export function AdPerformanceCard({ ad }: { ad: MetaAdPerformance }) {
  const metrics = ad.metrics;
  const guidance = leadGuidance(ad);
  const leadSource = leadSourceLabel(ad);
  const leadContext = leadContextLabel(ad);

  return (
    <article className="panel mm-ad-card" id={adCardDomId(ad.adId)}>
      <div className="mm-ad-row-main">
        <CreativePreview ad={ad} size={58} />
        <div className="mm-ad-head-text">
          <h4>
            <span className="mm-ad-title-text">{leadSource}</span>
            <StatusPill status={ad.status} />
            {ad.fatigued ? <span className="mm-pill amber">Fatiguing</span> : null}
          </h4>
          <span className="mm-ad-campaign">{leadContext}</span>
        </div>
        <div className="mm-ad-row-kpi">
          <span>Cost/lead</span>
          <strong>{metrics.validCpl != null ? formatCurrency(metrics.validCpl) : "Unavailable"}</strong>
        </div>
      </div>

      {ad.fatigued ? (
        <p className="mm-ad-meta" role="status">
          This lead source may be tiring.{" "}
          <Link href={`/ad-studio?from=fatigue&adId=${encodeURIComponent(ad.adId)}`}>
            Refresh it
          </Link>
          .
        </p>
      ) : null}

      <dl className="mm-ad-inline-stats">
        <Metric label="Spend" value={formatCurrency(metrics.spend)} />
        <Metric label="Leads" value={String(metrics.leads)} />
        <Metric label="Good" value={String(metrics.validLeads)} />
        <Metric label="Action" value={guidance.action} />
      </dl>

      <div className={`mm-ad-guidance ${guidance.tone}`}>
        <div>
          <strong>{guidance.title}</strong>
          <span>{guidance.body}</span>
        </div>
        <Link className="button secondary" href="/leads">Open leads</Link>
      </div>

      <dl className="mm-ad-reason-grid" aria-label="Lead source evidence">
        <Metric label="Qualified leads" value={String(metrics.validLeads)} />
        <Metric label="Lead quality" value={metrics.validRate != null ? formatPercent(metrics.validRate) : "Unavailable"} />
        <Metric label="Total enquiries" value={String(metrics.leads)} />
        <Metric label="Spend" value={formatCurrency(metrics.spend)} />
      </dl>

      <div className="mm-ad-actions">
        <AdManagementControls target={{ kind: "ad", adId: ad.adId }} status={ad.status} showExport />
        <ActionLink href={ad.landingPageUrl} label="Open page" />
        <ActionLink href={ad.metaPermalinkUrl} label="Meta details" />
      </div>
    </article>
  );
}

export function CreativePreview({ ad, size }: { ad: MetaAdPerformance; size: number }) {
  const src = ad.creative.thumbnailUrl ?? ad.creative.imageUrl ?? ad.creative.videoThumbnailUrl;

  if (src) {
    return (
      <span className="mm-creative" style={{ width: size, height: size }}>
        {/* Meta CDN thumbnails are short-lived signed URLs; next/image optimization would break them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${ad.adName} creative`} width={size} height={size} loading="lazy" />
        {ad.creative.type === "VIDEO" ? (
          <span className="mm-creative-play">
            <Play size={12} aria-hidden />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="mm-creative mm-creative-placeholder" style={{ width: size, height: size }}>
      <ImageOff size={Math.max(14, size / 5)} aria-hidden />
      <small>No preview</small>
    </span>
  );
}

export function StatusPill({ status }: { status: MetaAdPerformance["status"] }) {
  const tone = status === "ACTIVE" ? "green" : status === "PAUSED" ? "amber" : "neutral";
  const label = status.charAt(0) + status.slice(1).toLowerCase();

  return <span className={`mm-pill ${tone}`}>{label}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mm-ad-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function leadSourceLabel(ad: MetaAdPerformance): string {
  if (ad.suburb) return `${ad.suburb} lead source`;
  return ad.campaignName || ad.adName;
}

function leadContextLabel(ad: MetaAdPerformance): string {
  if (ad.suburb && ad.campaignName) return ad.campaignName;
  return ad.adsetName || ad.adName;
}

function leadGuidance(ad: MetaAdPerformance): { action: string; title: string; body: string; tone: "good" | "warn" } {
  const { spend, leads, validLeads, validCpl, validRate } = ad.metrics;

  if (ad.fatigued) {
    return {
      action: "Review",
      title: "Refresh soon",
      body: "Qualified leads are worth watching, but this source is showing fatigue.",
      tone: "warn",
    };
  }

  if (spend > 0 && validLeads === 0) {
    return {
      action: "Review",
      title: "No qualified leads yet",
      body: "Money has been spent but no qualified leads have come through.",
      tone: "warn",
    };
  }

  if (validRate != null && validRate < 0.45 && leads >= 5) {
    return {
      action: "Review",
      title: "Lead quality is weak",
      body: `${formatPercent(validRate)} of enquiries are qualified. Review this source before adding budget.`,
      tone: "warn",
    };
  }

  return {
    action: "Keep",
    title: "Keep running",
    body:
      validCpl != null
        ? `${validLeads} qualified lead${validLeads === 1 ? "" : "s"} at ${formatCurrency(validCpl)} each.`
        : `${validLeads} qualified lead${validLeads === 1 ? "" : "s"} so far.`,
    tone: "good",
  };
}

function ActionLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span className="button secondary mm-action-disabled" aria-disabled>
        {label}
      </span>
    );
  }

  return (
    <a className="button secondary" href={href} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={13} aria-hidden />
    </a>
  );
}
