import { ExternalLink } from "lucide-react";

import { AdCardActions } from "@/components/research/ad-card-actions";
import {
  type CustomerMetaAdLibraryCard,
  type CustomerMetaAdLibraryMedia,
} from "@/lib/research/customer-meta-card";

export function MetaAdLibraryCard({ card }: { card: CustomerMetaAdLibraryCard }) {
  const hasLongBody = Boolean(card.body && card.body.length > 320);
  const visibleBody = hasLongBody && card.body ? `${card.body.slice(0, 300).trim()}...` : card.body;
  const dateText = deliveryDateText(card.startedAt, card.stoppedAt);
  const statusLabel =
    card.activeStatus === "inactive" ? "Inactive" : card.activeStatus === "active" ? "Active" : "Unknown";

  return (
    <article className="meta-ad-card">
      <header className="meta-ad-headblock">
        <span className="meta-ad-status" data-status={card.activeStatus}>
          <span className="meta-ad-status-dot" aria-hidden />
          <span className="meta-ad-status-label">{statusLabel}</span>
        </span>
        <span className="meta-ad-headmeta">
          {card.libraryId ? `Library ID: ${card.libraryId}` : "Library ID unavailable"}
        </span>
        {dateText ? <span className="meta-ad-headmeta">{dateText}</span> : null}
        {card.platforms.length > 0 ? (
          <div className="meta-ad-platforms">
            <span>Platforms</span>
            <span className="meta-ad-platform-icons">
              {card.platforms.map((platform) => (
                <PlatformIcon key={platform} platform={platform} />
              ))}
            </span>
          </div>
        ) : null}
      </header>

      <div className="meta-ad-page">
        <PageAvatar card={card} />
        <div className="meta-ad-page-copy">
          {card.pageUrl ? (
            <a href={card.pageUrl} target="_blank" rel="noreferrer">
              {card.pageName} <ExternalLink size={12} />
            </a>
          ) : (
            <strong>{card.pageName}</strong>
          )}
          <span className="meta-ad-sponsored">Sponsored</span>
        </div>
      </div>

      {card.body ? (
        <div className="meta-ad-card-body">
          {hasLongBody ? (
            <details className="meta-ad-copy-details">
              <summary>
                <span className="meta-ad-copy-preview">{visibleBody}</span>
                <span className="meta-ad-copy-toggle">
                  <span className="meta-ad-copy-toggle-closed">See more</span>
                  <span className="meta-ad-copy-toggle-open">See less</span>
                </span>
              </summary>
              <p>{card.body}</p>
            </details>
          ) : (
            <p className="meta-ad-primary-text">{visibleBody}</p>
          )}
        </div>
      ) : null}

      <MediaPanel card={card} />

      {card.headline || card.description || card.cta || card.destinationUrl ? (
        <div className="meta-ad-link-preview">
          <div className="meta-ad-link-copy">
            {card.destinationUrl ? (
              <a
                className="meta-ad-link-domain meta-ad-destination-link"
                href={card.destinationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {displayDomain(card.destinationUrl)}
              </a>
            ) : null}
            {card.headline ? <h3>{card.headline}</h3> : null}
            {card.description ? <p>{card.description}</p> : null}
          </div>
          {card.cta ? (
            card.destinationUrl ? (
              <a
                className="meta-ad-card-cta meta-ad-destination-link"
                href={card.destinationUrl}
                target="_blank"
                rel="noreferrer"
              >
                {card.cta}
              </a>
            ) : (
              <span className="meta-ad-card-cta">{card.cta}</span>
            )
          ) : null}
        </div>
      ) : null}

      <AdCardActions observedAdId={card.id} libraryId={card.libraryId} />
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

  return <span className="meta-ad-platform-chip">{platform}</span>;
}

function PageAvatar({ card }: { card: CustomerMetaAdLibraryCard }) {
  if (card.pageImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="meta-ad-page-avatar" src={card.pageImageUrl} alt="" loading="lazy" />
    );
  }

  return <span className="meta-ad-page-avatar fallback">{card.pageName.slice(0, 1).toUpperCase()}</span>;
}

function MediaPanel({ card }: { card: CustomerMetaAdLibraryCard }) {
  if (card.media.length === 0) {
    return (
      <div className="meta-ad-text-only">
        <span>Text-only ad</span>
      </div>
    );
  }

  if (card.media.length === 1) {
    return (
      <div className="meta-ad-media-frame meta-ad-media-frame--single">
        <MediaAsset media={card.media[0]} label={card.headline ?? card.pageName} />
      </div>
    );
  }

  return (
    <div className="meta-ad-carousel" aria-label={`${card.media.length} ad media items`}>
      {card.media.map((media, index) => (
        <figure className="meta-ad-carousel-item" key={media.id}>
          <div className="meta-ad-media-frame">
            <MediaAsset media={media} label={`${card.headline ?? card.pageName} ${index + 1}`} />
          </div>
          <figcaption>
            {index + 1} of {card.media.length}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function MediaAsset({ media, label }: { media: CustomerMetaAdLibraryMedia; label: string }) {
  if (media.kind === "video") {
    return (
      <video
        className="meta-ad-media"
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
    <img className="meta-ad-media" src={media.url} alt={label} loading="lazy" />
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

function displayDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "Destination";
  }
}
