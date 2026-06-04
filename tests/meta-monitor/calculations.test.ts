import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBudgetPacing,
  calculateTrend,
  formatCurrency,
  formatPercent,
  safeCpl,
  safeRate,
} from "../../src/lib/meta-monitor/calculations.ts";

test("safeRate divides and returns null on zero/invalid denominators", () => {
  assert.equal(safeRate(118, 176), 118 / 176);
  assert.equal(safeRate(5, 0), null);
  assert.equal(safeRate(5, -1), null);
  assert.equal(safeRate(Number.NaN, 10), null);
  assert.equal(safeRate(5, Number.POSITIVE_INFINITY), null);
});

test("safeCpl divides and returns null when there are no leads", () => {
  assert.equal(safeCpl(5940, 118), 5940 / 118);
  assert.equal(safeCpl(5940, 0), null);
  assert.equal(safeCpl(Number.NaN, 4), null);
});

test("derived values never produce NaN or Infinity", () => {
  for (const value of [safeRate(0, 0), safeCpl(100, 0), calculateTrend(10, 0), calculateTrend(null, 5)]) {
    assert.equal(value, null);
  }
});

test("formatCurrency and formatPercent render Unavailable for null", () => {
  assert.equal(formatCurrency(5940), "$5,940");
  assert.equal(formatCurrency(null), "Unavailable");
  assert.equal(formatPercent(0.671, 1), "67.1%");
  assert.equal(formatPercent(null), "Unavailable");
});

test("budget pacing classifies overspending, on pace and under pacing", () => {
  const onPace = calculateBudgetPacing({ budget: 7500, spend: 5940, daysElapsed: 24, totalDays: 30 });

  assert.equal(onPace.status, "On pace");
  assert.equal(onPace.expectedSpendToDate, 6000);
  assert.equal(Math.round(onPace.forecastSpend), 7425);

  assert.equal(calculateBudgetPacing({ budget: 1000, spend: 900, daysElapsed: 15, totalDays: 30 }).status, "Overspending");
  assert.equal(calculateBudgetPacing({ budget: 1000, spend: 100, daysElapsed: 15, totalDays: 30 }).status, "Under pacing");
});

test("budget pacing survives zero days elapsed and zero budget", () => {
  const zeroDays = calculateBudgetPacing({ budget: 1000, spend: 0, daysElapsed: 0, totalDays: 30 });

  assert.equal(zeroDays.forecastSpend, 0);
  assert.equal(zeroDays.status, "Under pacing");

  const zeroBudget = calculateBudgetPacing({ budget: 0, spend: 100, daysElapsed: 5, totalDays: 30 });

  assert.equal(zeroBudget.spendPercent, 0);
  assert.equal(Number.isFinite(zeroBudget.forecastSpend), true);
});

test("calculateTrend returns signed fractions and null on missing baselines", () => {
  assert.ok(Math.abs((calculateTrend(112.4, 100) ?? 0) - 0.124) < 1e-9);
  assert.ok(Math.abs((calculateTrend(90, 100) ?? 0) - -0.1) < 1e-9);
  assert.equal(calculateTrend(100, 0), null);
  assert.equal(calculateTrend(100, null), null);
});
