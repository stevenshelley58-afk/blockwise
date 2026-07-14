"use client";

import { Bookmark, ExternalLink, FileSearch } from "lucide-react";
import { useState } from "react";

type ActionStatus = "idle" | "saving" | "saved" | "error";

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
    <div className="meta-ad-card-actions">
      {sourceUrl ? (
        <a className="button secondary" href={sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Source
        </a>
      ) : null}
      {canSave ? (
        <a className="button secondary" href={`/ad-radar/ads/${observedAdId}`}>
          <FileSearch size={14} /> Details
        </a>
      ) : null}
      <button className="button secondary" type="button" onClick={saveAd} disabled={!canSave || status === "saving"}>
        <Bookmark size={14} /> {status === "saved" ? "Saved" : "Save"}
      </button>
      <span className={`meta-ad-action-status ${status}`}>
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
