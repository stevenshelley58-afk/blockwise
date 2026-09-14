/**
 * The video offer, as approved by the owner on 14 September 2026.
 *
 * This is the single place the price, the commitment and the support contact
 * are written down, so the page, the checkout route and the receipt cannot
 * disagree about what was sold.
 *
 * GST is NOT settled. `taxTreatment` stays "undetermined" and `checkoutEnabled`
 * stays false until the accountant confirms the treatment, which is the
 * condition the owner set for enabling live checkout. The amount is a
 * placeholder at that treatment, so no customer can be charged on an
 * unconfirmed tax position.
 */

export const VIDEO_OFFER = {
  id: "adstudio-video-commissioned",
  version: 1,

  /** A$100, in minor units. Ex-GST placeholder pending accountant advice. */
  amountMinor: 10_000,
  currency: "AUD",
  taxTreatment: "undetermined" as "undetermined" | "gst_inclusive" | "gst_exclusive" | "gst_free",

  /** Live checkout is gated on the tax decision, not on engineering. */
  checkoutEnabled: false,

  /** Deliverable, mirrored by video_orders.offer_snapshot at purchase time. */
  deliverable: {
    width: 1080,
    height: 1920,
    minDurationSeconds: 20,
    maxDurationSeconds: 30,
    container: "video/mp4",
    narration: "none" as const,
    audio: "customer transcript or a house-licensed music bed",
  },

  deliveryWorkingDays: 2,
  revisionWorkingDays: 1,
  revisionEntitlement: 1,

  /** Monday to Friday, in the customer's timezone. */
  workdays: [1, 2, 3, 4, 5] as const,
  workdayStartHour: 9,
  workdayEndHour: 17,
  defaultTimezone: "Australia/Sydney",

  supportEmail: "support@blockwise.sale",
} as const;

export const VIDEO_OFFER_ID = VIDEO_OFFER.id;

/** "$100" style label, derived so the copy cannot drift from the amount. */
export function formatOfferAmount(): string {
  const amount = VIDEO_OFFER.amountMinor / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: VIDEO_OFFER.currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

/**
 * What the customer is promised, in words. The deadline is stated as the
 * working-day rule that is actually implemented rather than as a duration,
 * because "48 business hours" reads as two days to a customer and would be six
 * working days if it were counted as accumulated hours.
 */
export function describeDeadline(): string {
  return `Within ${VIDEO_OFFER.deliveryWorkingDays} working days, Monday to Friday`;
}

/**
 * The next deadline from a given instant, using the same rules as
 * private.video_working_day_deadline so the page and the database agree.
 * Kept here for display only; the stored due date is always computed in SQL.
 */
export function nextWorkingDayDeadline(from: Date, timezone = VIDEO_OFFER.defaultTimezone): Date {
  let remaining = VIDEO_OFFER.deliveryWorkingDays;
  const cursor = new Date(from.getTime());

  for (let step = 0; step < 4000; step += 1) {
    const parts = zonedParts(cursor, timezone);
    if (parts.isoWeekday >= 6) {
      cursor.setTime(nextLocalMidnight(cursor, timezone, parts.hour).getTime());
      continue;
    }
    if (parts.hour < VIDEO_OFFER.workdayStartHour) {
      cursor.setTime(setLocalHour(cursor, timezone, parts, VIDEO_OFFER.workdayStartHour).getTime());
      continue;
    }
    if (parts.hour >= VIDEO_OFFER.workdayEndHour) {
      cursor.setTime(nextLocalMidnight(cursor, timezone, parts.hour).getTime());
      continue;
    }

    remaining -= 1;
    if (remaining <= 0) {
      return setLocalHour(cursor, timezone, parts, VIDEO_OFFER.workdayEndHour);
    }
    cursor.setTime(nextLocalMidnight(cursor, timezone, parts.hour).getTime());
  }

  return cursor;
}

type ZonedParts = { isoWeekday: number; hour: number; minute: number; second: number };

function zonedParts(at: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const second = Number(parts.find((part) => part.type === "second")?.value ?? "0");
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { isoWeekday: order.indexOf(weekday) + 1, hour, minute, second };
}

/** The instant the next local day starts, respecting the zone's offset. */
function nextLocalMidnight(at: Date, timezone: string, hour: number): Date {
  const guess = new Date(at.getTime() + (24 - hour) * 3_600_000);
  return startOfLocalDay(guess, timezone);
}

function startOfLocalDay(at: Date, timezone: string): Date {
  const parts = zonedParts(at, timezone);
  const offsetMs = (parts.hour * 3600 + parts.minute * 60 + parts.second) * 1000;
  return new Date(at.getTime() - offsetMs);
}

function setLocalHour(at: Date, timezone: string, parts: ZonedParts, hour: number): Date {
  const offsetMs = (parts.hour * 3600 + parts.minute * 60 + parts.second) * 1000;
  const localMidnight = at.getTime() - offsetMs;
  return new Date(localMidnight + hour * 3_600_000);
}

/** The exact date and time a customer sees, in their own timezone. */
export function formatDeadline(at: Date, timezone = VIDEO_OFFER.defaultTimezone): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}
