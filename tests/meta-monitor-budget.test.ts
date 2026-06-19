import assert from "node:assert/strict";
import test from "node:test";

import {
  dollarsToMinorUnits,
  isPlausibleDailyBudgetDollars,
  minorUnitsToDollars,
} from "../src/lib/meta-monitor/budget.ts";

test("dollarsToMinorUnits converts dollars to integer cents", () => {
  assert.equal(dollarsToMinorUnits(40), 4000);
  assert.equal(dollarsToMinorUnits(12.5), 1250);
  assert.equal(dollarsToMinorUnits(0), 0);
  // rounds to the nearest cent, never produces fractional minor units
  assert.equal(dollarsToMinorUnits(19.999), 2000);
});

test("dollarsToMinorUnits rejects unsafe input that could mis-scale live spend", () => {
  assert.throws(() => dollarsToMinorUnits(Number.NaN));
  assert.throws(() => dollarsToMinorUnits(Number.POSITIVE_INFINITY));
  assert.throws(() => dollarsToMinorUnits(-5));
  // @ts-expect-error guarding against non-number callers at runtime
  assert.throws(() => dollarsToMinorUnits("40"));
});

test("minorUnitsToDollars is the inverse and null-safe", () => {
  assert.equal(minorUnitsToDollars(4000), 40);
  assert.equal(minorUnitsToDollars(1250), 12.5);
  assert.equal(minorUnitsToDollars(null), null);
  assert.equal(minorUnitsToDollars(undefined), null);
  assert.equal(minorUnitsToDollars(Number.NaN), null);
});

test("round-trip dollars → minor → dollars is stable", () => {
  for (const dollars of [1, 5, 25, 40, 99.99, 250]) {
    assert.equal(minorUnitsToDollars(dollarsToMinorUnits(dollars)), dollars);
  }
});

test("isPlausibleDailyBudgetDollars rejects absurd or sub-minimum budgets", () => {
  assert.equal(isPlausibleDailyBudgetDollars(40), true);
  assert.equal(isPlausibleDailyBudgetDollars(1), true);
  assert.equal(isPlausibleDailyBudgetDollars(0.5), false);
  assert.equal(isPlausibleDailyBudgetDollars(0), false);
  assert.equal(isPlausibleDailyBudgetDollars(1000000), false);
  assert.equal(isPlausibleDailyBudgetDollars(Number.NaN), false);
});
