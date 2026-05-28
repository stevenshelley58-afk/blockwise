import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAbsence,
  applyObservation,
  summariseOutcomes,
} from "../../src/lib/research/ingest.ts";
import { normaliseApifyAd } from "../../src/lib/research/normalise.ts";

import {
  adAlpha,
  adAlphaBodyChanged,
  adBeta,
  advertiserPageAlphaId,
} from "./fixtures.ts";
import { InMemoryWriter } from "./in-memory-writer.ts";

test("first observation inserts and writes exactly one snapshot", async () => {
  const writer = new InMemoryWriter();
  const { observation, payloadHash } = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });

  const outcome = await applyObservation(writer, {
    observation,
    payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  assert.equal(outcome.kind, "inserted");
  assert.equal(writer.observedAds.size, 1);
  assert.equal(writer.snapshots.size, 1);
  assert.equal(writer.ingestEvents.length, 1);
  assert.equal(writer.ingestEvents[0]!.eventType, "insert");
});

test("re-observing an unchanged payload upserts as 'unchanged' with NO new snapshot", async () => {
  const writer = new InMemoryWriter();
  const norm = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });

  await applyObservation(writer, {
    observation: norm.observation,
    payloadHash: norm.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  const second = await applyObservation(writer, {
    observation: norm.observation,
    payloadHash: norm.payloadHash,
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });

  assert.equal(second.kind, "unchanged");
  assert.equal(writer.observedAds.size, 1);
  // First observation produced one snapshot; an unchanged re-observation must
  // NOT produce a second snapshot.
  assert.equal(writer.snapshots.size, 1);
  // last_seen_at and last_checked_at must advance.
  const row = writer.observedAds.values().next().value!;
  assert.equal(row.lastSeenAt, "2026-05-29T10:00:00Z");
  assert.equal(row.lastCheckedAt, "2026-05-29T10:00:00Z");
  // missing_successive_checks must reset to 0 on a fresh sighting.
  assert.equal(row.missingSuccessiveChecks, 0);
});

test("re-observing with a changed payload writes a new snapshot and records a diff", async () => {
  const writer = new InMemoryWriter();
  const first = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  await applyObservation(writer, {
    observation: first.observation,
    payloadHash: first.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  const second = normaliseApifyAd({
    ad: adAlphaBodyChanged,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const outcome = await applyObservation(writer, {
    observation: second.observation,
    payloadHash: second.payloadHash,
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });

  assert.equal(outcome.kind, "updated");
  assert.equal(writer.observedAds.size, 1);
  assert.equal(writer.snapshots.size, 2);
  const latest = [...writer.snapshots.values()].sort((a, b) =>
    a.snapshotAt.localeCompare(b.snapshotAt),
  )[1]!;
  // The diff between snapshots should include the changed snapshot.body field
  // (which lives nested under "snapshot" in the raw payload).
  assert.ok(latest.changesFromPrior.snapshot, "expected snapshot.* diff entry");
});

test("absence confirmation: one missing run increments counter, does NOT mark inactive", async () => {
  const writer = new InMemoryWriter();
  const norm = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  await applyObservation(writer, {
    observation: norm.observation,
    payloadHash: norm.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  const absence = await applyAbsence(writer, {
    advertiserPageId: advertiserPageAlphaId,
    seenExternalAdIds: ["3303030303030303"], // adAlpha is NOT in this list
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });

  assert.equal(absence.incremented, 1);
  assert.equal(absence.markedInactive, 0);
  const row = writer.observedAds.values().next().value!;
  assert.equal(row.missingSuccessiveChecks, 1);
  assert.equal(row.activeStatus, "active");
});

test("absence confirmation: two consecutive missing runs DOES mark inactive", async () => {
  const writer = new InMemoryWriter();
  const norm = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  await applyObservation(writer, {
    observation: norm.observation,
    payloadHash: norm.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  await applyAbsence(writer, {
    advertiserPageId: advertiserPageAlphaId,
    seenExternalAdIds: [],
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });
  const second = await applyAbsence(writer, {
    advertiserPageId: advertiserPageAlphaId,
    seenExternalAdIds: [],
    adFetchRunId: "run-3",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-30T10:00:00Z",
  });

  assert.equal(second.markedInactive, 1);
  const row = writer.observedAds.values().next().value!;
  assert.equal(row.missingSuccessiveChecks, 2);
  assert.equal(row.activeStatus, "inactive");
  const inactiveEvent = writer.ingestEvents.find((e) => e.eventType === "mark_inactive");
  assert.ok(inactiveEvent, "expected a mark_inactive ingest_event");
});

test("absence confirmation: a re-sighting after one missing run resets the counter", async () => {
  const writer = new InMemoryWriter();
  const norm = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  await applyObservation(writer, {
    observation: norm.observation,
    payloadHash: norm.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  await applyAbsence(writer, {
    advertiserPageId: advertiserPageAlphaId,
    seenExternalAdIds: [],
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });

  await applyObservation(writer, {
    observation: norm.observation,
    payloadHash: norm.payloadHash,
    adFetchRunId: "run-3",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-30T10:00:00Z",
  });

  const row = writer.observedAds.values().next().value!;
  assert.equal(row.missingSuccessiveChecks, 0);
  assert.equal(row.activeStatus, "active");
});

test("multiple ads on one page: only the missing one increments, the seen one resets", async () => {
  const writer = new InMemoryWriter();
  const alpha = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const beta = normaliseApifyAd({
    ad: adBeta,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  await applyObservation(writer, {
    observation: alpha.observation,
    payloadHash: alpha.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });
  await applyObservation(writer, {
    observation: beta.observation,
    payloadHash: beta.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });

  // Run 2 sees only beta; alpha is missing.
  await applyObservation(writer, {
    observation: beta.observation,
    payloadHash: beta.payloadHash,
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });
  const absence = await applyAbsence(writer, {
    advertiserPageId: advertiserPageAlphaId,
    seenExternalAdIds: ["2202020202020202"],
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });

  assert.equal(absence.incremented, 1);
  const ads = [...writer.observedAds.values()];
  const alphaRow = ads.find((a) => a.externalAdId === "1101010101010101")!;
  const betaRow = ads.find((a) => a.externalAdId === "2202020202020202")!;
  assert.equal(alphaRow.missingSuccessiveChecks, 1);
  assert.equal(betaRow.missingSuccessiveChecks, 0);
});

test("summariseOutcomes counts inserts, updates, unchanged, and missing correctly", async () => {
  const writer = new InMemoryWriter();
  const alpha = normaliseApifyAd({
    ad: adAlpha,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const beta = normaliseApifyAd({
    ad: adBeta,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const inserted = await applyObservation(writer, {
    observation: alpha.observation,
    payloadHash: alpha.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });
  const insertedBeta = await applyObservation(writer, {
    observation: beta.observation,
    payloadHash: beta.payloadHash,
    adFetchRunId: "run-1",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-28T10:00:00Z",
  });
  const unchanged = await applyObservation(writer, {
    observation: alpha.observation,
    payloadHash: alpha.payloadHash,
    adFetchRunId: "run-2",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-29T10:00:00Z",
  });
  const changedAlpha = normaliseApifyAd({
    ad: adAlphaBodyChanged,
    advertiserPageId: advertiserPageAlphaId,
    observedByProvider: "apify_leadsbrary",
  });
  const updated = await applyObservation(writer, {
    observation: changedAlpha.observation,
    payloadHash: changedAlpha.payloadHash,
    adFetchRunId: "run-3",
    sourceProvider: "apify_leadsbrary",
    now: "2026-05-30T10:00:00Z",
  });

  const summary = summariseOutcomes(
    [inserted, insertedBeta, unchanged, updated],
    { incremented: 0, markedInactive: 0 },
  );
  assert.equal(summary.adsObserved, 4);
  assert.equal(summary.adsNew, 2);
  assert.equal(summary.adsUpdated, 1);
  assert.equal(summary.adsUnchanged, 1);
});
