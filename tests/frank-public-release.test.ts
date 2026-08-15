import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, sha256Hex } from "../packages/ad-template-pack-contract/src/index.ts";
import {
  importFrankPublicRelease,
  type FrankPublicRelease,
} from "../src/lib/adstudio/frank-public-release.ts";
import type { ImportError, ImportRequest } from "../src/lib/adstudio/import-pack.ts";

const FIXTURE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

type Row = Record<string, unknown>;

class FakeSupabase {
  tables: Record<string, Row[]> = {
    ad_import_receipts: [],
    ad_import_nonces: [],
    ad_template_packs: [],
    ad_template_pack_versions: [],
    ad_template_assets: [],
  };
  private sequence = 0;

  from(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
  }

  insertInto(table: string, value: Row | Row[]): Row | Row[] {
    const values = Array.isArray(value) ? value : [value];
    const stored = values.map((row) => ({
      id: row.id ?? `fake-${++this.sequence}`,
      created_at: row.created_at ?? new Date().toISOString(),
      ...row,
    }));
    (this.tables[table] ??= []).push(...stored);
    return Array.isArray(value) ? stored : stored[0]!;
  }
}

class FakeQueryBuilder {
  private readonly filters: Array<[string, unknown]> = [];
  private inserted?: Row | Row[];
  private readonly db: FakeSupabase;
  private readonly table: string;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_columns: string): this { return this; }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  insert(value: Row | Row[]): this {
    this.inserted = this.db.insertInto(this.table, value);
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.find() ?? null, error: null });
  }

  single(): Promise<{ data: Row | null; error: null }> {
    const row = this.inserted !== undefined
      ? Array.isArray(this.inserted) ? this.inserted[0] : this.inserted
      : this.find();
    return Promise.resolve({ data: row ?? null, error: null });
  }

  private find(): Row | undefined {
    return (this.db.tables[this.table] ?? []).find((row) => this.filters.every(([column, value]) => row[column] === value));
  }
}

function fakeSupabase(): SupabaseClient {
  return new FakeSupabase() as unknown as SupabaseClient;
}

function loadPack(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
}

function releaseFor(pack: Record<string, unknown>): FrankPublicRelease {
  const assets = pack.assets as Record<string, { sha256: string }>;
  const fonts = pack.fonts as Array<{ file: string; sha256: string }>;
  const previews = pack.safePreviews as Record<"feed" | "story", { sha256: string }>;
  const release = {
    schema: "schema://frank.tool-app-release/v1",
    tool_id: "ad-template-generator",
    scope: { kind: "public", id: "ad-template-generator" },
    release_version: 1,
    release_id: "release-fixture-1",
    status: "released",
    settings_revision: 1,
    settings_ref: "settings/public-template-pack-v1",
    pipeline_id: "reference-clone-release",
    pipeline_version: "1.0.0",
    consumer_compatibility: { blockwise: { min: 1, max: 1 } },
    artifact_refs: {
      template_pack: { ref: "https://frank.fail/packs/fixture-minimal.json", sha256: sha256Hex(pack), public: true },
      assets: Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, {
        ref: `https://frank.fail/assets/${encodeURIComponent(key)}`,
        sha256: asset.sha256,
        public: true,
      }])),
      fonts: Object.fromEntries(fonts.map((font) => [font.file, {
        ref: `https://frank.fail/fonts/${encodeURIComponent(font.file)}`,
        sha256: font.sha256,
        public: true,
      }])),
      previews: {
        feed: { ref: "https://frank.fail/previews/fixture-feed.png", sha256: previews.feed.sha256, public: true },
        story: { ref: "https://frank.fail/previews/fixture-story.png", sha256: previews.story.sha256, public: true },
      },
    },
    artifact_provenance: { template_pack: "provenance/release-fixture-1" },
    output_checksums: {
      template_pack: sha256Hex(pack),
      assets: Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, asset.sha256])),
      fonts: Object.fromEntries(fonts.map((font) => [font.file, font.sha256])),
      previews: { feed: previews.feed.sha256, story: previews.story.sha256 },
    },
    receipt_refs: { qa: "receipt/qa-fixture-1", approval: "receipt/approval-fixture-1", sanitization: "receipt/sanitization-fixture-1" },
    trace_ref: "trace/release-fixture-1",
    qa_decision: { status: "passed", ref: "qa/release-fixture-1" },
    approval_decision: { status: "approved", ref: "approval/release-fixture-1" },
    sanitization_receipt: { status: "passed", ref: "sanitization/release-fixture-1" },
    immutable: true,
    source_free: true,
  };
  return { ...release, release_hash: sha256Hex(release) } as FrankPublicRelease;
}

function requestFor(pack: Record<string, unknown>): ImportRequest {
  return {
    packUrl: "https://frank.fail/packs/fixture-minimal.json",
    packSha256: sha256Hex(pack),
    packId: String(pack.packId),
    buildId: "fixture-build-1",
    issuedAt: new Date().toISOString(),
    nonce: randomUUID(),
    signature: "fixture-signature",
    idempotencyKey: randomUUID(),
  };
}

function refreshReleaseHash(release: FrankPublicRelease): void {
  const { release_hash: _, ...withoutReleaseHash } = release;
  release.release_hash = sha256Hex(withoutReleaseHash);
}

async function rejectsWithCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => (error as ImportError).code === code);
}

describe("Frank public release consumer adapter", () => {
  it("uses RFC 8785 JCS equivalence for Unicode and 1.0/1, and detects tampering", () => {
    const numericAndUnicode = { label: "café", version: 1.0 };
    const equivalent = JSON.parse('{"version":1,"label":"caf\\u00e9"}') as Record<string, unknown>;
    assert.equal(canonicalJson(numericAndUnicode), canonicalJson(equivalent));
    assert.equal(sha256Hex(numericAndUnicode), sha256Hex(equivalent));

    const release = releaseFor(loadPack());
    const { release_hash: releaseHash, ...releaseWithoutHash } = release;
    assert.equal(releaseHash, sha256Hex(releaseWithoutHash));
    assert.notEqual(releaseHash, sha256Hex({ ...releaseWithoutHash, release_id: "tampered" }));
  });

  it("imports an immutable sanitized release through the existing importer", async () => {
    const pack = loadPack();
    const supabase = fakeSupabase();
    const release = releaseFor(pack);
    const receipt = await importFrankPublicRelease(supabase, {
      release,
      importRequest: requestFor(pack),
    }, { fetchPack: async () => pack });

    assert.equal(receipt.status, "active");
    const db = supabase as unknown as FakeSupabase;
    assert.equal(db.tables.ad_template_packs.length, 1);
    assert.deepEqual(db.tables.ad_import_receipts[0]!.receipt, release);
  });

  it("rejects a mutable draft and workspace-scoped release data recursively", async () => {
    const pack = loadPack();
    const request = requestFor(pack);
    const draft = { ...releaseFor(pack), draft: true };
    await rejectsWithCode(
      () => importFrankPublicRelease(fakeSupabase(), { release: draft, importRequest: request }, { fetchPack: async () => pack }),
      "mutable_draft_rejected",
    );

    const crossWorkspace = { ...releaseFor(pack), artifact_refs: {
      ...releaseFor(pack).artifact_refs,
      assets: { ...releaseFor(pack).artifact_refs.assets, leaked: { ref: "https://frank.fail/assets/leaked", sha256: "a".repeat(64), public: true } },
    }, workspace_id: "other-workspace" };
    await rejectsWithCode(
      () => importFrankPublicRelease(fakeSupabase(), { release: crossWorkspace, importRequest: request }, { fetchPack: async () => pack }),
      "cross_workspace_data",
    );
  });

  it("rejects recursive source, prompt, provider, reviewer, PII, and secret fields", async () => {
    const pack = loadPack();
    const request = requestFor(pack);
    const forbidden = { ...releaseFor(pack), qa_decision: {
      ...releaseFor(pack).qa_decision,
      evidence: { prompt: "must not cross the public boundary", providerToken: "secret" },
    } };
    await rejectsWithCode(
      () => importFrankPublicRelease(fakeSupabase(), { release: forbidden, importRequest: request }, { fetchPack: async () => pack }),
      "sanitization_rejected",
    );

    const packWithPrivateField = { ...pack, privateSourceImages: ["private://source"] };
    const release = releaseFor(packWithPrivateField);
    const privateRequest = requestFor(packWithPrivateField);
    await rejectsWithCode(
      () => importFrankPublicRelease(fakeSupabase(), { release, importRequest: privateRequest }, { fetchPack: async () => packWithPrivateField }),
      "sanitization_rejected",
    );
  });

  it("rejects checksum drift and unknown assets before persistence", async () => {
    const pack = loadPack();
    const request = requestFor(pack);
    const release = releaseFor(pack);
    release.artifact_refs.template_pack.sha256 = "b".repeat(64);
    refreshReleaseHash(release);
    await rejectsWithCode(
      () => importFrankPublicRelease(fakeSupabase(), { release, importRequest: request }, { fetchPack: async () => pack }),
      "checksum_mismatch",
    );

    const withUnknownAsset = releaseFor(pack);
    withUnknownAsset.artifact_refs.assets.unknown = {
      ref: "https://frank.fail/assets/unknown",
      sha256: "c".repeat(64),
      public: true,
    };
    refreshReleaseHash(withUnknownAsset);
    await rejectsWithCode(
      () => importFrankPublicRelease(fakeSupabase(), { release: withUnknownAsset, importRequest: requestFor(pack) }, { fetchPack: async () => pack }),
      "unknown_asset",
    );
  });
});
