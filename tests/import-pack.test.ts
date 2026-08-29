import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, generateKeyPairSync, sign as ed25519Sign, createHash, type KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeManifestHash, sha256Hex } from "../packages/ad-template-pack-contract/src/index.ts";
import {
  importTemplatePack,
  requireCompleteReleaseProvenance,
  type ImportRequest,
  type ImportError,
} from "../src/lib/adstudio/import-pack.ts";

// ---------------------------------------------------------------------------
// Local fixture — no live Frank URL required. The importer is handed the pack
// through the documented test-only `fetchPack` injection point, which skips
// only the HTTPS + origin allowlist (the caller vouches for the source).
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

function loadFixture(): Record<string, unknown> {
  const pack = loadLegacyFixture();
  pack.schema = "blockwise.template-pack/v2";
  pack.metadata = {
    title: "Fixture", description: "Layered fixture",
    gallerySamples: {
      feed: { assetKey: "feed-sample", placement: "feed", purpose: "gallery_sample" },
      story: { assetKey: "story-sample", placement: "story", purpose: "gallery_sample" },
    },
    metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
    aiWritingGuidance: { summary: "Use verified claims only.", fields: {} },
    publishRequirements: {
      objective: "OUTCOME_LEADS", specialAdCategory: null,
      instantForm: { required: false, dependency: null },
      destination: { required: false, kind: "none", dependency: null },
    },
    replacementAssets: [], realAssetRefs: [],
  };
  return sealPlaceholder(pack);
}

function loadLegacyFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
}

function sealPlaceholder(pack: Record<string, unknown>): Record<string, unknown> {
  pack.manifestSha256 = computeManifestHash(pack);
  return pack;
}

function v2Pack(bytes: Uint8Array, packId: string): { pack: Record<string, unknown>; assetUrl: string } {
  const pack = loadFixture();
  const assetUrl = "https://frank.fail/releases/ad-template-generator/fixture-release/assets/logo.png";
  pack.schema = "blockwise.template-pack/v2";
  pack.packId = packId;
  pack.assets = { logo: { fileName: "logo.png", sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png" } };
  pack.metadata = {
    title: "Fixture", description: "Fixture",
    gallerySamples: { feed: { assetKey: "logo", placement: "feed", purpose: "gallery_sample", url: assetUrl }, story: { assetKey: "logo", placement: "story", purpose: "gallery_sample", url: assetUrl } },
    metaCopyDefaults: { primaryText: [], headlines: [], descriptions: [], cta: "LEARN_MORE" },
    aiWritingGuidance: { summary: "", fields: {} },
    publishRequirements: { objective: "leads", specialAdCategory: null, instantForm: { required: false, dependency: null }, destination: { required: true, kind: "url", dependency: null } },
    replacementAssets: [], realAssetRefs: [],
  };
  return { pack: sealPlaceholder(pack), assetUrl };
}

function makeRequest(
  pack: Record<string, unknown>,
  overrides: Partial<ImportRequest> = {},
): ImportRequest {
  return {
    packUrl: "https://frank.fail/releases/ad-template-generator/fixture-release/pack-v2/fixture-minimal.json",
    packSha256: sha256Hex(pack),
    packId: "fixture-minimal-v1",
    buildId: "fixture-build-1",
    issuedAt: new Date().toISOString(),
    nonce: randomUUID(),
    signature: "fixture-ed25519-signature-placeholder",
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the Supabase surface the importer uses.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeSupabase {
  tables: Record<string, Row[]> = {
    ad_import_receipts: [],
    ad_import_nonces: [],
    ad_template_packs: [],
    ad_template_pack_versions: [],
    ad_template_assets: [],
  };
  uploaded: Array<{ bucket: string; path: string; bytes: Uint8Array; options: Record<string, unknown> }> = [];
  objects = new Map<string, Uint8Array>();
  activationError: string | null = null;
  private seq = 0;

  from(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, options: Record<string, unknown>) => {
        if (this.objects.has(path) && options.upsert === false) {
          return { data: null, error: { message: "The resource already exists" } };
        }
        this.objects.set(path, Uint8Array.from(bytes));
        this.uploaded.push({ bucket, path, bytes, options });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const bytes = this.objects.get(path);
        return bytes
          ? { data: new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer]), error: null }
          : { data: null, error: { message: "The resource was not found" } };
      },
    }),
  };

  async rpc(name: string, args: Record<string, unknown>) {
    if (name !== "activate_ad_template_pack_import") {
      return { data: null, error: { message: `Unknown RPC ${name}` } };
    }
    if (this.activationError) return { data: null, error: { message: this.activationError } };
    const receiptInput = args.p_receipt as Row;
    const packInput = args.p_pack as Row;
    const assets = args.p_assets as Row[];
    const existing = this.tables.ad_import_receipts.find(row => row.pack_id === receiptInput.pack_id);
    if (existing) {
      if (existing.pack_sha256 !== receiptInput.pack_sha256) {
        return { data: null, error: { message: "pack_id_conflict" } };
      }
      return {
        data: {
          id: existing.id,
          pack_id: existing.pack_id,
          pack_sha256: existing.pack_sha256,
          created_at: existing.created_at,
          replayed: true,
        },
        error: null,
      };
    }
    if (this.tables.ad_import_nonces.some(row => row.nonce === receiptInput.nonce)) {
      return { data: null, error: { message: "nonce_replay" } };
    }

    const createdAt = new Date().toISOString();
    const receipt: Row = {
      id: `row-${++this.seq}`,
      pack_id: receiptInput.pack_id,
      pack_sha256: receiptInput.pack_sha256,
      build_id: receiptInput.build_id,
      issuer: receiptInput.issuer,
      issued_at: receiptInput.issued_at,
      nonce: receiptInput.nonce,
      signature: receiptInput.signature,
      status: "active",
      receipt: receiptInput.receipt,
      created_at: createdAt,
    };
    this.tables.ad_import_nonces.push({ nonce: receiptInput.nonce, used_at: createdAt });
    this.tables.ad_template_packs.push({
      id: `row-${++this.seq}`,
      pack_id: packInput.pack_id,
      template_id: packInput.template_id,
      version: packInput.version,
      schema_version: packInput.schema_version,
      manifest_sha256: packInput.manifest_sha256,
      signature: packInput.signature,
      pack_json: packInput.pack_json,
      created_at: createdAt,
    });
    this.tables.ad_template_pack_versions.push({
      id: `row-${++this.seq}`,
      pack_id: packInput.pack_id,
      version: packInput.version,
      manifest_sha256: packInput.manifest_sha256,
      pack_json: packInput.pack_json,
      created_at: createdAt,
    });
    this.tables.ad_template_assets.push(...assets.map(asset => ({
      id: `row-${++this.seq}`,
      pack_id: packInput.pack_id,
      ...asset,
      created_at: createdAt,
    })));
    this.tables.ad_import_receipts.push(receipt);
    return {
      data: {
        id: receipt.id,
        pack_id: receipt.pack_id,
        pack_sha256: receipt.pack_sha256,
        created_at: receipt.created_at,
        replayed: false,
      },
      error: null,
    };
  }

  insertInto(table: string, value: Row | Row[]): Row | Row[] {
    const rows = Array.isArray(value) ? value : [value];
    const stored = rows.map((r) => {
      const row: Row = { ...r };
      if (row.id === undefined) row.id = `row-${++this.seq}`;
      if (row.created_at === undefined) row.created_at = new Date().toISOString();
      (this.tables[table] ??= []).push(row);
      return row;
    });
    return Array.isArray(value) ? stored : stored[0];
  }
}

class FakeQueryBuilder {
  private filters: Array<[string, unknown]> = [];
  private inserted?: Row | Row[];
  private db: FakeSupabase;
  private table: string;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  insert(value: Row | Row[]): this {
    // Commit immediately: the importer sometimes awaits `insert(...)` without
    // a terminal `.single()` (nonce, pack, version, assets), and sometimes
    // chains `.select(...).single()` (receipt). Both must observe the row.
    this.inserted = this.db.insertInto(this.table, value);
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.find() ?? null, error: null });
  }

  single(): Promise<{ data: Row | null; error: null }> {
    if (this.inserted !== undefined) {
      const row = Array.isArray(this.inserted) ? this.inserted[0] : this.inserted;
      return Promise.resolve({ data: row, error: null });
    }
    return Promise.resolve({ data: this.find() ?? null, error: null });
  }

  private find(): Row | undefined {
    const rows = this.db.tables[this.table] ?? [];
    return rows.find((r) => this.filters.every(([col, val]) => r[col] === val));
  }
}

function fakeSupabase(): SupabaseClient {
  return new FakeSupabase() as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Ed25519 test helpers — a throwaway keypair whose public half plays the
// role of FRANK_PACK_PUBLIC_KEY, and a signer over manifestSha256.
// ---------------------------------------------------------------------------

function ed25519Keypair(): { publicKeyHex: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { publicKeyHex, privateKey };
}

function signManifest(pack: Record<string, unknown>, privateKey: KeyObject): string {
  pack.manifestSha256 = computeManifestHash(pack);
  const signature = ed25519Sign(null, Buffer.from(String(pack.manifestSha256), "utf-8"), privateKey).toString("hex");
  pack.signature = signature;
  return signature;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("import-pack — local fixture import (no live Frank URL)", () => {
  it("imports a minimal Feed+Story pack from a fixture and persists both layouts", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack);

    const receipt = await importTemplatePack(supabase, input, {
      fetchPack: async () => pack, // fixture bytes from disk — no network
    });

    assert.equal(receipt.status, "active");
    assert.equal(receipt.packId, "fixture-minimal-v1");
    assert.equal(receipt.packSha256, input.packSha256);

    // Receipt row persisted
    assert.equal(supabaseTables(supabase).ad_import_receipts.length, 1);
    assert.equal(supabaseTables(supabase).ad_import_receipts[0].pack_id, "fixture-minimal-v1");

    // Both layouts present in the persisted pack
    const stored = supabaseTables(supabase).ad_template_packs[0].pack_json as Record<string, unknown>;
    const feed = stored.feedLayout as { placement: string; layers: unknown[] };
    const story = stored.storyLayout as { placement: string; layers: unknown[] };
    assert.equal(feed.placement, "feed");
    assert.equal(story.placement, "story");
    assert.ok(feed.layers.length >= 1, "feed layout must have at least one layer");
    assert.ok(story.layers.length >= 1, "story layout must have at least one layer");
    assert.equal(stored.templateId, "fixture-minimal");

    // Version history row
    const versions = supabaseTables(supabase).ad_template_pack_versions;
    assert.equal(versions.length, 1);
    assert.equal(versions[0].version, 1);
  });

  it("returns a replayed receipt for the same pack hash (idempotency)", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack);

    const first = await importTemplatePack(supabase, input, { fetchPack: async () => pack });
    const second = await importTemplatePack(supabase, input, { fetchPack: async () => pack });

    assert.equal(first.status, "active");
    assert.equal(second.status, "replayed");
    assert.equal(second.receiptId, first.receiptId);
  });

  it("persists and replays only sanitized Frank run provenance", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, {
      runId: "run-20260824-01",
      releaseId: "meta-portfolio-abcdef12",
      traceRef: "hermes://ad-template-generator/runs/run-20260824-01",
      qaReceiptRef: "meta-portfolio-abcdef12/qa-evidence.json",
      approvalReceiptRef: "meta-portfolio-abcdef12/approval.json",
      sanitizationReceiptRef: "meta-portfolio-abcdef12/sanitization.json",
    });

    const first = await importTemplatePack(supabase, input, { fetchPack: async () => pack });
    assert.deepEqual(first.provenance, {
      runId: "run-20260824-01",
      releaseId: "meta-portfolio-abcdef12",
      traceRef: "hermes://ad-template-generator/runs/run-20260824-01",
      qaReceiptRef: "meta-portfolio-abcdef12/qa-evidence.json",
      approvalReceiptRef: "meta-portfolio-abcdef12/approval.json",
      sanitizationReceiptRef: "meta-portfolio-abcdef12/sanitization.json",
    });

    const storedReceipt = supabaseTables(supabase).ad_import_receipts[0]!.receipt as Record<string, unknown>;
    assert.equal(storedReceipt.schema, "blockwise.ad-template-import-receipt.v1");
    assert.equal((storedReceipt.provenance as Record<string, unknown>).runId, "run-20260824-01");
    assert.equal((storedReceipt as Record<string, unknown>).sourceAd, undefined);
    assert.equal((storedReceipt as Record<string, unknown>).promptHistory, undefined);

    const replay = await importTemplatePack(supabase, input, { fetchPack: async () => pack });
    assert.equal(replay.status, "replayed");
    assert.deepEqual(replay.provenance, first.provenance);
  });

  it("rejects control characters in Frank provenance refs before activation", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { traceRef: "hermes://runs/\u0000bad" });

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPack: async () => pack }),
      (err: unknown) => (err as ImportError).code === "invalid_provenance",
    );
    assert.equal(supabaseTables(supabase).ad_import_receipts.length, 0);
  });

  it("rejects a replayed nonce", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { nonce: "fixed-nonce" });

    const first = await importTemplatePack(supabase, input, { fetchPack: async () => pack });
    assert.equal(first.status, "active");

    // Same nonce with a different pack (so idempotency doesn't short-circuit)
    const other = loadFixture();
    other.templateId = "fixture-minimal-2";
    other.packId = "fixture-minimal-v2";
    const replay = makeRequest(other, { nonce: "fixed-nonce", packId: "fixture-minimal-v2" });

    await assert.rejects(
      importTemplatePack(supabase, replay, { fetchPack: async () => other }),
      (err: unknown) => (err as ImportError).code === "nonce_replay",
    );
  });

  it("rejects a pack whose sha256 does not match the request", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { packSha256: "f".repeat(64) });

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPack: async () => pack }),
      (err: unknown) => (err as ImportError).code === "hash_mismatch",
    );
    assert.equal(supabaseTables(supabase).ad_import_nonces.length, 0, "validation failures must not consume the nonce");
  });

  it("rejects a pack that fails schema validation", async () => {
    const supabase = fakeSupabase();
    const bad = { schema: "blockwise.template-pack/v1", templateId: "" } as Record<string, unknown>;
    const input = makeRequest(bad);

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPack: async () => bad }),
      (err: unknown) => (err as ImportError).code === "schema_invalid",
    );
  });

  it("refuses an otherwise valid historical v1 pack", async () => {
    const supabase = fakeSupabase();
    const legacy = loadLegacyFixture();
    const input = makeRequest(legacy);

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPack: async () => legacy }),
      (err: unknown) => (err as ImportError).code === "layered_v2_required",
    );
    assert.equal(supabaseTables(supabase).ad_template_packs.length, 0);
  });

  it("still enforces the origin allowlist when no fetchPack is injected", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { packUrl: "https://evil.example.com/pack.json" });

    await assert.rejects(
      importTemplatePack(supabase, input),
      (err: unknown) => (err as ImportError).code === "origin_not_allowed",
    );
  });

  it("rejects an issuedAt outside the ±5 minute window", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, {
      issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPack: async () => pack }),
      (err: unknown) => (err as ImportError).code === "timestamp_expired",
    );
  });
});

describe("import-pack — Ed25519 signature verification (FRANK_PACK_PUBLIC_KEY)", () => {
  it("accepts a valid signature over the manifest hash (roundtrip)", async () => {
    const { publicKeyHex, privateKey } = ed25519Keypair();
    process.env.FRANK_PACK_PUBLIC_KEY = publicKeyHex;
    try {
      const supabase = fakeSupabase();
      const pack = loadFixture();
      const input = makeRequest(pack, { signature: signManifest(pack, privateKey), packSha256: sha256Hex(pack) });

      const receipt = await importTemplatePack(supabase, input, {
        fetchPack: async () => pack,
      });

      assert.equal(receipt.status, "active");
      // The verified signature is what the receipt row records.
      const stored = supabaseTables(supabase).ad_import_receipts[0];
      assert.equal(stored.signature, input.signature);
    } finally {
      delete process.env.FRANK_PACK_PUBLIC_KEY;
    }
  });

  it("rejects a tampered pack — signature over different bytes", async () => {
    const { publicKeyHex, privateKey } = ed25519Keypair();
    process.env.FRANK_PACK_PUBLIC_KEY = publicKeyHex;
    try {
      const supabase = fakeSupabase();
      const pack = loadFixture();
      const signature = signManifest(pack, privateKey);

      const tampered = structuredClone(pack) as Record<string, unknown>;
      tampered.templateId = "fixture-minimal-TAMPERED";
      tampered.manifestSha256 = computeManifestHash(tampered);

      // The request hashes the tampered pack (hash check passes); only the
      // signature is stale, so the failure must be signature_rejected.
      const input = makeRequest(tampered, { signature, packSha256: sha256Hex(tampered) });

      await assert.rejects(
        importTemplatePack(supabase, input, { fetchPack: async () => tampered }),
        (err: unknown) => (err as ImportError).code === "signature_rejected",
      );
    } finally {
      delete process.env.FRANK_PACK_PUBLIC_KEY;
    }
  });

  it("rejects a valid-looking signature from the wrong key", async () => {
    const other = ed25519Keypair();
    process.env.FRANK_PACK_PUBLIC_KEY = other.publicKeyHex;
    try {
      const supabase = fakeSupabase();
      const pack = loadFixture();
      // Signed with a DIFFERENT key than the configured FRANK_PACK_PUBLIC_KEY.
      const rogue = ed25519Keypair();
      const signature = signManifest(pack, rogue.privateKey);
      const input = makeRequest(pack, { signature, packSha256: sha256Hex(pack) });

      await assert.rejects(
        importTemplatePack(supabase, input, { fetchPack: async () => pack }),
        (err: unknown) => (err as ImportError).code === "signature_rejected",
      );
    } finally {
      delete process.env.FRANK_PACK_PUBLIC_KEY;
    }
  });

  it("refuses the production (live-fetch) route when FRANK_PACK_PUBLIC_KEY is unset", async () => {
    delete process.env.FRANK_PACK_PUBLIC_KEY;
    const supabase = fakeSupabase();
    const pack = loadFixture();
    // Allowlisted origin + NO injected fetchPack -> the real production route.
    // The key guard fires before any network fetch (fail fast, no egress).
    const input = makeRequest(pack, { packUrl: "https://frank.fail/packs/fixture-minimal.json" });

    await assert.rejects(
      importTemplatePack(supabase, input),
      (err: unknown) => (err as ImportError).code === "missing_public_key",
    );
  });

  it("skips the signature check on the injected fetchPack path when no key is set", async () => {
    delete process.env.FRANK_PACK_PUBLIC_KEY;
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { signature: "fixture-ed25519-signature-placeholder" });

    const receipt = await importTemplatePack(supabase, input, {
      fetchPack: async () => pack, // caller vouches for the source — documented test-only skip
    });
    assert.equal(receipt.status, "active");
  });
});

describe("import-pack — pure helpers", () => {
  it("sha256 hashing is deterministic", () => {
    const obj = { foo: "bar", num: 1 };
    const h1 = sha256Hex(obj);
    const h2 = sha256Hex(structuredClone(obj));
    assert.equal(h1, h2);
  });

  it("requires the complete production release provenance chain", () => {
    assert.doesNotThrow(() => requireCompleteReleaseProvenance({
      runId: "trun_123",
      releaseId: "release_123",
      traceRef: "trace:123",
      qaReceiptRef: "qa:123",
      approvalReceiptRef: "approval:123",
      sanitizationReceiptRef: "sanitization:123",
    }));
    assert.throws(
      () => requireCompleteReleaseProvenance({ runId: "trun_123" }),
      (err: unknown) => (err as ImportError).code === "release_provenance_incomplete",
    );
  });
});

describe("import-pack — v2 asset verification", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

  it("fetches, verifies, uploads, and records v2 asset storage paths", async () => {
    const supabase = fakeSupabase();
    const { pack, assetUrl } = v2Pack(png, "fixture-v2-assets");
    const input = makeRequest(pack, { packId: "fixture-v2-assets", packUrl: "https://frank.fail/releases/ad-template-generator/fixture-release/pack-v2/fixture.json" });
    const receipt = await importTemplatePack(supabase, input, {
      fetchPack: async () => pack,
      fetchAsset: async (url) => { assert.equal(url, assetUrl); return png; },
    });
    assert.equal(receipt.status, "active");
    const fake = supabase as unknown as FakeSupabase;
    assert.equal(fake.uploaded.length, 1);
    assert.equal(fake.uploaded[0]!.options.upsert, false);
    assert.match(String(fake.uploaded[0]!.path), /^templates\/fixture-v2-assets\/logo-/);
    assert.equal(fake.tables.ad_template_assets[0]!.storage_path, fake.uploaded[0]!.path);
  });

  it("leaves no database rows or consumed nonce when transactional activation fails", async () => {
    const supabase = fakeSupabase();
    const fake = supabase as unknown as FakeSupabase;
    fake.activationError = "simulated transaction rollback";
    const { pack, assetUrl } = v2Pack(png, "fixture-v2-rollback");
    const input = makeRequest(pack, {
      packId: "fixture-v2-rollback",
      packUrl: "https://frank.fail/releases/ad-template-generator/fixture-release/pack-v2/fixture.json",
    });

    await assert.rejects(
      importTemplatePack(supabase, input, {
        fetchPack: async () => pack,
        fetchAsset: async (url) => { assert.equal(url, assetUrl); return png; },
      }),
      (err: unknown) => (err as ImportError).code === "activation_failed",
    );
    assert.equal(fake.tables.ad_import_receipts.length, 0);
    assert.equal(fake.tables.ad_import_nonces.length, 0);
    assert.equal(fake.tables.ad_template_packs.length, 0);
    assert.equal(fake.tables.ad_template_pack_versions.length, 0);
    assert.equal(fake.tables.ad_template_assets.length, 0);
  });

  it("fails closed on tampered asset bytes before activation", async () => {
    const supabase = fakeSupabase();
    const { pack } = v2Pack(png, "fixture-v2-tamper");
    const input = makeRequest(pack, { packId: "fixture-v2-tamper", packUrl: "https://frank.fail/releases/ad-template-generator/fixture-release/pack-v2/fixture.json" });
    await assert.rejects(importTemplatePack(supabase, input, {
      fetchPack: async () => pack, fetchAsset: async () => new Uint8Array([...png.slice(0, -1), 1]),
    }), (err: unknown) => (err as ImportError).code === "asset_hash_mismatch");
    const fake = supabase as unknown as FakeSupabase;
    assert.equal(fake.tables.ad_import_receipts.length, 0);
    assert.equal(fake.uploaded.length, 0);
  });

  it("rejects redirects and assets outside the signed release origin/subtree", async () => {
    const supabase = fakeSupabase();
    const { pack } = v2Pack(png, "fixture-v2-origin");
    const metadata = pack.metadata as Record<string, any>;
    metadata.gallerySamples.feed.url = "https://evil.example/logo.png";
    metadata.gallerySamples.story.url = "https://evil.example/logo.png";
    sealPlaceholder(pack);
    const input = makeRequest(pack, { packId: "fixture-v2-origin", packUrl: "https://frank.fail/releases/ad-template-generator/fixture-release/pack-v2/fixture.json" });
    await assert.rejects(importTemplatePack(supabase, input, {
      fetchPack: async () => pack, fetchAsset: async () => new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
    }), (err: unknown) => (err as ImportError).code === "asset_url_missing");
    assert.equal((supabase as unknown as FakeSupabase).tables.ad_import_receipts.length, 0);

    const redirectDb = fakeSupabase();
    const valid = v2Pack(png, "fixture-v2-redirect").pack;
    const redirectInput = makeRequest(valid, { packId: "fixture-v2-redirect", packUrl: "https://frank.fail/releases/ad-template-generator/fixture-release/pack-v2/fixture.json" });
    await assert.rejects(importTemplatePack(redirectDb, redirectInput, {
      fetchPack: async () => valid, fetchAsset: async () => new Response(null, { status: 302 }),
    }), (err: unknown) => (err as ImportError).code === "redirect_not_allowed");
  });
});

// Helper to reach the fake's tables through the SupabaseClient-typed handle.
function supabaseTables(supabase: SupabaseClient): FakeSupabase["tables"] {
  return (supabase as unknown as FakeSupabase).tables;
}
