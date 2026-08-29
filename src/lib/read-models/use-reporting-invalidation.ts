"use client";

import { useEffect } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const DISCONNECTED_FALLBACK_MS = 5 * 60 * 1000;

export function useReportingInvalidation(input: {
  workspaceId: string;
  onInvalidate: () => void;
}): void {
  const { workspaceId, onInvalidate } = input;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const startFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(() => {
        if (document.visibilityState === "visible") onInvalidate();
      }, DISCONNECTED_FALLBACK_MS);
    };

    const channel = supabase
      .channel(`reporting-snapshots:${workspaceId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reporting_snapshots",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => onInvalidate(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          stopFallback();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startFallback();
        }
      });

    return () => {
      stopFallback();
      void supabase.removeChannel(channel);
    };
  }, [onInvalidate, workspaceId]);
}
