import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCheckoutEnabled,
  buildOfferSnapshot,
  VideoCheckoutGatedError,
} from "../src/lib/adbuilder/video-order.ts";
import { VIDEO_OFFER } from "../src/lib/adbuilder/video-offer.ts";

test("checkout is gated while the GST treatment is undetermined", () => {
  assert.throws(
    () => assertCheckoutEnabled({ STRIPE_VIDEO_AUD_PRICE_ID: "price_live_123" } as unknown as NodeJS.ProcessEnv),
    VideoCheckoutGatedError,
    "a configured price must not be enough to start charging",
  );
});

test("the gate message tells the customer what is happening without exposing internals", () => {
  try {
    assertCheckoutEnabled({} as unknown as NodeJS.ProcessEnv);
    assert.fail("the gate must throw");
  } catch (error) {
    assert.ok(error instanceof VideoCheckoutGatedError);
    assert.match(error.message, /not available yet/i);
    assert.doesNotMatch(error.message, /stripe|price_id|env|gst/i, "no internal detail leaks to the customer");
  }
});

test("the gate is decided by two independent conditions", () => {
  // Both constants are compile-time; this asserts the shipped defaults so a
  // later edit that flips only one is caught here.
  assert.equal(VIDEO_OFFER.taxTreatment, "undetermined");
  assert.equal(VIDEO_OFFER.checkoutEnabled, false);
});

test("the offer snapshot freezes exactly what was sold", () => {
  const at = new Date("2026-09-14T00:00:00Z");
  const snapshot = buildOfferSnapshot(at);

  assert.equal(snapshot.offerId, VIDEO_OFFER.id);
  assert.equal(snapshot.offerVersion, VIDEO_OFFER.version);
  assert.equal(snapshot.amountMinor, 10_000);
  assert.equal(snapshot.currency, "AUD");
  assert.equal(snapshot.deliveryWorkingDays, 2);
  assert.equal(snapshot.revisionWorkingDays, 1);
  assert.equal(snapshot.revisionEntitlement, 1);
  assert.equal(snapshot.timezone, "Australia/Sydney");
  assert.equal(snapshot.snapshotAt, at.toISOString());
  assert.deepEqual(snapshot.deliverable, VIDEO_OFFER.deliverable);
  assert.deepEqual(snapshot.workdays, VIDEO_OFFER.workdays);
});

test("the snapshot carries the full deliverable, not a summary", () => {
  const snapshot = buildOfferSnapshot(new Date());
  assert.equal(snapshot.deliverable.width, 1080);
  assert.equal(snapshot.deliverable.height, 1920);
  assert.equal(snapshot.deliverable.minDurationSeconds, 20);
  assert.equal(snapshot.deliverable.maxDurationSeconds, 30);
  assert.equal(snapshot.deliverable.narration, "none");
});

test("the snapshot does not carry customer content", () => {
  // The snapshot is stored on the order and shown back to the customer, so it
  // must describe the deal rather than reproduce their brief or files.
  const snapshot = buildOfferSnapshot(new Date()) as Record<string, unknown>;
  const serialised = JSON.stringify(snapshot);
  // "transcript" is deliberately absent from this list: the offer's own audio
  // description legitimately mentions a customer transcript as an option, which
  // is a product fact rather than customer content.
  assert.doesNotMatch(serialised, /objective|audience|key_facts|keyFacts|asset_id|assetId|object_path|objectPath/i);
});
