"use client";

import { Download, FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import { artworkFileName } from "@/lib/adbuilder/download-pack";

// ---------------------------------------------------------------------------
// The no-card download pack, as a customer sees it.
//
// Every link here is served by a route that requires workspace access alone.
// No card, no subscription, no Meta connection. That is the point of the pack:
// a customer can always take what they made and run it themselves.
// ---------------------------------------------------------------------------

export type DownloadAdPackProps = {
  adId: string;
  workspaceId: string;
  adName: string;
  feedPath: string | null;
  storyPath: string | null;
  /** "inline" is the compact library row; "panel" is the publish review block. */
  variant?: "inline" | "panel";
  className?: string;
};

export function DownloadAdPack({
  adId,
  workspaceId,
  adName,
  feedPath,
  storyPath,
  variant = "inline",
  className,
}: DownloadAdPackProps) {
  const items = [
    ...(feedPath
      ? [{ key: "feed", label: "Feed", href: mediaHref(workspaceId, feedPath, artworkFileName(adName, "feed")) }]
      : []),
    ...(storyPath
      ? [{ key: "story", label: "Story", href: mediaHref(workspaceId, storyPath, artworkFileName(adName, "story")) }]
      : []),
    { key: "copy", label: variant === "panel" ? "Ad copy and headline (.txt)" : "Copy", href: copyHref(workspaceId, adId) },
  ];

  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        {items.map(item => (
          <a
            key={item.key}
            href={item.href}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-2 text-xs font-semibold text-muted-foreground hover:bg-(--surface-subtle) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Download ${adName} ${item.label}`}
          >
            {item.key === "copy" ? (
              <FileText className="mr-1 size-4" aria-hidden />
            ) : (
              <Download className="mr-1 size-4" aria-hidden />
            )}
            {item.label}
          </a>
        ))}
      </div>
    );
  }

  return (
    <section className={cn("rounded-(--r-ctl) border border-border bg-muted/40 p-4", className)} aria-label="Download your ad">
      <h2 className="font-semibold">Download your ad instead</h2>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Take the finished artwork and copy into your own Meta ad account. This needs no card and no Blockwise
        subscription, and Meta charges any ad spend to your own payment method.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map(item => (
          <a
            key={item.key}
            href={item.href}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-(--surface) px-3 text-sm font-semibold hover:bg-(--surface-subtle) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.key === "copy" ? (
              <FileText className="size-4" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}
            {item.label}
          </a>
        ))}
      </div>
    </section>
  );
}

function mediaHref(workspaceId: string, path: string, filename: string): string {
  return `/api/adbuilder/media?workspaceId=${encodeURIComponent(workspaceId)}&path=${encodeURIComponent(path)}&download=1&filename=${encodeURIComponent(filename)}`;
}

function copyHref(workspaceId: string, adId: string): string {
  return `/api/adbuilder/ads/${encodeURIComponent(adId)}/copy?workspaceId=${encodeURIComponent(workspaceId)}`;
}
