import { ExternalLink } from "lucide-react";

import { AdCardActions } from "@/components/research/ad-card-actions";
import {
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryMedia,
} from "@/lib/research/customer-meta-card";

/*
 * Ad Radar result card, rebuilt on the Premium v2 token bridge. The legacy
 * `.meta-ad-*` rules in globals.css are unlayered, so any left on this element
 * would beat every Tailwind utility applied to it — the card is now fully
 * self-contained. Layout, density, and the mobile behaviour of the original
 * rules are preserved; only the register (radius, elevation, type scale,
 * status tokens) moves to Premium v2.
 *
 * The 640px breakpoint below mirrors the legacy `@media (max-width: 640px)`
 * block: base classes are the mobile treatment, `sm:` restores desktop.
 */
const headMetaClass = "text-[11.5px] leading-[1.4] text-muted-foreground [overflow-wrap:anywhere]";
const gutterClass = "px-3 sm:px-3.5";
const bodyTextClass = "text-[13.5px] leading-[1.55] whitespace-pre-wrap text-foreground";
const pageNameClass =
  "inline-flex w-fit min-w-0 items-center gap-1 text-[13.5px] leading-[1.3] font-extrabold text-foreground [overflow-wrap:anywhere]";
const ctaClass =
  "inline-flex min-h-11 w-full flex-none items-center justify-center rounded-full border border-(--line-heavy) bg-(--surface) px-3.5 text-[12.5px] font-bold whitespace-nowrap text-foreground sm:min-h-9 sm:w-auto";

/** Status dot + label tokens. Semantic colour communicates state only. */
export const STATUS_TONE: Record<string, { dot: string; label: string }> = {
  active: { dot: "bg-success", label: "text-success" },
  inactive: { dot: "bg-warning", label: "text-warning" },
};
export const STATUS_TONE_UNKNOWN = { dot: "bg-(--faint)", label: "text-muted-foreground" };

export function MetaAdLibraryCard({ card }: { card: CustomerMetaAdLibraryCard }) {
  const hasLongBody = Boolean(card.body && card.body.length > 320);
  const visibleBody = hasLongBody && card.body ? `${card.body.slice(0, 300).trim()}...` : card.body;
  const dateText = deliveryDateText(card.startedAt, card.stoppedAt);
  const statusLabel =
    card.activeStatus === "inactive" ? "Inactive" : card.activeStatus === "active" ? "Active" : "Unknown";
  const statusTone = STATUS_TONE[card.activeStatus] ?? STATUS_TONE_UNKNOWN;

  return (
    <article className="grid w-full min-w-0 overflow-hidden rounded-(--r-card) border border-(--line) bg-(--surface) shadow-card">
      <header className={`grid gap-[3px] pt-[13px] pb-1 ${gutterClass}`}>
        <span className="mb-px inline-flex w-fit items-center gap-1.5" data-status={card.activeStatus}>
          <span className={`size-2 rounded-full ${statusTone.dot}`} aria-hidden />
          <span className={`text-[12.5px] font-bold ${statusTone.label}`}>{statusLabel}</span>
        </span>
        <span className={headMetaClass}>
          {card.libraryId ? `Library ID: ${card.libraryId}` : "Library ID unavailable"}
        </span>
        {dateText ? <span className={headMetaClass}>{dateText}</span> : null}
        {card.platforms.length > 0 ? (
          <div className="mt-1 flex items-center gap-2 text-[11.5px] font-semibold text-muted-foreground">
            <span>Platforms</span>
            <span className="inline-flex items-center gap-[7px] text-muted-foreground">
              {card.platforms.map((platform) => (
                <PlatformIcon key={platform} platform={platform} />
              ))}
            </span>
          </div>
        ) : null}
      </header>

      <div className={`flex min-w-0 items-center gap-2.5 pt-1.5 pb-3 ${gutterClass}`}>
        <PageAvatar card={card} />
        <div className="grid min-w-0 gap-[3px]">
          {card.pageUrl ? (
            <a
              className={`${pageNameClass} -my-1 py-1 hover:underline`}
              href={card.pageUrl}
              target="_blank"
              rel="noreferrer"
            >
              {card.pageName} <ExternalLink size={12} aria-hidden />
            </a>
          ) : (
            <strong className={pageNameClass}>{card.pageName}</strong>
          )}
          <span className="text-[11.5px] font-semibold text-(--faint)">Sponsored</span>
        </div>
      </div>

      {card.body ? (
        <div className={`grid gap-3 border-t border-(--line) py-3.5 ${gutterClass}`}>
          {hasLongBody ? (
            <details className="group">
              <summary className="grid cursor-pointer list-none gap-1 [&::-webkit-details-marker]:hidden">
                <span className={`${bodyTextClass} group-open:hidden`}>{visibleBody}</span>
                <span className="inline-flex min-h-11 w-fit items-center text-[12.5px] font-bold text-foreground underline-offset-2 hover:underline">
                  <span className="group-open:hidden">See more</span>
                  <span className="hidden group-open:inline">See less</span>
                </span>
              </summary>
              <p className={bodyTextClass}>{card.body}</p>
            </details>
          ) : (
            <p className={bodyTextClass}>{visibleBody}</p>
          )}
        </div>
      ) : null}

      <MediaPanel card={card} />

      {card.headline || card.description || card.cta || card.destinationUrl ? (
        <div
          className={`flex flex-wrap items-stretch justify-between gap-3 border-t border-(--line) bg-(--surface-subtle) py-3 sm:items-center ${gutterClass}`}
        >
          <div className="grid min-w-0 gap-[3px]">
            {card.destinationUrl ? (
              <a
                className="-my-1 w-fit py-1 font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase hover:text-muted-foreground hover:underline"
                href={card.destinationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {displayDomain(card.destinationUrl)}
              </a>
            ) : null}
            {card.headline ? (
              <h3 className="text-[14px] leading-[1.35] font-bold text-foreground">{card.headline}</h3>
            ) : null}
            {card.description ? (
              <p className="text-[12.5px] leading-[1.45] text-muted-foreground">{card.description}</p>
            ) : null}
          </div>
          {card.cta ? (
            card.destinationUrl ? (
              <a
                className={`${ctaClass} transition-[background,box-shadow] duration-150 hover:bg-(--surface-subtle) hover:shadow-card`}
                href={card.destinationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {card.cta}
              </a>
            ) : (
              <span className={ctaClass}>{card.cta}</span>
            )
          ) : null}
        </div>
      ) : null}

      <div className={`border-t border-(--line) py-3 ${gutterClass}`}>
        <AdCardActions observedAdId={card.id} libraryId={card.libraryId} />
      </div>
    </article>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  const key = platform.toLowerCase();

  if (key === "facebook") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={platform}>
        <title>{platform}</title>
        <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.69 4.54-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
      </svg>
    );
  }

  if (key === "instagram") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} role="img" aria-label={platform}>
        <title>{platform}</title>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5" />
        <circle cx="12" cy="12" r="4.4" />
        <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (key === "messenger") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={platform}>
        <title>{platform}</title>
        <path d="M12 0C5.24 0 0 4.95 0 11.64c0 3.5 1.43 6.52 3.77 8.6.2.18.32.43.32.7l.06 2.15c.02.69.72 1.13 1.35.85l2.4-1.06c.2-.09.43-.11.65-.05 1.1.3 2.26.46 3.45.46 6.76 0 12-4.95 12-11.64S18.76 0 12 0zm7.2 8.93l-3.52 5.6c-.56.88-1.76 1.1-2.6.48l-2.8-2.1a.72.72 0 00-.86 0l-3.78 2.87c-.5.38-1.16-.22-.82-.75l3.52-5.6c.56-.88 1.76-1.1 2.6-.48l2.8 2.1c.26.19.6.19.86 0l3.78-2.86c.5-.39 1.16.2.82.73z" />
      </svg>
    );
  }

  if (key === "audience network") {
    return (
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} role="img" aria-label={platform}>
        <title>{platform}</title>
        <circle cx="12" cy="12" r="9.3" />
        <path d="M2.7 12h18.6M12 2.7c2.7 2.9 2.7 15.7 0 18.6M12 2.7c-2.7 2.9-2.7 15.7 0 18.6" />
      </svg>
    );
  }

  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-(--line) bg-(--surface-subtle) px-2 text-[10.5px] font-bold text-foreground">
      {platform}
    </span>
  );
}

function PageAvatar({ card }: { card: CustomerMetaAdLibraryCard }) {
  const avatarClass = "size-[42px] flex-none rounded-full border border-(--line) bg-(--surface-subtle)";

  if (card.pageImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`${avatarClass} object-cover`} src={card.pageImageUrl} alt="" loading="lazy" />
    );
  }

  return (
    <span className={`${avatarClass} grid place-items-center text-[13.5px] font-extrabold text-foreground`}>
      {card.pageName.slice(0, 1).toUpperCase()}
    </span>
  );
}

function MediaPanel({ card }: { card: CustomerMetaAdLibraryCard }) {
  if (card.media.length === 0) {
    return (
      <div className="grid min-h-[180px] place-items-center border-t border-(--line) bg-(--surface-subtle) p-4 text-center">
        <span className="text-[12.5px] font-bold text-muted-foreground">Text-only ad</span>
      </div>
    );
  }

  if (card.media.length === 1) {
    return (
      <div className="max-w-full overflow-hidden bg-(--surface)">
        <MediaAsset
          media={card.media[0]}
          label={card.headline ?? card.pageName}
          className="block h-auto w-full max-w-full max-h-[min(72svh,520px)] bg-(--surface-subtle) object-contain sm:max-h-none"
        />
      </div>
    );
  }

  return (
    <div
      className="grid snap-x snap-mandatory grid-flow-col gap-3 overflow-x-auto px-3 pb-3 [grid-auto-columns:minmax(236px,88%)] sm:px-3.5 sm:pb-3.5 sm:[grid-auto-columns:minmax(260px,82%)]"
      aria-label={`${card.media.length} ad media items`}
    >
      {card.media.map((media, index) => (
        <figure className="m-0 grid snap-start gap-1.5" key={media.id}>
          <div className="aspect-square max-w-full overflow-hidden rounded-(--r-ctl) border border-(--line) bg-(--surface-subtle)">
            <MediaAsset
              media={media}
              label={`${card.headline ?? card.pageName} ${index + 1}`}
              className="block h-full w-full max-w-full object-cover"
            />
          </div>
          <figcaption className="text-center text-[11.5px] font-semibold text-muted-foreground">
            {index + 1} of {card.media.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function MediaAsset({
  media,
  label,
  className,
}: {
  media: CustomerMetaAdLibraryMedia;
  label: string;
  className: string;
}) {
  if (media.kind === "video") {
    return (
      <video
        className={className}
        src={media.url}
        poster={media.posterUrl ?? undefined}
        aria-label={label}
        controls
        preload="metadata"
        playsInline
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={media.url} alt={label} loading="lazy" />
  );
}

function deliveryDateText(startedAt: string | null, stoppedAt: string | null): string | null {
  const started = formatDate(startedAt);
  const stopped = formatDate(stoppedAt);

  if (started && stopped) return `Started running on ${started} · Stopped ${stopped}`;
  if (started) return `Started running on ${started}`;
  if (stopped) return `Stopped running on ${stopped}`;
  return null;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function displayDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "Destination";
  }
}
