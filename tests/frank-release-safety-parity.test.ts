import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AdTemplateGeneratorReleaseError,
  consumeAdTemplateGeneratorRelease,
} from "../src/lib/adstudio/frank-template-release.ts";
import {
  consumeContentFactoryBlogRelease,
  ContentFactoryReleaseError,
} from "../src/lib/content-factory/blog-release.ts";
import { hashFrankReleaseEnvelope, hashFrankReleaseValue } from "../src/lib/frank-release-integrity.ts";
import {
  assertSafeFrankReleaseEnvelope,
  FrankReleaseSafetyError,
} from "../src/lib/frank-release-safety.ts";
import {
  AdIntelligenceReleaseError,
  computeAdIntelligenceReleaseHash,
  consumeAdIntelligenceRelease,
} from "../src/lib/research/ad-intelligence-release.ts";

const fixtureRoot = new URL("./fixtures/frank-releases/", import.meta.url);

function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), "utf8"));
}

const consumers = [
  {
    name: "Ad Template",
    load: () => fixture("ad-template-generator-v1.json"),
    resign: (release: any) => { release.release_hash = hashFrankReleaseEnvelope(release); },
    setReferenceUrl: (release: any, url: string) => {
      release.template_pack.artifact_ref = url;
      release.provenance.artifact_ref = url;
    },
    consume: (release: any) => consumeAdTemplateGeneratorRelease(release, { kind: "project", id: "blockwise" }),
    isUnsafe: (error: unknown) => error instanceof AdTemplateGeneratorReleaseError && error.code === "unsafe_release",
    isUnsafeUrl: (error: unknown) => error instanceof AdTemplateGeneratorReleaseError && error.code === "unsafe_artifact_url",
  },
  {
    name: "Ad Radar",
    load: () => fixture("ad-radar-release-v1.json"),
    resign: (release: any) => { release.release_hash = computeAdIntelligenceReleaseHash(release); },
    setReferenceUrl: (release: any, url: string) => { release.provenance_refs = [url]; },
    consume: (release: any) => consumeAdIntelligenceRelease(release, "blockwise"),
    isUnsafe: (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "unsafe_public_export",
    isUnsafeUrl: (error: unknown) => error instanceof AdIntelligenceReleaseError && error.code === "unsafe_public_export",
  },
  {
    name: "Content Factory",
    load: () => fixture("content-release-v1.json"),
    resign: (release: any) => {
      release.provenance.artifact_checksums.seo = hashFrankReleaseValue(release.seo);
      release.release_hash = hashFrankReleaseEnvelope(release);
    },
    setReferenceUrl: (release: any, url: string) => { release.seo.canonical_url = url; },
    consume: (release: any) => consumeContentFactoryBlogRelease(
      release,
      "blockwise",
      "123e4567-e89b-42d3-a456-426614174000",
    ),
    isUnsafe: (error: unknown) => error instanceof ContentFactoryReleaseError && error.code === "unsafe_release",
    isUnsafeUrl: (error: unknown) => error instanceof ContentFactoryReleaseError && error.code === "unsafe_url",
  },
] as const;

test("all Frank consumers apply the same whole-envelope leakage policy", () => {
  const hazards = [
    "vault://private/release",
    "provider://openai/private-release",
    "prospect data record",
    "outreach payload record",
    "owner@example.com",
    "+61 412 345 678",
    "credential=do-not-release",
    "secret=do-not-release",
  ];

  for (const consumer of consumers) {
    for (const hazard of hazards) {
      const release = consumer.load();
      release.release_id = hazard;
      consumer.resign(release);
      assert.throws(
        () => consumer.consume(release),
        consumer.isUnsafe,
        `${consumer.name} accepted ${hazard}`,
      );
    }
  }
});

test("all Frank consumers reject forbidden provider fields before schema parsing", () => {
  for (const consumer of consumers) {
    const release = consumer.load();
    release.provider_payload = { status: "private" };
    consumer.resign(release);
    assert.throws(
      () => consumer.consume(release),
      consumer.isUnsafe,
      `${consumer.name} did not apply the shared provider-field rule`,
    );
  }
});

test("all Frank consumers reject decoded secret, credential, PII, and restricted reference URLs", () => {
  const hazards = [
    "https://cdn.example.com/release?download=sk_live_abcdefghijklmnop",
    "https://cdn.example.com/release?download=credential%3Ddo-not-release",
    "https://cdn.example.com/release?download=owner%40example.com",
    "https://cdn.example.com/release?download=%256fwner%2540example.com",
    "https://cdn.example.com/release?download=%2B61%20412%20345%20678",
    "https://cdn.example.com/private/provider/payload.json",
    "https://cdn.example.com/release?next=https%3A%2F%2F10.0.0.1%2Fsecret",
    "https://cdn.example.com/release?next=%2F%2F169.254.169.254%2Flatest",
    "https://cdn.example.com/release?next=https%253A%252F%252Fpublic.example%252Flanding",
    "https:\\\\cdn.example.com\\release.json",
    "https://cdn.example.com\\@10.0.0.1/release.json",
    "https://cdn.example.com/releases/%5Cprivate/pack.json",
    "https://cdn.example.com/release?next=https:\\\\10.0.0.1\\secret",
    "https://cdn.example.com/release?next=https%3A%5C%5C10.0.0.1%5Csecret",
    "https://cdn.example.com/release?next=https%253A%255C%255C10.0.0.1%255Csecret",
    "https://cdn.example.com/release?download=%25zz",
    "https://cdn.example.com/release?download=%2525zz",
  ];

  for (const consumer of consumers) {
    for (const hazard of hazards) {
      const release = consumer.load();
      consumer.setReferenceUrl(release, hazard);
      consumer.resign(release);
      assert.throws(
        () => consumer.consume(release),
        consumer.isUnsafeUrl,
        `${consumer.name} accepted ${hazard}`,
      );
    }
  }
});

test("the shared walker checks decoded URLs while preserving safe public copy", () => {
  for (const artifactRef of [
    "https://cdn.example.com/release?download=sk_live_abcdefghijklmnop",
    "https://cdn.example.com/release?download=owner%40example.com",
    "https://cdn.example.com/private/provider/payload.json",
    "https://cdn.example.com/release?next=https%3A%2F%2F10.0.0.1%2Fsecret",
    "https://cdn.example.com/release?next=%2F%2F169.254.169.254%2Flatest",
  ]) {
    assert.throws(
      () => assertSafeFrankReleaseEnvelope({ artifact_ref: artifactRef }),
      (error: unknown) => error instanceof FrankReleaseSafetyError && error.reason === "unsafe_url",
    );
  }

  assert.doesNotThrow(() => assertSafeFrankReleaseEnvelope({
    artifact_ref: "https://cdn.example.com/public/pack.json?download=campaign-v1",
    body: { content: "Read https://cdn.example.com/private/provider/payload.json for a provider comparison." },
  }));
});

test("the shared safety walker rejects cyclic unknown input with a typed error", () => {
  const cycle: Record<string, unknown> = { release_id: "release-1" };
  cycle.self = [cycle];

  assert.throws(
    () => assertSafeFrankReleaseEnvelope(cycle),
    (error: unknown) => error instanceof FrankReleaseSafetyError && error.reason === "unsupported_value",
  );
});
