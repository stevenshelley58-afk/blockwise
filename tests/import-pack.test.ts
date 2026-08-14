import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID, generateKeyPairSync, sign as ed25519Sign, type KeyObject } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, sha256Hex } from "../packages/ad-template-pack-contract/src/index.ts";
import {
  importTemplatePack,
  type ImportRequest,
  type ImportError,
} from "../src/lib/adstudio/import-pack.ts";

// ---------------------------------------------------------------------------
// Local fixture — no live Frank URL required. The importer is handed the pack
// through the documented test-only `fetchPackBytes` injection point, which skips
// only the HTTPS + origin allowlist (the caller vouches for the source).
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

function loadFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
}

function packBytes(pack: unknown): Uint8Array {
  return Buffer.from(canonicalJson(pack), "utf8");
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeRequest(
  pack: Record<string, unknown>,
  overrides: Partial<ImportRequest> = {},
): ImportRequest {
  return {
    packUrl: "https://frank.fail/packs/fixture-minimal.json",
    packSha256: rawSha256(packBytes(pack)),
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
  private seq = 0;

  from(table: string): FakeQueryBuilder {
    return new FakeQueryBuilder(this, table);
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
// role of FRANK_PACK_PUBLIC_KEY, and a signer over the CANONICAL JSON bytes
// (the exact wire format the Frank factory signs).
// ---------------------------------------------------------------------------

function ed25519Keypair(): { publicKeyHex: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return { publicKeyHex, privateKey };
}

function signCanonical(pack: unknown, privateKey: KeyObject): string {
  return ed25519Sign(null, Buffer.from(canonicalJson(pack), "utf-8"), privateKey).toString("hex");
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
      fetchPackBytes: async () => packBytes(pack), // declared fixture bytes — no network
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

    const first = await importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) });
    const second = await importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) });

    assert.equal(first.status, "active");
    assert.equal(second.status, "replayed");
    assert.equal(second.receiptId, first.receiptId);
  });

  it("rejects a replayed nonce", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { nonce: "fixed-nonce" });

    const first = await importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) });
    assert.equal(first.status, "active");

    // Same nonce with a different pack (so idempotency doesn't short-circuit)
    const other = loadFixture();
    other.templateId = "fixture-minimal-2";
    other.packId = "fixture-minimal-v2";
    const replay = makeRequest(other, { nonce: "fixed-nonce", packId: "fixture-minimal-v2" });

    await assert.rejects(
      importTemplatePack(supabase, replay, { fetchPackBytes: async () => packBytes(other) }),
      (err: unknown) => (err as ImportError).code === "nonce_replay",
    );
  });

  it("rejects a pack whose sha256 does not match the request", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { packSha256: "f".repeat(64) });

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) }),
      (err: unknown) => (err as ImportError).code === "hash_mismatch",
    );
  });

  it("authenticates the exact declared artifact bytes rather than re-serialized JSON", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const prettyBytes = Buffer.from(JSON.stringify(pack, null, 2), "utf8");
    const input = makeRequest(pack, { packSha256: rawSha256(prettyBytes) });

    const receipt = await importTemplatePack(supabase, input, {
      fetchPackBytes: async () => prettyBytes,
    });
    assert.equal(receipt.packSha256, rawSha256(prettyBytes));

    const differentBytes = Buffer.from(`${JSON.stringify(pack)}\n`, "utf8");
    const mismatch = makeRequest(pack);
    await assert.rejects(
      importTemplatePack(fakeSupabase(), mismatch, { fetchPackBytes: async () => differentBytes }),
      (err: unknown) => (err as ImportError).code === "hash_mismatch",
    );
  });

  it("hashes raw bytes before parsing JSON", async () => {
    const invalidBytes = Buffer.from("{not-json", "utf8");
    const input = makeRequest(loadFixture(), { packSha256: rawSha256(invalidBytes) });

    await assert.rejects(
      importTemplatePack(fakeSupabase(), input, { fetchPackBytes: async () => invalidBytes }),
      (err: unknown) => (err as ImportError).code === "invalid_json",
    );
  });

  it("rejects a pack that fails schema validation", async () => {
    const supabase = fakeSupabase();
    const bad = { schema: "blockwise.template-pack/v1", templateId: "" } as Record<string, unknown>;
    const input = makeRequest(bad);

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(bad) }),
      (err: unknown) => (err as ImportError).code === "schema_invalid",
    );
  });

  it("rejects TemplatePack identity confusion before recording a nonce or pack", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { packId: "different-pack-v1" });

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) }),
      (err: unknown) => (err as ImportError).code === "pack_id_mismatch",
    );
    assert.equal(supabaseTables(supabase).ad_import_nonces.length, 0);
    assert.equal(supabaseTables(supabase).ad_template_packs.length, 0);
  });

  it("still enforces the origin allowlist when no fetchPackBytes is injected", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { packUrl: "https://evil.example.com/pack.json" });

    await assert.rejects(
      importTemplatePack(supabase, input),
      (err: unknown) => (err as ImportError).code === "origin_not_allowed",
    );
  });

  it("disables raw fixture injection in production", async () => {
    const mutableEnv = process.env as Record<string, string | undefined>;
    const originalNodeEnv = process.env.NODE_ENV;
    mutableEnv.NODE_ENV = "production";
    try {
      const pack = loadFixture();
      await assert.rejects(
        importTemplatePack(fakeSupabase(), makeRequest(pack), { fetchPackBytes: async () => packBytes(pack) }),
        (err: unknown) => (err as ImportError).code === "fixture_injection_disabled",
      );
    } finally {
      if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = originalNodeEnv;
    }
  });

  it("rejects an issuedAt outside the ±5 minute window", async () => {
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, {
      issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    });

    await assert.rejects(
      importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) }),
      (err: unknown) => (err as ImportError).code === "timestamp_expired",
    );
  });
});

describe("import-pack — Ed25519 signature verification (FRANK_PACK_PUBLIC_KEY)", () => {
  it("production fetches once and authenticates the exact bounded response bytes", async () => {
    const { publicKeyHex, privateKey } = ed25519Keypair();
    const originalFetch = globalThis.fetch;
    process.env.FRANK_PACK_PUBLIC_KEY = publicKeyHex;
    try {
      const pack = loadFixture();
      const rawBytes = Buffer.from(JSON.stringify(pack, null, 2), "utf8");
      const input = makeRequest(pack, {
        packSha256: rawSha256(rawBytes),
        signature: signCanonical(pack, privateKey),
      });
      let fetchCount = 0;
      globalThis.fetch = async () => {
        fetchCount += 1;
        return new Response(rawBytes, {
          status: 200,
          headers: { "content-length": String(rawBytes.byteLength), "content-type": "application/json" },
        });
      };

      const receipt = await importTemplatePack(fakeSupabase(), input);
      assert.equal(receipt.packSha256, rawSha256(rawBytes));
      assert.equal(fetchCount, 1);
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.FRANK_PACK_PUBLIC_KEY;
    }
  });

  it("accepts a valid signature over the canonical pack JSON (roundtrip)", async () => {
    const { publicKeyHex, privateKey } = ed25519Keypair();
    process.env.FRANK_PACK_PUBLIC_KEY = publicKeyHex;
    try {
      const supabase = fakeSupabase();
      const pack = loadFixture();
      const input = makeRequest(pack, { signature: signCanonical(pack, privateKey) });

      const receipt = await importTemplatePack(supabase, input, {
        fetchPackBytes: async () => packBytes(pack),
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
      const signature = signCanonical(pack, privateKey); // over the ORIGINAL bytes

      const tampered = structuredClone(pack) as Record<string, unknown>;
      tampered.templateId = "fixture-minimal-TAMPERED";

      // The request hashes the tampered pack (hash check passes); only the
      // signature is stale, so the failure must be signature_rejected.
      const input = makeRequest(tampered, { signature });

      await assert.rejects(
        importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(tampered) }),
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
      const input = makeRequest(pack, { signature: signCanonical(pack, rogue.privateKey) });

      await assert.rejects(
        importTemplatePack(supabase, input, { fetchPackBytes: async () => packBytes(pack) }),
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
    // Allowlisted origin + NO injected fetchPackBytes -> the real production route.
    // The key guard fires before any network fetch (fail fast, no egress).
    const input = makeRequest(pack, { packUrl: "https://frank.fail/packs/fixture-minimal.json" });

    await assert.rejects(
      importTemplatePack(supabase, input),
      (err: unknown) => (err as ImportError).code === "missing_public_key",
    );
  });

  it("skips the signature check on the injected raw-byte fixture path when no key is set", async () => {
    delete process.env.FRANK_PACK_PUBLIC_KEY;
    const supabase = fakeSupabase();
    const pack = loadFixture();
    const input = makeRequest(pack, { signature: "fixture-ed25519-signature-placeholder" });

    const receipt = await importTemplatePack(supabase, input, {
      fetchPackBytes: async () => packBytes(pack), // caller declares exact fixture bytes
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
});

// Helper to reach the fake's tables through the SupabaseClient-typed handle.
function supabaseTables(supabase: SupabaseClient): FakeSupabase["tables"] {
  return (supabase as unknown as FakeSupabase).tables;
}
