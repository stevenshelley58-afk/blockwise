/**
 * Meta budgets are set in **minor currency units** (cents for AUD). A units slip
 * here would mis-scale live ad spend by 100×, so all dollar↔minor conversions
 * for inline management go through these guarded helpers.
 */

/** Convert a user-entered dollar amount to integer minor units (cents). */
export function dollarsToMinorUnits(dollars: number): number {
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) {
    throw new Error("Budget must be a finite number.");
  }
  if (dollars < 0) {
    throw new Error("Budget must not be negative.");
  }
  return Math.round(dollars * 100);
}

/** Convert Meta minor units back to dollars for display; null-safe. */
export function minorUnitsToDollars(minorUnits: number | null | undefined): number | null {
  if (minorUnits == null || !Number.isFinite(minorUnits)) {
    return null;
  }
  return Math.round(minorUnits) / 100;
}

/** Minimum daily budget Meta accepts for most AUD ad sets is ~$1.00/day. */
export const MIN_DAILY_BUDGET_DOLLARS = 1;

/** True when a dollar amount is a sane daily budget we are willing to push live. */
export function isPlausibleDailyBudgetDollars(dollars: number): boolean {
  return Number.isFinite(dollars) && dollars >= MIN_DAILY_BUDGET_DOLLARS && dollars <= 100000;
}
