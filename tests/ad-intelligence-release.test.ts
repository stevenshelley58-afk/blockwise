import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AdIntelligenceReleaseError,
  computeAdIntelligencePublicExportChecksum,
  computeAdIntelligenceReleaseHash,
  consumeAdIntelligenceRelease,
} from "../src/lib/research/ad-intelligence-release.ts";

const fixturePath = new URL("./fixtures/frank-releases/ad-radar-release-v1.json", import.meta.url);
const projectScope = "blockwise";

function fixture(): any {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function resign(release: any): void {
  release.checksum = computeAdIntelligencePublicExportChecksum(release.public_export);
  release.release_hash = computeAdIntelligenceReleaseHash(release);
}

function assertError(action: () => unknown, code: AdIntelligenceReleaseError["code"]): void {
  assert.throws(action, (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === code);
}

test("accepts the exact Frank Ad Radar golden fixture and retains all evidence", () => {
  const input = fixture();
  const result = consumeAdIntelligenceRelease(input, projectScope);

  assert.equal(result.release.release_hash, input.release_hash);
  assert.equal(result.release.checksum, input.checksum);
  assert.equal(result.settingsRevision, input.settings_revision);
  assert.equal(result.settingsRef, input.settings_ref);
  assert.deepEqual(result.provenanceRefs, input.provenance_refs);
  assert.deepEqual(result.traceRefs, input.trace_refs);
  assert.deepEqual(result.qaReceipt, input.qa_receipt);
  assert.deepEqual(result.sanitizationReceipts, input.sanitization_receipts);
  assert.equal(result.rows[0]?.library_id, "a-1");
  assert.equal(result.cards[0]?.media.length, 0);
});

test("keeps opaque media refs unresolved unless an explicit trusted resolver is supplied", () => {
  const unresolved = consumeAdIntelligenceRelease(fixture(), projectScope);
  assert.deepEqual(unresolved.mediaReferences, [
    {
      creativeId: "a-1",
      assetRef: "media://a-1",
      resolvedUrl: null,
      kind: "image",
      width: 1200,
      height: 800,
      qaStatus: "passed",
    },
  ]);
  assert.equal(unresolved.rows[0]?.primary_image_url, null);
  assert.deepEqual(unresolved.rows[0]?.image_urls, []);

  const resolved = consumeAdIntelligenceRelease(fixture(), projectScope, {
    resolveMediaRef: (ref) => ref === "media://a-1" ? "https://cdn.example/a-1.png" : null,
  });
  assert.equal(resolved.mediaReferences[0]?.resolvedUrl, "https://cdn.example/a-1.png");
  assert.equal(resolved.cards[0]?.media[0]?.url, "https://cdn.example/a-1.png");

  assertError(
    () => consumeAdIntelligenceRelease(fixture(), projectScope, { resolveMediaRef: () => "file:///tmp/private.png" }),
    "invalid_media_resolution",
  );
});

test("binds release scope and public export project to the caller target", () => {
  assertError(() => consumeAdIntelligenceRelease(fixture(), "another-project"), "scope_mismatch");

  const splitScope = fixture();
  splitScope.public_export.project = "another-project";
  resign(splitScope);
  assertError(() => consumeAdIntelligenceRelease(splitScope, projectScope), "scope_mismatch");
});

test("rejects checksum and release-envelope tampering", () => {
  const exportTamper = fixture();
  exportTamper.public_export.creatives[0].copy.headline = "Changed";
  assertError(() => consumeAdIntelligenceRelease(exportTamper, projectScope), "checksum_mismatch");

  const envelopeTamper = fixture();
  envelopeTamper.settings_revision = 2;
  assertError(() => consumeAdIntelligenceRelease(envelopeTamper, projectScope), "release_hash_mismatch");
});

test("recursively rejects prospect, outreach, PII, provider, private, and secret data", () => {
  const mutations = [
    (release: any) => { release.public_export.creatives[0].copy.body = "owner@example.com"; },
    (release: any) => { release.public_export.creatives[0].copy.body = "+61 412 345 678"; },
    (release: any) => { release.public_export.creatives[0].provider_payload = { id: "x" }; },
    (release: any) => { release.public_export.creatives[0].classification.prospect_id = "p-1"; },
    (release: any) => { release.public_export.creatives[0].media[0].asset_ref = "vault://private/ad.jpg"; },
    (release: any) => { release.public_export.creatives[0].copy.outreach_message = "hello"; },
    (release: any) => { release.public_export.creatives[0].copy.body = "Bearer abcdefghijklmnopqrstuvwxyz"; },
  ];

  for (const mutate of mutations) {
    const release = fixture();
    mutate(release);
    assert.throws(() => consumeAdIntelligenceRelease(release, projectScope), AdIntelligenceReleaseError);
  }
});

test("scans re-signed private and PII values across the complete release envelope", () => {
  const piiReleaseId = fixture();
  piiReleaseId.release_id = "owner@example.com";
  resign(piiReleaseId);
  assertError(() => consumeAdIntelligenceRelease(piiReleaseId, projectScope), "unsafe_public_export");

  const privateSettings = fixture();
  privateSettings.settings_ref = "openbao://private/settings";
  resign(privateSettings);
  assertError(() => consumeAdIntelligenceRelease(privateSettings, projectScope), "unsafe_public_export");
});

test("rejects credential-query and IPv4-mapped IPv6 URLs anywhere in Ad Radar evidence", () => {
  const credential = fixture();
  credential.provenance_refs = ["https://public.example/provenance?access_token=value"];
  resign(credential);
  assertError(() => consumeAdIntelligenceRelease(credential, projectScope), "unsafe_public_export");

  const mappedLoopback = fixture();
  mappedLoopback.trace_refs = ["https://[::ffff:127.0.0.1]/trace"];
  resign(mappedLoopback);
  assertError(() => consumeAdIntelligenceRelease(mappedLoopback, projectScope), "unsafe_public_export");
});

test("rejects failed sanitization and unknown release fields", () => {
  const failed = fixture();
  failed.sanitization_receipts.secret_scan.status = "failed";
  assertError(() => consumeAdIntelligenceRelease(failed, projectScope), "invalid_shape");

  const unknown = fixture();
  unknown.qa_approved = true;
  assertError(() => consumeAdIntelligenceRelease(unknown, projectScope), "invalid_shape");
});
