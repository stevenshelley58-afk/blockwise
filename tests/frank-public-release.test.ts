import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, sha256Hex } from "../packages/ad-template-pack-contract/src/index.ts";
import {
  frankPublicReleaseSchema,
  importFrankPublicRelease,
  type FrankPublicRelease,
} from "../src/lib/adstudio/frank-public-release.ts";
import type { ImportError } from "../src/lib/adstudio/import-pack.ts";

const FIXTURE_PATH = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "template-pack", "minimal-feed-story.json");
const GOLDEN_RELEASE_PATH = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "releases", "ad-template-generator-v1.json");
const PACK_URL = "https://frank.fail/packs/fixture-minimal.json";

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

  from(table: string): FakeQueryBuilder { return new FakeQueryBuilder(this, table); }

  insertInto(table: string, value: Row | Row[]): Row | Row[] {
    const values = Array.isArray(value) ? value : [value];
    const stored = values.map((row) => ({ id: row.id ?? `fake-${++this.sequence}`, created_at: row.created_at ?? new Date().toISOString(), ...row }));
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
  eq(column: string, value: unknown): this { this.filters.push([column, value]); return this; }
  insert(value: Row | Row[]): this { this.inserted = this.db.insertInto(this.table, value); return this; }
  maybeSingle(): Promise<{ data: Row | null; error: null }> { return Promise.resolve({ data: this.find() ?? null, error: null }); }
  single(): Promise<{ data: Row | null; error: null }> {
    const row = this.inserted !== undefined ? (Array.isArray(this.inserted) ? this.inserted[0] : this.inserted) : this.find();
    return Promise.resolve({ data: row ?? null, error: null });
  }
  private find(): Row | undefined { return (this.db.tables[this.table] ?? []).find((row) => this.filters.every(([column, value]) => row[column] === value)); }
}

function fakeSupabase(): SupabaseClient { return new FakeSupabase() as unknown as SupabaseClient; }
function loadPack(): Record<string, unknown> { return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>; }
function loadGoldenRelease(): FrankPublicRelease { return JSON.parse(readFileSync(GOLDEN_RELEASE_PATH, "utf8")) as FrankPublicRelease; }

function releaseFor(pack: Record<string, unknown>, overrides: Record<string, unknown> = {}): FrankPublicRelease {
  const now = new Date().toISOString();
  const base = {
    schema: "schema://frank.ad-template-generator-release/v1",
    tool_id: "ad-template-generator",
    scope: { kind: "project", id: "blockwise" },
    release_version: "1.0.0",
    release_id: "release-fixture-1",
    status: "released",
    settings_revision: 1,
    settings_ref: "settings/template-pack-v1",
    pipeline_id: "reference-clone-release",
    pipeline_version: "1.0.0",
    consumer_compatibility: ["blockwise-template-pack-v1"],
    template_pack: {
      schema: "blockwise.template-pack/v1",
      pack_id: String(pack.packId),
      artifact_ref: PACK_URL,
      sha256: sha256Hex(pack),
      signature_algorithm: "ed25519",
      signature: "fixture-signature",
    },
    provenance: { artifact_ref: PACK_URL, artifact_receipt_ref: "receipt/artifact-1" },
    trace_ref: "trace/release-1",
    qa_receipt: { decision: "pass", receipt_ref: "receipt/qa-1", checked_at: now },
    approval_receipt: { decision: "approved", gate: "native-pixel-human-approval", receipt_ref: "receipt/approval-1", decided_at: now },
    sanitization_receipt: { decision: "pass", receipt_ref: "receipt/sanitization-1", checked_at: now },
    released_at: now,
    immutable: true,
    source_free: true,
    ...overrides,
  };
  return { ...base, release_hash: sha256Hex(base) } as FrankPublicRelease;
}

function refreshReleaseHash(release: FrankPublicRelease): void {
  const { release_hash: _, ...withoutReleaseHash } = release;
  release.release_hash = sha256Hex(withoutReleaseHash);
}

async function rejectsWithCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => (error as ImportError).code === code);
}

describe("Frank TemplatePack public release consumer adapter", () => {
  it("matches the reviewed Frank golden release hash byte-for-byte", () => {
    const release = loadGoldenRelease();
    assert.equal(frankPublicReleaseSchema.safeParse(release).success, true);
    const { release_hash: _, ...withoutReleaseHash } = release;
    assert.equal(sha256Hex(withoutReleaseHash), "793f20dee498be21c417a55e6a8822368359985e13b55abb06f6da82b8c9100f");
    assert.equal(release.template_pack.artifact_ref, release.provenance.artifact_ref);
  });

  it("accepts the exact producer envelope and imports its one nested TemplatePack artifact", async () => {
    const pack = loadPack();
    const release = releaseFor(pack);
    assert.equal(frankPublicReleaseSchema.safeParse(release).success, true);
    const supabase = fakeSupabase();
    const receipt = await importFrankPublicRelease(supabase, {
      release,
      importRequest: { nonce: randomUUID() },
    }, { fetchPack: async (url) => { assert.equal(url, PACK_URL); return pack; } });

    assert.equal(receipt.status, "active");
    const db = supabase as unknown as FakeSupabase;
    assert.equal(db.tables.ad_template_packs.length, 1);
    assert.deepEqual(db.tables.ad_import_receipts[0]!.receipt, release);
  });

  it("uses JCS Unicode and 1.0/1 equivalence and detects release tampering", () => {
    const left = { label: "café", version: 1.0 };
    const right = JSON.parse('{"version":1,"label":"caf\\u00e9"}') as Record<string, unknown>;
    assert.equal(canonicalJson(left), canonicalJson(right));
    assert.equal(sha256Hex(left), sha256Hex(right));

    const release = releaseFor(loadPack());
    const { release_hash: releaseHash, ...withoutReleaseHash } = release;
    assert.equal(releaseHash, sha256Hex(withoutReleaseHash));
    assert.notEqual(releaseHash, sha256Hex({ ...withoutReleaseHash, release_id: "tampered" }));
  });

  it("rejects mutable drafts, forbidden recursive fields, and workspace mismatches", async () => {
    const pack = loadPack();
    const draft = releaseFor(pack, { draft: true });
    await rejectsWithCode(() => importFrankPublicRelease(fakeSupabase(), { release: draft, importRequest: { nonce: randomUUID() } }, { fetchPack: async () => pack }), "mutable_draft_rejected");

    const forbidden = releaseFor(pack, { provenance: { artifact_ref: PACK_URL, artifact_receipt_ref: "receipt/1", nested: { prompt: "private" } } });
    await rejectsWithCode(() => importFrankPublicRelease(fakeSupabase(), { release: forbidden, importRequest: { nonce: randomUUID() } }, { fetchPack: async () => pack }), "sanitization_rejected");

    const workspace = releaseFor(pack, { scope: { kind: "workspace", id: "workspace-a" } });
    await rejectsWithCode(() => importFrankPublicRelease(fakeSupabase(), { release: workspace, importRequest: { nonce: randomUUID() }, workspaceId: "workspace-b" }, { fetchPack: async () => pack }), "cross_workspace_data");
  });

  it("rejects stale release hashes, provenance ref drift, and unknown pack identity", async () => {
    const pack = loadPack();
    const tampered = releaseFor(pack);
    tampered.release_id = "tampered";
    await rejectsWithCode(() => importFrankPublicRelease(fakeSupabase(), { release: tampered, importRequest: { nonce: randomUUID() } }, { fetchPack: async () => pack }), "checksum_mismatch");

    const drift = releaseFor(pack, { provenance: { artifact_ref: "https://frank.fail/other-pack.json", artifact_receipt_ref: "receipt/1" } });
    refreshReleaseHash(drift);
    await rejectsWithCode(() => importFrankPublicRelease(fakeSupabase(), { release: drift, importRequest: { nonce: randomUUID() } }, { fetchPack: async () => pack }), "artifact_binding_mismatch");

    const wrongPack = releaseFor(pack, { template_pack: { ...releaseFor(pack).template_pack, pack_id: "other-pack" } });
    refreshReleaseHash(wrongPack);
    await rejectsWithCode(() => importFrankPublicRelease(fakeSupabase(), { release: wrongPack, importRequest: { nonce: randomUUID() } }, { fetchPack: async () => pack }), "pack_id_mismatch");
  });
});
