"use client";

import { Bookmark, ExternalLink, FileSearch } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type ActionStatus = "idle" | "saving" | "saved" | "error";

/*
 * Ad card action row. Rebuilt on the shadcn Button + Premium v2 tokens — the
 * legacy `.button secondary` / `.meta-ad-card-actions` rules live in the
 * unlayered globals.css and would beat every utility applied here. The row
 * itself carries no border or padding: each host surface (result card, swipe
 * file, advertiser profile, ad detail) supplies its own frame, which is what
 * the legacy `.swipe-file-actions` / `.research-detail-copy` overrides did.
 *
 * Two columns at ≤640px with 44px targets, an inline wrap above it — matching
 * the legacy responsive behaviour.
 */
const actionClass =
  "min-h-11 w-full border-(--line-heavy) bg-(--surface) text-[12.5px] font-bold shadow-none hover:bg-(--surface-subtle) hover:text-foreground hover:shadow-card sm:min-h-9 sm:w-auto";

export function AdCardActions({
  observedAdId,
  libraryId,
}: {
  observedAdId: string;
  libraryId: string | null;
}) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const sourceUrl = libraryId ? `https://www.facebook.com/ads/library/?id=${encodeURIComponent(libraryId)}` : null;
  const canSave = isUuid(observedAdId);

  async function saveAd() {
    if (!canSave) return;
    setStatus("saving");
    try {
      const response = await fetch("/api/research/swipe-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observedAdId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save ad.");
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
      {sourceUrl ? (
        <Button variant="outline" size="sm" className={actionClass} asChild>
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> Source
          </a>
        </Button>
      ) : null}
      {canSave ? (
        <Button variant="outline" size="sm" className={actionClass} asChild>
          <a href={`/ad-radar/ads/${observedAdId}`}>
            <FileSearch size={14} aria-hidden /> Details
          </a>
        </Button>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className={actionClass}
        type="button"
        onClick={saveAd}
        disabled={!canSave || status === "saving"}
      >
        <Bookmark size={14} aria-hidden /> {status === "saved" ? "Saved" : "Save"}
      </Button>
      <span
        className={`col-span-2 min-h-[18px] text-[11.5px] font-semibold sm:col-auto ${
          status === "error" ? "text-error" : "text-muted-foreground"
        }`}
      >
        {status === "saving"
          ? "Saving"
          : status === "error"
            ? "Action failed"
            : !canSave
              ? "Unavailable"
              : ""}
      </span>
    </div>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
