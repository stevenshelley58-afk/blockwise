"use client";

import { useEffect } from "react";

/** How often to revalidate while the reporting tables cannot push updates. */
const POLL_MS = 5 * 60 * 1000;

/**
 * Revalidates the reporting read model while the tab is visible.
 *
 * This used to open a Supabase Realtime channel and subscribe to
 * `postgres_changes` on `reporting_snapshots`. That channel could never
 * succeed: `product-realtime` is declared under the `realtime` compose profile
 * (`infra/coolify/docker-compose.product.yml`) and does not run in production,
 * so the edge answers the websocket path with 502. Every mount therefore built
 * a client, attempted a connection that could not work, and then fell back to
 * the same five-minute poll implemented here. The `SUBSCRIBED` branch was
 * unreachable in production, so this keeps the behaviour that actually ran and
 * removes a doomed connection attempt plus a `crypto.randomUUID()` channel name
 * from every dashboard mount.
 *
 * `BLOCKWISE_REALTIME_ENABLED` was set in the environment and read nowhere. If
 * realtime is ever started for real, reintroduce the subscription behind that
 * flag rather than unconditionally.
 */
export function useReportingInvalidation(input: {
  workspaceId: string;
  onInvalidate: () => void;
}): void {
  const { workspaceId, onInvalidate } = input;

  useEffect(() => {
    // workspaceId is part of the contract even though the poll does not filter
    // on it, so switching workspace still restarts the interval.
    void workspaceId;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") onInvalidate();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [onInvalidate, workspaceId]);
}
