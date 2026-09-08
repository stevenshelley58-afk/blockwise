"use client";

import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";

type SafeImageProps = {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
  fallbackLabel?: string;
  compactFallback?: boolean;
};

/**
 * Image preview with a quiet, bounded fallback for expired or unavailable
 * media URLs. Keep the supplied alt text available as the fallback's
 * accessible label while avoiding a broken-image glyph and URL-sized alt
 * text escaping a card.
 */
export function SafeImage({
  src,
  alt,
  className = "",
  width,
  height,
  loading,
  decoding,
  fallbackLabel = "Preview unavailable",
  compactFallback = false,
}: SafeImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (failed) {
    const accessibleLabel = alt.trim() ? `${alt.trim()} unavailable` : fallbackLabel;
    return (
      <span
        className={`grid place-items-center bg-(--surface-subtle) px-3 text-center text-xs font-semibold text-muted-foreground ${className}`}
        role="img"
        aria-label={accessibleLabel}
      >
        <ImageOff className={compactFallback ? "size-4" : "mb-1 size-4"} aria-hidden />
        <span className={compactFallback ? "sr-only" : undefined}>{fallbackLabel}</span>
      </span>
    );
  }

  return (
    // Meta and workspace media URLs may be short-lived signed links; use the
    // native image element so their dimensions and auth behaviour are intact.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding={decoding}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
