import { ExternalLink, ImageOff, Play } from "lucide-react";

import { formatCurrency, safeCpl } from "@/lib/meta-monitor/calculations";
import type { MetaAdPerformance } from "@/lib/meta-monitor/types";

import { AdManagementControls } from "./AdManagementControls";
import "./AdPerformanceCard.css";

export function adCardDomId(adId: string): string {
  return `meta-ad-${adId}`;
}

export function AdPerformanceCard({ ad }: { ad: MetaAdPerformance }) {
  const metrics = ad.metrics;
  const costPerLead = safeCpl(metrics.spend, metrics.leads);
  const leadSource = leadSourceLabel(ad);
  const leadContext = leadContextLabel(ad);

  return (
    <article className="panel mm-tile" id={adCardDomId(ad.adId)}>
      <div className="mm-tile-media">
        <CreativePreview ad={ad} variant="banner" />
        <StatusPill status={ad.status} onImage />
      </div>

      <div className="mm-tile-body">
        <div className="mm-tile-head">
          <h4 className="mm-tile-name" title={leadSource}>{leadSource}</h4>
          <span className="mm-tile-context" title={leadContext}>{leadContext}</span>
        </div>

        <p className="mm-tile-cost">
          <strong>{costPerLead != null ? formatCurrency(costPerLead) : "-"}</strong>
          <span>/ lead</span>
        </p>

        <dl className="mm-tile-stats">
          <div className="mm-tile-stat">
            <dt>Leads</dt>
            <dd>{metrics.leads}</dd>
          </div>
          <div className="mm-tile-stat">
            <dt>Spend</dt>
            <dd>{formatCurrency(metrics.spend)}</dd>
          </div>
        </dl>

        <div className="mm-tile-actions">
          <ActionLink href={ad.landingPageUrl} label="Open page" />
          <AdManagementControls target={{ kind: "ad", adId: ad.adId }} status={ad.status} />
        </div>
      </div>
    </article>
  );
}

export function CreativePreview({
  ad,
  size = 58,
  variant = "square",
}: {
  ad: MetaAdPerformance;
  size?: number;
  variant?: "square" | "banner";
}) {
  const src = ad.creative.thumbnailUrl ?? ad.creative.imageUrl ?? ad.creative.videoThumbnailUrl;
  const isBanner = variant === "banner";
  const style = isBanner ? undefined : { width: size, height: size };
  const baseClass = isBanner ? "mm-creative mm-creative-banner" : "mm-creative";

  if (src) {
    return (
      <span className={baseClass} style={style}>
        {/* Meta CDN thumbnails are short-lived signed URLs; next/image optimization would break them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${ad.adName} creative`} loading="lazy" />
        {ad.creative.type === "VIDEO" ? (
          <span className="mm-creative-play">
            <Play size={isBanner ? 16 : 12} aria-hidden />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className={`${baseClass} mm-creative-placeholder`} style={style}>
      <ImageOff size={isBanner ? 22 : Math.max(14, size / 5)} aria-hidden />
      <small>No preview</small>
    </span>
  );
}

export function StatusPill({
  status,
  onImage = false,
}: {
  status: MetaAdPerformance["status"];
  onImage?: boolean;
}) {
  const tone = status === "ACTIVE" ? "green" : status === "PAUSED" ? "amber" : "neutral";
  const label = status.charAt(0) + status.slice(1).toLowerCase();

  return <span className={`mm-pill ${tone}${onImage ? " onimg" : ""}`}>{label}</span>;
}

function leadSourceLabel(ad: MetaAdPerformance): string {
  if (ad.suburb) return `${ad.suburb} lead source`;
  return ad.campaignName || ad.adName;
}

function leadContextLabel(ad: MetaAdPerformance): string {
  if (ad.suburb && ad.campaignName) return ad.campaignName;
  return ad.adsetName || ad.adName;
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
