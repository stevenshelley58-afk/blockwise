import assert from "node:assert/strict";
import canonicalize from "canonicalize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  AD_INTELLIGENCE_CONSUMER_COMPATIBILITY,
  AD_INTELLIGENCE_PUBLIC_EXPORT_SCHEMA,
  AD_INTELLIGENCE_RELEASE_SCHEMA,
  AD_INTELLIGENCE_TOOL_ID,
  computeAdIntelligencePublicExportChecksum,
  computeAdIntelligenceReleaseHash,
  consumeAdIntelligenceRelease,
  AdIntelligenceReleaseError,
} from "../src/lib/research/ad-intelligence-release.ts";

test("consumer verifies the reviewed Frank envelope and maps stable public subjects to the read model", () => {
  const release = signedRelease({ creatives: [creative()] });
  const result = consumeAdIntelligenceRelease(release);

  assert.equal(result.state, "ready");
  assert.equal(result.release.schema, AD_INTELLIGENCE_RELEASE_SCHEMA);
  assert.equal(result.release.tool_id, AD_INTELLIGENCE_TOOL_ID);
  assert.equal(result.release.release_id, "release-2026-08-14-001");
  assert.equal(result.rows[0]?.library_id, "creative-1");
  assert.equal(result.rows[0]?.source_revision, "release-2026-08-14-001@1.0.0");
  assert.match(result.rows[0]?.card_id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(result.stableSubjectRefs[0]?.sourceRef, "hermes://creative/source-1");
  assert.equal(result.cards[0]?.suburb, "Coogee");
  assert.equal(result.settingsRevision, 1);
  assert.equal(result.qaReceipt.decision, "pass");
  assert.equal(result.sanitizationReceipts.pii_scan.status, "passed");
});

test("consumer accepts the unchanged reviewed e9fa643 golden release fixture", () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/ad-radar-release-v1.json"), "utf8"));
  const result = consumeAdIntelligenceRelease(fixture);

  assert.equal(fixture.checksum, "84afae4e14dace7517dd135cfbe45fd513cb7b85163bd72790b16b2f6c1a6e18");
  assert.equal(fixture.release_hash, "f0046362b6bd2317c30f7f16e4ee786a351982b9d89f0827feeddb93f5cf90fe");
  assert.equal(result.scope, "blockwise");
  assert.equal(result.stableSubjectRefs[0]?.sourceRef, "https://public.example/ad");
});

test("consumer rejects nested PII, private, raw, and provider payloads", () => {
  const mutations = [
    (release: any) => { release.public_export.creatives[0].copy.body = "owner@example.com"; },
    (release: any) => { release.public_export.creatives[0].media[0].asset_ref = "vault://raw/ad.jpg"; },
    (release: any) => { release.public_export.creatives[0].raw = { provider_payload: true }; },
    (release: any) => { release.public_export.creatives[0].media[0].provider = "meta"; },
  ];

  for (const mutate of mutations) {
    const release = signedRelease({ creatives: [creative()] });
    mutate(release);
    assert.throws(
      () => consumeAdIntelligenceRelease(release),
      (error: unknown) => error instanceof AdIntelligenceReleaseError,
    );
  }
});

test("consumer rejects public-export checksum, whole-envelope hash, and compatibility failures", () => {
  const checksumFailure = signedRelease({ creatives: [creative()] });
  checksumFailure.public_export.creatives[0].copy.headline = "Tampered";
  assert.throws(
    () => consumeAdIntelligenceRelease(checksumFailure),
    (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "checksum_mismatch",
  );

  const releaseHashFailure = signedRelease({ creatives: [creative()] });
  releaseHashFailure.project_scope = "tampered-scope";
  assert.throws(
    () => consumeAdIntelligenceRelease(releaseHashFailure),
    (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "release_hash_mismatch",
  );

  const compatibilityFailure = signedRelease({ creatives: [creative()] });
  compatibilityFailure.consumer_compatibility = ["blockwise.customer-ad-radar/v1"];
  assert.throws(
    () => consumeAdIntelligenceRelease(compatibilityFailure),
    (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "invalid_shape",
  );
});

test("consumer requires evidence refs and preserves an explicit empty state", () => {
  const missingEvidence = signedRelease({ creatives: [creative()] });
  delete missingEvidence.qa_receipt;
  assert.throws(
    () => consumeAdIntelligenceRelease(missingEvidence),
    (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "invalid_shape",
  );

  const empty = consumeAdIntelligenceRelease(signedRelease({ creatives: [] }));
  assert.equal(empty.state, "empty");
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.cards, []);
});

test("consumer rejects superseded evidence fields and a scope/export mismatch", () => {
  for (const field of ["settings_refs", "qa_pass", "pii_safe", "secret_safe", "public_export_ref"]) {
    const release = signedRelease({ creatives: [creative()] });
    release[field] = field === "settings_refs" ? ["settings://old"] : true;
    assert.throws(() => consumeAdIntelligenceRelease(release), (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "invalid_shape");
  }

  const mismatch = signedRelease({ creatives: [creative()] });
  mismatch.project_scope = "another-project";
  resign(mismatch);
  assert.throws(() => consumeAdIntelligenceRelease(mismatch), (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "incompatible_release");
});

test("release hashes use RFC 8785 JCS for Unicode and numeric canonical equivalence", () => {
  const unicode = signedRelease({ creatives: [creative()] });
  unicode.public_export.creatives[0].copy.headline = "Café — מוכר";
  resign(unicode);
  assert.equal(consumeAdIntelligenceRelease(unicode).state, "ready");

  assert.equal(canonicalize({ value: 1 }), canonicalize({ value: 1.0 }));
  assert.equal(
    canonicalize({ value: "Café — מוכר" }),
    '{"value":"Café — מוכר"}',
  );

  const integerRelease = signedRelease({ creatives: [creative()] });
  integerRelease.public_export.creatives[0].classification.confidence = 1;
  resign(integerRelease);
  const decimalRelease = signedRelease({ creatives: [creative()] });
  decimalRelease.public_export.creatives[0].classification.confidence = 1.0;
  resign(decimalRelease);
  assert.equal(integerRelease.checksum, decimalRelease.checksum);
  assert.equal(integerRelease.release_hash, decimalRelease.release_hash);
});

function signedRelease(overrides: Record<string, unknown>): any {
  const { creatives, public_export, ...releaseOverrides } = overrides;
  const release = {
    schema: AD_INTELLIGENCE_RELEASE_SCHEMA,
    tool_id: AD_INTELLIGENCE_TOOL_ID,
    release_id: "release-2026-08-14-001",
    version: "1.0.0",
    status: "released",
    immutable: true,
    project_scope: "blockwise",
    checksum: "",
    release_hash: "",
    provenance_refs: ["provenance://frank/run-1"],
    trace_refs: ["trace://hermes/run-1"],
    released_at: "2026-08-14T08:00:01Z",
    settings_revision: 1,
    settings_ref: "settings://ad-radar/v1",
    qa_receipt: {
      decision: "pass",
      receipt_ref: "receipt://qa/1",
      checked_at: "2026-08-14T08:00:01Z",
    },
    sanitization_receipts: {
      pii_scan: { status: "passed", receipt_id: "pii-scan-1", scanned_at: "2026-08-14T08:00:01Z" },
      secret_scan: { status: "passed", receipt_id: "secret-scan-1", scanned_at: "2026-08-14T08:00:01Z" },
    },
    pipeline_id: "ad-radar-pipeline",
    pipeline_version: "1.0.0",
    consumer_compatibility: [AD_INTELLIGENCE_CONSUMER_COMPATIBILITY],
    public_export: {
      schema: AD_INTELLIGENCE_PUBLIC_EXPORT_SCHEMA,
      project: "blockwise",
      generated_at: "2026-08-14T08:00:00Z",
      creatives: creatives ?? [],
      ...(public_export as Record<string, unknown> | undefined),
    },
    ...releaseOverrides,
  };
  resign(release);
  return release;
}

function resign(release: any): void {
  release.checksum = computeAdIntelligencePublicExportChecksum(release.public_export);
  release.release_hash = computeAdIntelligenceReleaseHash(release);
}

function creative(): Record<string, unknown> {
  return {
    id: "creative-1",
    source_ref: "hermes://creative/source-1",
    advertiser: "Coogee Property Group",
    market: "Coogee",
    category: "listing",
    copy: {
      headline: "A better way to sell in Coogee",
      body: "Local market update.",
      cta: "Learn more",
    },
    destination_ref: "https://example.com/listing",
    observed: {
      first_seen: "2026-08-01T00:00:00Z",
      last_seen: "2026-08-14T07:00:00Z",
    },
    media: [
      {
        asset_ref: "https://cdn.example.com/ad.jpg",
        kind: "image",
        width: 1200,
        height: 628,
        qa_status: "passed",
      },
    ],
    classification: {
      label: "listing",
      confidence: 0.98,
      receipt_refs: ["receipt://classify/1"],
      provenance_refs: ["provenance://classify/1"],
    },
  };
}
