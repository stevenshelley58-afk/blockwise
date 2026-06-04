"use client";

import { Bookmark, ExternalLink, FileSearch, Images } from "lucide-react";
import { useState } from "react";

type ActionStatus = "idle" | "saving" | "saved" | "sending" | "sent" | "error";

export function AdCardActions({
  observedAdId,
  libraryId,
}: {
  observedAdId: string;
  libraryId: string | null;
}) {
  const [savedId, setSavedId] = useState<string | null>(null);
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
      setSavedId(body.savedAd.id);
      setStatus("saved");
      return body.savedAd.id as string;
    } catch {
      setStatus("error");
      return null;
    }
  }

  async function sendToAdStudio() {
    const id = savedId ?? (await saveAd());
    if (!id) return;
    setStatus("sending");
    try {
      const response = await fetch(`/api/research/swipe-file/${id}/send-to-adstudio`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not send ad to Ad Studio.");
      setStatus("sent");
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
        <a className="button secondary" href={`/research/ads/${observedAdId}`}>
          <FileSearch size={14} /> Details
        </a>
      ) : null}
      <button className="button secondary" type="button" onClick={saveAd} disabled={!canSave || status === "saving"}>
        <Bookmark size={14} /> {status === "saved" || status === "sent" ? "Saved" : "Save"}
      </button>
      <button className="button secondary" type="button" onClick={sendToAdStudio} disabled={!canSave || status === "saving" || status === "sending"}>
        <Images size={14} /> {status === "sent" ? "Sent" : "Use"}
      </button>
      <span className={`meta-ad-action-status ${status}`}>
        {status === "saving"
          ? "Saving"
          : status === "sending"
            ? "Sending"
            : status === "sent"
              ? "Ready in Ad Studio"
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
