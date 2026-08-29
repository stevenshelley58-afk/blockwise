import type { AdVariantTags, BudgetPacingResult } from "./types.ts";

/** Rate as a fraction (0–1). Null when the denominator is zero — never NaN/Infinity. */
export function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

/** Cost per lead. Null when there are no leads — never NaN/Infinity. */
export function safeCpl(spend: number, leads: number): number | null {
  if (!Number.isFinite(spend) || !Number.isFinite(leads) || leads <= 0) {
    return null;
  }

  return spend / leads;
}

export function formatCurrency(value: number | null, options: { precise?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const rounded = options.precise ? Math.round(value * 100) / 100 : Math.round(value);

  return `$${rounded.toLocaleString("en-AU")}`;
}

export function formatPercent(value: number | null, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) {
    return "Unavailable";
  }

  return `${(value * 100).toFixed(decimals)}%`;
}

export function calculateBudgetPacing(params: {
  budget: number;
  spend: number;
  daysElapsed: number;
  totalDays: number;
}): BudgetPacingResult {
  const totalDays = Math.max(params.totalDays, 1);
  const daysElapsed = Math.min(Math.max(params.daysElapsed, 0), totalDays);
  const expectedSpendToDate = params.budget * (daysElapsed / totalDays);
  const forecastSpend = daysElapsed > 0 ? (params.spend / daysElapsed) * totalDays : 0;
  const status: BudgetPacingResult["status"] =
    forecastSpend > params.budget * 1.1
      ? "Overspending"
      : forecastSpend < params.budget * 0.85
        ? "Under pacing"
        : "On pace";

  return {
    budget: params.budget,
    spend: params.spend,
    spendPercent: params.budget > 0 ? params.spend / params.budget : 0,
    expectedSpendToDate,
    forecastSpend,
    status,
  };
}

const AD_VARIANT_TAG_PATTERN = /\|\s*bw:v=([a-z0-9]+);a=([a-z0-9-]+)(?:;t=([a-z0-9_-]+))?\s*$/i;

/**
 * Extracts the structured `| bw:v=<variant>;a=<angle>;t=<template>` suffix that
 * Ad Studio appends to Meta ad names at publish (see providers/meta-execution
 * buildAdVariantTagSuffix). Returns null for untagged ads.
 */
export function parseAdVariantTags(adName: string | null | undefined): AdVariantTags | null {
  const match = adName?.match(AD_VARIANT_TAG_PATTERN);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    variantId: match[1],
    angle: match[2],
    template: match[3] ?? null,
  };
}

export type FatigueWindowStats = {
  impressions: number;
  clicks: number;
};

/**
 * Creative fatigue: frequency above 2.5 AND last-7-day CTR down >= 30% vs the
 * prior 7 days. Requires >= 1,000 impressions in each window — anything less
 * returns false (no alert on insufficient data).
 */
export function detectCreativeFatigue(input: {
  frequency: number | null;
  recent: FatigueWindowStats;
  prior: FatigueWindowStats;
}): boolean {
  if (input.frequency == null || input.frequency <= 2.5) {
    return false;
  }

  if (input.recent.impressions < 1000 || input.prior.impressions < 1000) {
    return false;
  }

  const recentCtr = safeRate(input.recent.clicks, input.recent.impressions);
  const priorCtr = safeRate(input.prior.clicks, input.prior.impressions);

  if (recentCtr == null || priorCtr == null || priorCtr <= 0) {
    return false;
  }

  return (priorCtr - recentCtr) / priorCtr >= 0.3;
}

/** Relative change as a fraction (0.124 = +12.4%). Null when either side is missing or previous is zero. */
export function calculateTrend(current: number | null, previous: number | null): number | null {
  if (
    current == null ||
    previous == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }

  return (current - previous) / previous;
}
