"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type SyncResult = {
  ok?: boolean;
  inserted: number;
  fetched: number;
  duplicate: number;
  reason?: string;
  error?: string;
};

export function LeadSyncButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSync() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/leads/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const result = (await response.json()) as SyncResult;
      if (!response.ok || result.error) {
        setError(result.error ?? "Sync failed. Try again in a moment.");
        return;
      }
      if (result.reason === "no_published_plan") {
        setMessage("No published campaign with a lead form yet — publish one in Ad Studio first.");
        return;
      }
      setMessage(
        result.inserted > 0
          ? `${result.inserted} new lead${result.inserted === 1 ? "" : "s"} (${result.fetched} fetched, ${result.duplicate} duplicates skipped).`
          : "Synced — no new leads since last check.",
      );
      router.refresh();
    } catch {
      setError("Network error. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" onClick={onSync} disabled={busy} aria-busy={busy}>
        <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" />
        {busy ? "Syncing…" : "Sync leads"}
      </Button>
      {(message ?? error) && (
        <p className={`text-xs${error ? " text-destructive" : " text-muted-foreground"}`} role="status">
          {message ?? error}
        </p>
      )}
    </div>
  );
}
