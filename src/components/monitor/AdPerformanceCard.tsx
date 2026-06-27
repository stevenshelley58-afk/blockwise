import Link from "next/link";

import { ExternalLink, ImageOff, Play } from "lucide-react";

import { formatCurrency, formatPercent } from "@/lib/meta-monitor/calculations";
import type { MetaAdPerformance } from "@/lib/meta-monitor/types";

import { AdManagementControls } from "./AdManagementControls";
import { BreakdownBars } from "./BreakdownBars";
import { DeviceDonut } from "./DeviceDonut";

export function adCardDomId(adId: string): string {
  return `meta-ad-${adId}`;
}

export function AdPerformanceCard({ ad }: { ad: MetaAdPerformance }) {
  const metrics = ad.metrics;

  return (
    <article className="panel mm-ad-card" id={adCardDomId(ad.adId)}>
      <div className="mm-ad-head">
        <CreativePreview ad={ad} size={88} />
        <div className="mm-ad-head-text">
          <h4>
            {ad.adName}
            <StatusPill status={ad.status} />
            {ad.fatigued ? <span className="mm-pill amber">Fatiguing</span> : null}
          </h4>
          <span className="mm-ad-campaign">{ad.campaignName}</span>
          <span className="mm-ad-meta">
            Ad set: {ad.adsetName || "—"} · Suburb: {ad.suburb ?? "—"}
          </span>
          <span className="mm-ad-meta">ID: {ad.adId}</span>
        </div>
      </div>

      {ad.fatigued ? (
        <p className="mm-ad-meta" role="status">
          This creative is showing fatigue (high frequency, falling CTR).{" "}
          <Link href={`/ad-studio?from=fatigue&adId=${encodeURIComponent(ad.adId)}`}>
            Refresh it in Ad Studio
          </Link>
          .
        </p>
      ) : null}

      <dl className="mm-ad-metrics">
        <Metric label="Reach" value={metrics.reach.toLocaleString("en-AU")} />
        <Metric label="Spend" value={formatCurrency(metrics.spend)} />
        <Metric label="Impressions" value={metrics.impressions.toLocaleString("en-AU")} />
        <Metric label="Clicks" value={metrics.clicks.toLocaleString("en-AU")} />
        <Metric label="CTR" value={metrics.ctr != null ? formatPercent(metrics.ctr, 2) : "—"} />
        <Metric label="Leads" value={String(metrics.leads)} />
        <Metric label="Valid leads" value={String(metrics.validLeads)} />
        <Metric label="Valid rate" value={metrics.validRate != null ? formatPercent(metrics.validRate) : "—"} />
        <Metric label="Valid CPL" value={metrics.validCpl != null ? formatCurrency(metrics.validCpl) : "—"} />
      </dl>

      {(ad.placementBreakdown?.length ?? 0) > 0 || (ad.deviceBreakdown?.length ?? 0) > 0 ? (
        <div className="mm-ad-breakdowns">
          <BreakdownBars title="Placement" rows={ad.placementBreakdown ?? []} />
          <DeviceDonut rows={ad.deviceBreakdown ?? []} />
        </div>
      ) : null}

      <div className="mm-ad-actions">
        <AdManagementControls target={{ kind: "ad", adId: ad.adId }} status={ad.status} showExport />
        <ActionLink href={ad.landingPageUrl} label="Open landing page" />
        <ActionLink href={ad.metaPermalinkUrl} label="View in Meta" />
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
