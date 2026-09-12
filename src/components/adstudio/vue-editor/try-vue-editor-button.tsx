"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function TryVueEditorButton({ adId, workspaceId, automatic = false }: { adId: string; workspaceId: string; automatic?: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const [busy, setBusy] = useState(automatic);
  const [error, setError] = useState<string | null>(null);
  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/adstudio/ads/" + encodeURIComponent(adId) + "/vue-copy?workspaceId=" + encodeURIComponent(workspaceId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json().catch(() => ({})) as { ad?: { adId?: string }; error?: string };
      if (!response.ok || !body.ad?.adId) throw new Error(body.error ?? "Your ad could not be opened. Try again.");
      router.replace("/ad-studio/ads/" + encodeURIComponent(body.ad.adId) + "/canvas");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your ad could not be opened. Try again.");
      setBusy(false);
    }
  }, [adId, workspaceId, router]);

  useEffect(() => {
    if (automatic && !started.current) {
      started.current = true;
      void begin();
    }
  }, [automatic, begin]);

  if (automatic) return <div className="grid min-h-64 place-items-center p-6">
    <div className="space-y-4 text-center">
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p role="status" className="text-sm text-muted-foreground">Opening your ad…</p>}
      {error && <div className="flex items-center justify-center gap-3">
        <Button disabled={busy} onClick={() => void begin()}>{busy ? "Opening…" : "Try again"}</Button>
        <Button variant="ghost" asChild><Link href="/ad-studio/ads">Back to ads</Link></Button>
      </div>}
    </div>
  </div>;

  return <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 md:px-4">
    <div className="min-w-0">
      <p className="text-xs font-semibold">Previous editor</p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
    <Button variant="outline" size="sm" disabled={busy} onClick={() => {
      if (window.confirm("Open the current editor? Only saved changes are carried across.")) void begin();
    }}>{busy ? "Opening…" : "Open current editor"}</Button>
  </div>;
}
