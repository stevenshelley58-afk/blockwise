import { ExternalLink, ImageOff, Play } from "lucide-react";

import { formatCurrency, safeCpl } from "@/lib/meta-monitor/calculations";
import type { MetaAdPerformance } from "@/lib/meta-monitor/types";

import { AdManagementControls } from "./AdManagementControls";

export function adCardDomId(adId: string): string {
  return `meta-ad-${adId}`;
}

export function AdPerformanceCard({ ad }: { ad: MetaAdPerformance }) {
  const metrics = ad.metrics;
  const costPerLead = safeCpl(metrics.spend, metrics.leads);
  const leadSource = leadSourceLabel(ad);
  const leadContext = leadContextLabel(ad);

  return (
    <article
      className="flex flex-col overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface) shadow-card"
      id={adCardDomId(ad.adId)}
    >
      <div className="relative">
        <CreativePreview ad={ad} variant="banner" />
        <span className="absolute top-2.5 left-2.5">
          <StatusPill status={ad.status} onImage />
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="min-w-0">
          <h4 className="truncate text-[13.5px] font-bold" title={leadSource}>
            {leadSource}
          </h4>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground" title={leadContext}>
            {leadContext}
          </span>
        </div>

        <p className="mt-3 flex items-baseline gap-1">
          <strong className="font-display text-[24px] font-extrabold tracking-[-0.02em] tabular-nums">
            {costPerLead != null ? formatCurrency(costPerLead) : "-"}
          </strong>
          <span className="text-[12px] font-medium text-muted-foreground">/ lead</span>
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-2.5 border-t border-(--line) pt-3">
          <div>
            <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Leads</dt>
            <dd className="mt-0.5 text-[13px] font-bold tabular-nums">{metrics.leads}</dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Spend</dt>
            <dd className="mt-0.5 text-[13px] font-bold tabular-nums">{formatCurrency(metrics.spend)}</dd>
          </div>
        </dl>

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5 pt-0.5">
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
  const baseClass = isBanner
    ? "relative block aspect-[2/1] w-full overflow-hidden bg-(--surface-subtle)"
    : "relative block overflow-hidden rounded-lg bg-(--surface-subtle)";

  if (src) {
    return (
      <span className={baseClass} style={style}>
        {/* Meta CDN thumbnails are short-lived signed URLs; next/image optimization would break them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${ad.adName} creative`} loading="lazy" className="h-full w-full object-cover" />
        {ad.creative.type === "VIDEO" ? (
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-7 place-items-center rounded-full bg-(--ink)/70 text-white backdrop-blur-sm">
              <Play size={isBanner ? 14 : 11} aria-hidden />
            </span>
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className={`${baseClass} grid place-items-center`} style={style}>
      <span className="grid place-items-center gap-1 text-(--faint)">
        <ImageOff size={isBanner ? 22 : Math.max(14, size / 5)} aria-hidden />
        <small className="text-[10px] font-semibold">No preview</small>
      </span>
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
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  const tone =
    status === "ACTIVE"
      ? "bg-success-soft text-success"
      : status === "PAUSED"
        ? "bg-warning-soft text-warning"
        : "bg-(--surface-subtle) text-muted-foreground";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
        onImage ? "bg-(--ink)/80 text-white backdrop-blur-sm" : tone
      }`}
    >
      {label}
    </span>
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

function ActionLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <span
        className="inline-flex h-7 items-center rounded-full border border-(--line) px-2.5 text-[11px] font-bold text-(--faint)"
        aria-disabled
      >
        {label}
      </span>
    );
  }

  return (
    <a
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border border-(--line) bg-(--surface) px-2.5 text-[11px] font-bold transition-[background,border-color] duration-150 hover:border-(--line-heavy) hover:bg-(--surface-subtle)"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {label}
      <ExternalLink size={11} aria-hidden />
    </a>
  );
}
