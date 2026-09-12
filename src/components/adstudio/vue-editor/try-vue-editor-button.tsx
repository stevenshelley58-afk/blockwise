"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TryVueEditorButton({ adId, workspaceId }: { adId: string; workspaceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    if (!window.confirm("The trial uses the last saved version of this ad. Unsaved changes will not be copied. Continue?")) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/adstudio/ads/${encodeURIComponent(adId)}/vue-copy?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => ({})) as { ad?: { adId?: string }; error?: string };
      if (!response.ok || !body.ad?.adId) throw new Error(body.error ?? "The new editor trial could not be started.");
      router.push(`/ad-studio/ads/${encodeURIComponent(body.ad.adId)}/canvas`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The new editor trial could not be started.");
      setBusy(false);
    }
  };

  return <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 md:px-4">
    <div className="min-w-0">
      <p className="truncate text-xs font-semibold">New editor trial</p>
      {error ? <p role="alert" className="truncate text-[11px] text-destructive">{error}</p> : <p className="hidden truncate text-[11px] text-muted-foreground sm:block">Uses your last saved version. The original stays unchanged.</p>}
    </div>
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void begin()}>
      <Sparkles className="size-3.5" aria-hidden="true" />
      {busy ? "Creating copy…" : "Try new editor"}
    </Button>
  </div>;
}
