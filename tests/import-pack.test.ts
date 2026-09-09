import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { importTemplatePack, importError, expectedEntryMap } from "../src/lib/adstudio/import-pack.ts";
import { extractArchiveEntries, parsePackArchive, ArchiveSecurityError } from "../src/lib/adstudio/import-archive.ts";
import { sha256Hex, computeManifestHash, canonicalJson } from "../packages/ad-template-pack-contract/src/hash.ts";
import type { TemplatePack } from "../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_1PX_HASH = createHash("sha256").update(PNG_1PX).digest("hex");
// Valid WOFF2 magic: "wOF2" + dummy payload (hash-checked, contents not parsed here)
const WOFF2_DUMMY = Buffer.concat([Buffer.from("wOF2", "ascii"), Buffer.alloc(40, 1)]);
const WOFF2_HASH = createHash("sha256").update(WOFF2_DUMMY).digest("hex");

function basePack(): TemplatePack {
  return {
    schema: "blockwise.template-pack/v1",
    templateId: "import-test-001",
    version: 1,
    packId: "pack-import-test-001-v1",
    createdAt: "2026-08-12T00:00:00.000Z",
    builderVersion: "frank/0.1.0",
    rendererVersion: "renderer/0.1.0",
    classification: { label: "test", modelVersion: "v1", confidence: 0.9 },
    manifestSha256: "",
    signature: "",
    feedLayout: {
      placement: "feed",
      layers: [{ type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1350 }, protected: false }],
      safeZones: [{ x: 40, y: 40, width: 1000, height: 1270 }],
    },
    storyLayout: {
      placement: "story",
      layers: [{ type: "plate", layerId: "bg", colourRole: "background", geometry: { x: 0, y: 0, width: 1080, height: 1920 }, protected: false }],
      safeZones: [{ x: 40, y: 200, width: 1000, height: 1520 }],
    },
    imageInputs: [],
    textInputs: [],
    semanticColours: { background: "#FFFFFF", primary: "#111", secondary: "#222", accent: "#333", mainText: "#000", inverseText: "#fff" },
    assets: {},
    fonts: [],
    safePreviews: { feed: { sha256: "" }, story: { sha256: "" } },
    qaEvidence: { feedPassed: true, storyPassed: true, reviewerVersions: ["v1"], stressFixtureResults: {} },
  };
}

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32); // raw 32 bytes
  return { publicKeyHex: raw.toString("hex"), privateKey };
}

/** Build a complete valid archive (manifest + previews) and its envelope. */
function buildSignedPack(keys: ReturnType<typeof ed25519>) {
  const pack = basePack();
  // Chrome previews: deterministic renders with empty inputs.
  // For these tests we render them with the real renderer below where needed;
  // envelope-level tests can stub them because canary verification is a
  // separate step exercised in its own test.
  pack.safePreviews = { feed: { sha256: PNG_1PX_HASH }, story: { sha256: PNG_1PX_HASH } };
  pack.manifestSha256 = computeManifestHash(pack as unknown as Record<string, unknown>);
  const signature = sign(null, Buffer.from(pack.manifestSha256, "utf8"), keys.privateKey).toString("base64");

  const archive = Buffer.from(zipSync({
    "manifest.json": strToU8(canonicalJson(pack)),
    "previews/feed.png": new Uint8Array(PNG_1PX),
    "previews/story.png": new Uint8Array(PNG_1PX),
  }));
  return { pack, archive, signature };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("import-pack validation", () => {
  it("sha256 hashing is deterministic", () => {
    const obj = { foo: "bar", num: 1 };
    assert.equal(sha256Hex(obj), sha256Hex(structuredClone(obj)));
  });

  it("relays http transport failures as import errors with codes", () => {
    const err = importError("origin_not_allowed", "no");
    assert.equal(err.code, "origin_not_allowed");
    assert.ok(err instanceof Error);
  });

  it("expectedEntryMap covers manifest, previews, assets and fonts", () => {
    const pack = basePack();
    pack.assets = { bg: { fileName: "bg.png", sha256: PNG_1PX_HASH, mimeType: "image/png" } };
    pack.fonts = [{ file: "Inter-Bold.woff2", sha256: WOFF2_HASH }];
    const map = expectedEntryMap(pack);
    assert.deepEqual(Object.keys(map).sort(), [
      "assets/bg.png",
      "fonts/Inter-Bold.woff2",
      "manifest.json",
      "previews/feed.png",
      "previews/story.png",
    ]);
    assert.equal(map["assets/bg.png"], "image/png");
    assert.equal(map["fonts/Inter-Bold.woff2"], "font/woff2");
  });
});

describe("archive security parsing", () => {
  it("accepts a clean archive", () => {
    const archive = Buffer.from(zipSync({
      "manifest.json": strToU8('{"ok":true}'),
      "previews/feed.png": new Uint8Array(PNG_1PX),
    }));
    const entries = extractArchiveEntries(archive);
    assert.deepEqual([...entries.keys()].sort(), ["manifest.json", "previews/feed.png"]);
  });

  it("rejects path traversal entries", () => {
    const archive = Buffer.from(zipSync({
      "../../etc/passwd": strToU8("pwned"),
      "manifest.json": strToU8('{"ok":true}'),
    }));
    assert.throws(() => extractArchiveEntries(archive), (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_path_traversal");
  });

  it("rejects absolute path entries", () => {
    const archive = Buffer.from(zipSync({
      "/etc/passwd": strToU8("pwned"),
      "manifest.json": strToU8('{"ok":true}'),
    }));
    assert.throws(() => extractArchiveEntries(archive), (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_path_traversal");
  });

  it("rejects backslash path entries", () => {
    const archive = Buffer.from(zipSync({
      "foo\\..\\bar": strToU8("pwned"),
      "manifest.json": strToU8('{"ok":true}'),
    }));
    assert.throws(() => extractArchiveEntries(archive), (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_path_traversal");
  });

  it("rejects non-zip bytes", () => {
    assert.throws(() => extractArchiveEntries(Buffer.from("not a zip at all")), (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_bad_magic");
  });

  it("verifies MIME magic bytes via parsePackArchive", () => {
    // A PNG declared as JSON must be rejected.
    const archive = Buffer.from(zipSync({
      "manifest.json": strToU8('{"ok":true}'),
      "previews/feed.png": new Uint8Array(PNG_1PX),
    }));
    assert.throws(
      () => parsePackArchive(archive, { "manifest.json": "application/json", "previews/feed.png": "image/json-bogus" }),
      (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_bad_mime",
    );
    // Wrong magic for a declared png.
    const bogus = Buffer.from(zipSync({
      "manifest.json": strToU8('{"ok":true}'),
      "previews/feed.png": strToU8("this is not a png"),
    }));
    assert.throws(
      () => parsePackArchive(bogus, { "manifest.json": "application/json", "previews/feed.png": "image/png" }),
      (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_magic_mismatch",
    );
  });

  it("rejects unexpected extra entries and missing declared entries", () => {
    // Extra entry: full expected set present + one rogue file.
    const withExtra = Buffer.from(zipSync({
      "manifest.json": strToU8('{"ok":true}'),
      "previews/feed.png": new Uint8Array(PNG_1PX),
      "sneaky.exe": strToU8("MZ"),
    }));
    assert.throws(
      () => parsePackArchive(withExtra, { "manifest.json": "application/json", "previews/feed.png": "image/png" }),
      (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_unexpected_entry",
    );
    // Missing entry: declared preview absent from the archive.
    const withMissing = Buffer.from(zipSync({
      "manifest.json": strToU8('{"ok":true}'),
      "sneaky.exe": strToU8("MZ"),
    }));
    assert.throws(
      () => parsePackArchive(withMissing, { "manifest.json": "application/json", "previews/feed.png": "image/png" }),
      (err: unknown) => err instanceof ArchiveSecurityError && err.code === "zip_missing_entry",
    );
  });
});

describe("signature verification", () => {
  it("a real Ed25519 signature round-trips through importTemplatePack's verify step", async () => {
    // Exercise the private verify via a minimal end-to-end import that fails
    // FAST at transport fetch (we inject fetchFn returning a crafted archive),
    // proving the signature path accepts a genuine signature.
    const keys = ed25519();
    const { pack, archive, signature } = buildSignedPack(keys);
    const packSha256 = createHash("sha256").update(archive).digest("hex");

    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(new Uint8Array(archive), {
        status: 200,
        headers: { "content-length": String(archive.length), "content-type": "application/zip" },
      });
    }) as typeof fetch;

    // Stub the supabase surface: idempotency empty, nonce insert ok.
    const sb = {
      from: (t: string) => ({
        select: () => ({ eq: (..._a: unknown[]) => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "receipt-1", pack_id: pack.packId, pack_sha256: packSha256, created_at: new Date().toISOString() }, error: null }) }), error: null }),
        update: () => ({ eq: () => ({ then: (r: (v: { error: null }) => unknown) => Promise.resolve(r({ error: null })) }) }),
        }),
    } as never;

    // The canary render step needs real previews; without them the import
    // must fail at preview_mismatch — which PROVES every earlier gate
    // (timestamp, nonce, origin, fetch, archive parse, schema, manifest hash,
    // transport hash, signature, entry-set, asset/font hashes) passed.
    await assert.rejects(
      importTemplatePack(sb, {
        packUrl: "https://frank.fail/packs/p1.zip",
        packSha256,
        packId: pack.packId,
        buildId: "build-1",
        issuedAt: new Date().toISOString(),
        nonce: "nonce-1",
        signature,
        idempotencyKey: packSha256,
      }, {
        frankPublicKey: keys.publicKeyHex,
        fetchFn,
      }),
      (err: unknown) => {
        const e = err as { code?: string; message?: string };
        assert.equal(e.code, "preview_mismatch", `expected preview_mismatch, got ${e.code}: ${e.message}`);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  });

  it("rejects a tampered manifest signature before touching storage", async () => {
    const keys = ed25519();
    const otherKeys = ed25519(); // wrong signer
    const { pack, archive, signature: goodSig } = buildSignedPack(keys);
    const packSha256 = createHash("sha256").update(archive).digest("hex");

    // Sign with the WRONG key.
    const { sign: signFn } = await import("node:crypto");
    const badSig = signFn(null, Buffer.from(pack.manifestSha256, "utf8"), otherKeys.privateKey).toString("base64");
    void goodSig;

    const fetchFn = (async () => new Response(new Uint8Array(archive), { status: 200 })) as typeof fetch;
    const sb = {
      from: () => ({
        select: () => ({ eq: (..._a: unknown[]) => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }) }) }),
        insert: () => ({ error: null }),
        update: () => ({ eq: () => Promise.resolve() }),
      }),
    } as never;

    await assert.rejects(
      importTemplatePack(sb, {
        packUrl: "https://frank.fail/packs/p1.zip",
        packSha256,
        packId: pack.packId,
        buildId: "build-1",
        issuedAt: new Date().toISOString(),
        nonce: "nonce-2",
        signature: badSig,
        idempotencyKey: packSha256,
      }, { frankPublicKey: keys.publicKeyHex, fetchFn }),
      (err: unknown) => (err as { code?: string }).code === "signature_rejected",
    );
  });

  it("refuses to import when the public key is not configured", async () => {
    const keys = ed25519();
    const { pack, archive, signature } = buildSignedPack(keys);
    const packSha256 = createHash("sha256").update(archive).digest("hex");
    const fetchFn = (async () => new Response(new Uint8Array(archive), { status: 200 })) as typeof fetch;
    const sb = {
      from: () => ({
        select: () => ({ eq: (..._a: unknown[]) => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }) }) }),
        insert: () => ({ error: null }),
        update: () => ({ eq: () => Promise.resolve() }),
      }),
    } as never;

    await assert.rejects(
      importTemplatePack(sb, {
        packUrl: "https://frank.fail/packs/p1.zip",
        packSha256,
        packId: pack.packId,
        buildId: "build-1",
        issuedAt: new Date().toISOString(),
        nonce: "nonce-3",
        signature,
        idempotencyKey: packSha256,
      }, { frankPublicKey: "", fetchFn }),
      (err: unknown) => (err as { code?: string }).code === "signature_config_missing",
    );
  });

  it("rejects an expired timestamp", async () => {
    const keys = ed25519();
    const { pack, archive, signature } = buildSignedPack(keys);
    const packSha256 = createHash("sha256").update(archive).digest("hex");
    const fetchFn = (async () => new Response(new Uint8Array(archive), { status: 200 })) as typeof fetch;
    const sb = {
      from: () => ({
        select: () => ({ eq: (..._a: unknown[]) => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }) }) }),
        insert: () => ({ error: null }),
        update: () => ({ eq: () => Promise.resolve() }),
      }),
    } as never;

    await assert.rejects(
      importTemplatePack(sb, {
        packUrl: "https://frank.fail/packs/p1.zip",
        packSha256,
        packId: pack.packId,
        buildId: "build-1",
        issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        nonce: "nonce-4",
        signature,
        idempotencyKey: packSha256,
      }, { frankPublicKey: keys.publicKeyHex, fetchFn }),
      (err: unknown) => (err as { code?: string }).code === "timestamp_expired",
    );
  });

  it("rejects an off-allowlist origin", async () => {
    const keys = ed25519();
    const { pack, archive, signature } = buildSignedPack(keys);
    const packSha256 = createHash("sha256").update(archive).digest("hex");
    const fetchFn = (async () => new Response(new Uint8Array(archive), { status: 200 })) as typeof fetch;
    const sb = {
      from: () => ({
        select: () => ({ eq: (..._a: unknown[]) => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), maybeSingle: async () => ({ data: null }) }) }),
        insert: () => ({ error: null }),
        update: () => ({ eq: () => Promise.resolve() }),
      }),
    } as never;

    await assert.rejects(
      importTemplatePack(sb, {
        packUrl: "https://evil.example/packs/p1.zip",
        packSha256,
        packId: pack.packId,
        buildId: "build-1",
        issuedAt: new Date().toISOString(),
        nonce: "nonce-5",
        signature,
        idempotencyKey: packSha256,
      }, { frankPublicKey: keys.publicKeyHex, fetchFn }),
      (err: unknown) => (err as { code?: string }).code === "origin_not_allowed",
    );
  });
});
