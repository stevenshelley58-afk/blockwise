"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export type TrialStatus = {
  isTrial: boolean;
  includedAdPacks: number;
  usedAdPacks: number;
  remainingAdPacks: number;
  planName: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  trialExpired: boolean;
  upgradeHref: string;
};

export function TrialStatusPill({ initialStatus }: { initialStatus: TrialStatus | null }) {
  const [status, setStatus] = useState<TrialStatus | null>(initialStatus);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/trial/status", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as { trial?: TrialStatus | null };
      if (response.ok) {
        setStatus(payload.trial ?? null);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    function handleRefresh() {
      void refresh();
    }

    window.addEventListener("blockwise:trial-status-refresh", handleRefresh);
    return () => window.removeEventListener("blockwise:trial-status-refresh", handleRefresh);
  }, [refresh]);

  if (!status?.isTrial) return null;

  const used = Math.max(0, status.usedAdPacks);
  const included = Math.max(1, status.includedAdPacks);
  const remaining = Math.max(0, status.remainingAdPacks);
  const trialLabel = status.trialExpired
    ? "Trial ended"
    : typeof status.trialDaysRemaining === "number"
      ? `Trial: ${status.trialDaysRemaining} day${status.trialDaysRemaining === 1 ? "" : "s"} left`
      : "Trial active";

  return (
    <div
      className="trial-status-pill"
      aria-label="Trial status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 34,
        maxWidth: "min(100%, 320px)",
        overflow: "hidden",
        border: "1px solid var(--line)",
        borderRadius: 999,
        background: "#fff",
        padding: "0 8px 0 12px",
        boxShadow: "0 1px 2px rgba(15,23,42,.05)",
        color: "var(--ink)",
        fontSize: 12.5,
        fontWeight: 650,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{trialLabel}</span>
      <span aria-hidden style={{ color: "var(--line)", fontWeight: 500 }}>
        |
      </span>
      <span>{remaining}/{included} free ad packs left</span>
      <span aria-hidden className="hidden sm:inline" style={{ color: "var(--muted)", fontWeight: 550 }}>
        {used} used
      </span>
      <button
        type="button"
        aria-label="Refresh trial status"
        onClick={() => void refresh()}
        disabled={refreshing}
        style={{
          width: 26,
          height: 26,
          border: "1px solid var(--line)",
          borderRadius: 999,
          background: "var(--surface-subtle)",
          color: "var(--muted)",
          display: "inline-grid",
          placeItems: "center",
          padding: 0,
        }}
      >
        <RefreshCw aria-hidden size={13} style={{ transform: refreshing ? "rotate(90deg)" : undefined }} />
      </button>
      <Link className="button secondary" href={status.upgradeHref} style={{ minHeight: 26, padding: "0 9px", fontSize: 12 }}>
        Upgrade
      </Link>
    </div>
  );
}
