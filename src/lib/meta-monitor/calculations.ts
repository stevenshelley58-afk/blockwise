import type { BudgetPacingResult } from "./types.ts";

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
