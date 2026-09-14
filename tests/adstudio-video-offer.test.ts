import assert from "node:assert/strict";
import test from "node:test";
import { describeDeadline, formatOfferAmount, nextWorkingDayDeadline, VIDEO_OFFER } from "../src/lib/adstudio/video-offer.ts";

/**
 * The deadline is owned by private.video_working_day_deadline in SQL; this
 * module only previews it. These cases are the same instants verified against
 * the deployed function, so a change here that disagrees with the database
 * fails loudly instead of quietly showing the customer a different date.
 */
const cases: Array<{ name: string; from: string; expectedSydneyLocal: string }> = [
  // Monday 14 Sep 2026, 16:00 Sydney (06:00 UTC) -> Tuesday 17:00 Sydney.
  { name: "monday during hours", from: "2026-09-14T06:00:00Z", expectedSydneyLocal: "2026-09-15 17:00" },
  // Friday 18 Sep 2026, 16:00 Sydney -> Monday 21 Sep 17:00.
  { name: "friday during hours", from: "2026-09-18T06:00:00Z", expectedSydneyLocal: "2026-09-21 17:00" },
  // Monday 14 Sep 2026, 19:00 Sydney -> counting starts Tuesday -> Wed 17:00.
  { name: "monday after hours", from: "2026-09-14T09:00:00Z", expectedSydneyLocal: "2026-09-16 17:00" },
  // Saturday 19 Sep 2026, 12:00 Sydney -> Monday is day 1 -> Tuesday 17:00.
  { name: "saturday", from: "2026-09-19T02:00:00Z", expectedSydneyLocal: "2026-09-22 17:00" },
];

function sydneyLocal(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}

test("the previewed deadline agrees with the database function", () => {
  for (const testCase of cases) {
    const actual = sydneyLocal(nextWorkingDayDeadline(new Date(testCase.from)));
    assert.equal(actual, testCase.expectedSydneyLocal, `${testCase.name}: got ${actual}`);
  }
});

test("the deadline never lands on a weekend", () => {
  // Walk a fortnight of start instants and assert no deadline is Sat or Sun.
  const weekdayNames = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "short" });
  for (let hour = 0; hour < 24 * 14; hour += 1) {
    const from = new Date(Date.UTC(2026, 8, 14, hour));
    const due = nextWorkingDayDeadline(from);
    const weekday = weekdayNames.format(due);
    assert.ok(!["Sat", "Sun"].includes(weekday), `deadline landed on ${weekday} from ${from.toISOString()}`);
    assert.ok(due.getTime() > from.getTime(), "a deadline must be in the future");
  }
});

test("the deadline is always on or before the end of a working day", () => {
  for (let hour = 0; hour < 24 * 14; hour += 1) {
    const due = nextWorkingDayDeadline(new Date(Date.UTC(2026, 8, 14, hour)));
    const local = sydneyLocal(due);
    const time = local.slice(-5);
    assert.ok(time <= "17:00", `deadline ${local} is after the working day`);
    assert.ok(time >= "09:00", `deadline ${local} is before the working day`);
  }
});

test("the price label is derived from the amount, not written twice", () => {
  assert.equal(VIDEO_OFFER.amountMinor, 10_000);
  assert.equal(VIDEO_OFFER.currency, "AUD");
  assert.match(formatOfferAmount(), /\$100/);
});

test("GST is undetermined and checkout is gated while it is", () => {
  assert.equal(VIDEO_OFFER.taxTreatment, "undetermined");
  assert.equal(
    VIDEO_OFFER.checkoutEnabled,
    false,
    "live checkout must stay disabled until the accountant confirms GST",
  );
});

test("the deadline is described as working days, never as 48 hours", () => {
  const summary = describeDeadline();
  assert.match(summary, /working days/i);
  assert.doesNotMatch(summary, /48/, "'48 hours' reads as two days and would be six working days");
});

test("no narration is promised and audio comes from an approved source", () => {
  assert.equal(VIDEO_OFFER.deliverable.narration, "none");
  assert.match(VIDEO_OFFER.deliverable.audio, /transcript|music/i);
});
