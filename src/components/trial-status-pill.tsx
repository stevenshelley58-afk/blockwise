"use client";

import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { niche } from "@/config/niche";
import { cssSpring } from "@/lib/motion";

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

function useTrialStatus(initialStatus: TrialStatus | null) {
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

  return { status, refreshing, refresh };
}

function trialLabel(status: TrialStatus): string {
  const copy = niche.copy.shell.trial;
  if (status.trialExpired) return copy.ended;
  if (typeof status.trialDaysRemaining === "number") {
    return copy.daysLeft(status.trialDaysRemaining);
  }
  return copy.active;
}

/**
 * Premium v2 trial card for the self-serve sidebar footer (mockup target):
 * label row, ad-pack meter in the data hue, upgrade CTA with arrow nudge.
 */
export function TrialStatusCard({ initialStatus }: { initialStatus: TrialStatus | null }) {
  const { status } = useTrialStatus(initialStatus);
  const [meterOn, setMeterOn] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMeterOn(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!status?.isTrial) return null;

  const copy = niche.copy.shell.trial;
  const included = Math.max(1, status.includedAdPacks);
  const remaining = Math.max(0, status.remainingAdPacks);
  const fill = Math.min(100, Math.round((remaining / included) * 100));

  return (
    <div
      aria-label="Trial status"
      className="rounded-(--r-card) border border-border bg-card p-3 shadow-card"
    >
      <p className="flex items-baseline justify-between gap-2 text-[11.5px] font-semibold text-muted-foreground">
        <span className="truncate">{trialLabel(status)}</span>
        <strong className="font-bold text-foreground tabular-nums">
          {remaining} / {included}
        </strong>
      </p>
      <div
        role="progressbar"
        aria-label={copy.packsLeft(remaining, included)}
        aria-valuemin={0}
        aria-valuemax={included}
        aria-valuenow={remaining}
        className="mt-2 h-[5px] overflow-hidden rounded-full bg-data-track"
      >
        <div
          className="h-full rounded-full bg-data motion-reduce:transition-none"
          style={{
            width: meterOn ? `${fill}%` : "0%",
            transition: `width 1s ${cssSpring}`,
          }}
        />
      </div>
      <Link
        href={status.upgradeHref}
        className="group mt-2.5 inline-flex items-center gap-1 text-xs font-bold text-foreground"
      >
        {copy.upgrade}
        <ArrowRight
          aria-hidden
          size={12}
          className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
          style={{ transitionTimingFunction: cssSpring }}
        />
      </Link>
    </div>
  );
}

/**
 * Legacy inline pill — kept verbatim for the operator/monitor shells, which
 * stay on the existing CSS shell until their own migration.
 */
export function TrialStatusPill({ initialStatus }: { initialStatus: TrialStatus | null }) {
  const { status, refreshing, refresh } = useTrialStatus(initialStatus);

  if (!status?.isTrial) return null;

  const used = Math.max(0, status.usedAdPacks);
  const included = Math.max(1, status.includedAdPacks);
  const remaining = Math.max(0, status.remainingAdPacks);
  const label = trialLabel(status);

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
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
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
