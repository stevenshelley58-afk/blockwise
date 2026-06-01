import { ExternalLink } from "lucide-react";

import { StatusPill } from "@/components/status-pill";
import type { CustomerMetaAdLibraryCard, CustomerMetaAdLibraryMedia } from "@/lib/research/customer-meta-card";

export function MetaAdLibraryCard({ card }: { card: CustomerMetaAdLibraryCard }) {
  const hasLongBody = Boolean(card.body && card.body.length > 320);
  const visibleBody = hasLongBody && card.body ? `${card.body.slice(0, 300).trim()}...` : card.body;
  const dateText = deliveryDateText(card.startedAt, card.stoppedAt);

  return (
    <article className="meta-ad-card">
      <header className="meta-ad-card-header">
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
            <span>{card.libraryId ? `Library ID ${card.libraryId}` : "Library ID unavailable"}</span>
          </div>
        </div>
        <StatusPill tone={card.activeStatus === "active" ? "green" : card.activeStatus === "inactive" ? "amber" : "blue"}>
          {card.activeStatus === "inactive" ? "Inactive" : card.activeStatus === "active" ? "Active" : "Unknown"}
        </StatusPill>
      </header>

      <div className="meta-ad-card-meta">
        {dateText ? <span>{dateText}</span> : null}
        {card.platforms.map((platform) => (
          <span className="meta-ad-platform-chip" key={platform}>
            {platform}
          </span>
        ))}
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
              <a className="meta-ad-link-domain" href={card.destinationUrl} target="_blank" rel="noreferrer">
                {displayDomain(card.destinationUrl)}
              </a>
            ) : null}
            {card.headline ? <h3>{card.headline}</h3> : null}
            {card.description ? <p>{card.description}</p> : null}
          </div>
          {card.cta ? (
            card.destinationUrl ? (
              <a className="meta-ad-card-cta" href={card.destinationUrl} target="_blank" rel="noreferrer">
                {card.cta}
              </a>
            ) : (
              <span className="meta-ad-card-cta">{card.cta}</span>
            )
          ) : null}
        </div>
      ) : null}
    </article>
  );
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
  if (started && stopped) return `Started ${started} - stopped ${stopped}`;
  if (started) return `Started ${started}`;
  if (stopped) return `Stopped ${stopped}`;
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
