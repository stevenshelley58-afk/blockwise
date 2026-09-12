"use client";

/**
 * Loading, empty, error, permission and read-only states plus the small status
 * vocabulary used across the lead workspace.
 *
 * Stage, quality, duplicate and CRM delivery are four different facts, so each
 * gets its own visual language. Stage is always neutral. The generic "New"
 * badge is never reused as a stage.
 */

import { AlertTriangle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { leadsCopy } from "./copy.ts";
import { deliveryHint, deliveryLabel, qualityLabel, stageLabel } from "./format.ts";
import { isTerminalStage, type LeadDeliveryState, type LeadQuality } from "./types.ts";

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="grid gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 rounded-(--r-card) border border-(--line) bg-(--surface) px-4 py-3.5">
          <Skeleton className="h-4 w-24 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="hidden h-3.5 w-24 md:block" />
          <Skeleton className="hidden h-3.5 w-28 lg:block" />
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-3.5 w-64" />
      <Skeleton className="h-24 w-full rounded-(--r-card)" />
      <Skeleton className="h-32 w-full rounded-(--r-card)" />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="grid place-items-center rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface-subtle)/50 px-6 py-14 text-center">
      <div className="max-w-[380px]">
        <p className="font-display text-[17px] font-extrabold tracking-[-0.015em]">{title}</p>
        {body ? <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{body}</p> : null}
        {actionLabel && onAction ? (
          <Button type="button" variant="ghost-pill" size="pill" className="mt-5" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorCard({
  title,
  body,
  onRetry,
  retryLabel = leadsCopy.states.retry,
}: {
  title: string;
  body: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-(--r-card) border border-error/25 bg-error-soft px-4 py-3.5 text-[13px] text-error"
    >
      <p className="flex items-center gap-2 font-bold">
        <AlertTriangle aria-hidden className="size-4" />
        {title}
      </p>
      <p className="mt-1 leading-relaxed">{body}</p>
      {onRetry ? (
        <Button type="button" variant="ghost-pill" size="pill" className="mt-3" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ReadOnlyBanner({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--r-card) border border-warning/25 bg-warning-soft px-4 py-3 text-[13px] text-warning"
    >
      <span className="inline-flex items-center gap-2 font-bold">
        <ShieldAlert aria-hidden className="size-4" />
        {title}
      </span>
      <span className="leading-relaxed">{body}</span>
    </div>
  );
}

const CHIP_BASE =
  "inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold leading-[1.1] whitespace-nowrap";

/** Stage is a sales fact. Always neutral, never a status colour. */
export function StageChip({ stage }: { stage: string }) {
  const terminal = isTerminalStage(stage);
  return (
    <span
      className={CHIP_BASE + (terminal ? " bg-(--ink) text-white" : " border border-(--line-heavy) bg-(--surface) text-(--ink)")}
    >
      {stageLabel(stage)}
    </span>
  );
}

/** Quality is a Blockwise label about the enquiry. Never a stage. */
export function QualityChip({ quality }: { quality: LeadQuality | string }) {
  return (
    <span className={CHIP_BASE + " border border-(--line) bg-(--surface-subtle) font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--muted) uppercase"}>
      {qualityLabel(quality)}
    </span>
  );
}

/** A duplicate warning is a caution, not a stage and not a quality label. */
export function DuplicateChip() {
  return (
    <span className={CHIP_BASE + " bg-warning-soft text-warning"}>
      <AlertTriangle aria-hidden className="size-3" />
      {leadsCopy.detail.duplicateWarning}
    </span>
  );
}

/** CRM delivery is Blockwise plumbing. It says nothing about the sale. */
export function DeliveryChip({ state }: { state: LeadDeliveryState | string }) {
  const tone =
    state === "error"
      ? " bg-error-soft text-error"
      : state === "pending"
        ? " bg-warning-soft text-warning"
        : state === "delivered"
          ? " bg-success-soft text-success"
          : " border border-(--line) bg-(--surface-subtle) text-(--muted)";
  return (
    <span className={CHIP_BASE + tone} title={deliveryHint(state) ?? undefined}>
      {deliveryLabel(state)}
    </span>
  );
}
