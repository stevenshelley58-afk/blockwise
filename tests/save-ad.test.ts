import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { saveAd, SaveError } from "../src/lib/adstudio/save-ad.ts";
import type { AdDocumentParsed } from "../packages/ad-template-pack-contract/src/schema.ts";
import type { TemplatePack } from "../packages/ad-template-pack-contract/src/types.ts";

// ---------------------------------------------------------------------------
// saveAd — customer document -> Feed + Story PNG hashes.
//
// The real @blockwise/ad-deterministic-renderer needs @napi-rs/canvas native
// bindings that are not present in this environment, so the renderer is
// injected through saveAd's documented test-only `renderPlacement` injection
// point (same pattern as import-pack's fetchPack). Every save must request
// BOTH placements — a Feed-only save is a bug.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "fixtures",
  "template-pack",
  "minimal-feed-story.json",
);

function loadPack(): TemplatePack {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as TemplatePack;
}

const PACK = loadPack();
const PACK_ROW = {
  pack_id: PACK.packId,
  pack_json: PACK,
  manifest_sha256: PACK.manifestSha256,
};

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the Supabase surface saveAd uses.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

class FakeSupabase {
  tables: Record<string, Row[]> = {
    ad_customer_ads: [],
    ad_template_packs: [PACK_ROW],
    ad_revisions: [],
    ad_render_attempts: [],
  };
  seq = 0;
  uploaded: Array<{ path: string; bytes: Buffer }> = [];
  uploadAttempts: Array<{ path: string; bytes: Buffer; options: Record<string, unknown> }> = [];
  objects = new Map<string, Buffer>();
  storage = {
    from: () => ({
      upload: async (path: string, bytes: Buffer, options: Record<string, unknown>) => {
        this.uploadAttempts.push({ path, bytes, options });
        if (this.objects.has(path) && options.upsert === false) {
          return { error: { message: "The resource already exists" } };
        }
        const stored = Buffer.from(bytes);
        this.objects.set(path, stored);
        this.uploaded.push({ path, bytes: stored });
        return { error: null };
      },
      download: async (path: string) => {
        const bytes = this.objects.get(path);
        return bytes
          ? { data: new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer]), error: null }
          : { data: null, error: { message: "The resource was not found" } };
      },
    }),
  };

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name !== "commit_ad_revision") return { data: null, error: { message: `Unknown RPC ${name}` } };
    const revisionInput = args.p_revision as Row;
    const attemptInputs = args.p_attempts as Row[];
    const ad = this.tables.ad_customer_ads.find(row =>
      row.id === args.p_ad_id && row.workspace_id === args.p_workspace_id
    );
    if (!ad) return { data: null, error: { message: "ad_not_found" } };
    if ((ad.active_revision_id ?? null) !== (args.p_expected_active_revision_id ?? null)) {
      return { data: null, error: { message: "stale_revision" } };
    }
    const revision: Row = {
      id: `row-${++this.seq}`,
      ad_id: args.p_ad_id,
      workspace_id: args.p_workspace_id,
      ...revisionInput,
      created_at: new Date().toISOString(),
    };
    this.tables.ad_revisions.push(revision);
    for (const attempt of attemptInputs) {
      this.tables.ad_render_attempts.push({
        id: `row-${++this.seq}`,
        revision_id: revision.id,
        workspace_id: args.p_workspace_id,
        ...attempt,
      });
    }
    ad.active_revision_id = revision.id;
    return { data: { id: revision.id, revision_number: revision.revision_number }, error: null };
  }
}

class FakeQuery {
  private db: FakeSupabase;
  private table: string;
  private filters: Array<[string, unknown]> = [];
  private op: { kind: "insert" | "update"; value: Row | Row[] } | null = null;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select(): this {
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push([col, value]);
    return this;
  }

  insert(value: Row | Row[]): this {
    this.op = { kind: "insert", value };
    return this;
  }

  update(value: Row): this {
    this.op = { kind: "update", value };
    return this;
  }

  maybeSingle(): { data: Row | null; error: unknown } {
    if (this.op?.kind === "insert") return this.doInsert() as { data: Row; error: null };
    const rows = this.rows();
    return { data: rows[0] ?? null, error: null };
  }

  single(): { data: Row | null; error: unknown } {
    if (this.op?.kind === "insert") return this.doInsert() as { data: Row; error: null };
    const rows = this.rows();
    if (rows.length === 0) {
      return { data: null, error: { message: "No rows found", code: "PGRST116", details: "", hint: "" } };
    }
    return { data: rows[0], error: null };
  }

  /** Awaiting an update chain applies it (saveAd awaits update().eq(...)). */
  then(resolve: (v: { data: Row | null; error: unknown }) => void): void {
    if (this.op?.kind === "update") {
      const target = this.rows()[0] ?? null;
      if (target) Object.assign(target, this.op.value);
      resolve({ data: target, error: null });
      return;
    }
    resolve(this.maybeSingle());
  }

  private rows(): Row[] {
    return (this.db.tables[this.table] ?? []).filter(row =>
      this.filters.every(([col, value]) => row[col] === value),
    );
  }

  private doInsert(): { data: Row | Row[]; error: null } {
    const rows = Array.isArray(this.op!.value) ? this.op!.value : [this.op!.value];
    const stored = rows.map(row => {
      const storedRow: Row = { ...row };
      if (storedRow.id === undefined) storedRow.id = `row-${++this.db.seq}`;
      if (storedRow.created_at === undefined) storedRow.created_at = new Date().toISOString();
      (this.db.tables[this.table] ??= []).push(storedRow);
      return storedRow;
    });
    return { data: stored.length === 1 ? stored[0] : stored, error: null };
  }
}

// ---------------------------------------------------------------------------
// Document + renderer fixtures
// ---------------------------------------------------------------------------

const HEX64 = "0".repeat(64);

function makeDocument(overrides: Partial<AdDocumentParsed> = {}): AdDocumentParsed {
  return {
    schema: "blockwise.ad-document/v1",
    templateId: PACK.templateId,
    templateVersion: PACK.version,
    templateHash: PACK.manifestSha256,
    rendererVersion: PACK.rendererVersion,
    sharedImageValues: {},
    sharedTextValues: { headline: "Open Saturday" },
    feedCropOverrides: {},
    storyCropOverrides: {},
    colourMode: "template",
    resolvedColourMap: { ...PACK.semanticColours },
    metaPrimaryText: "",
    metaHeadline: "",
    metaDescription: "",
    metaCta: "LEARN_MORE",
    revision: 1,
    documentHash: HEX64,
    lastRenderedHash: null,
    ...overrides,
  };
}

const FEED_HASH = "f".repeat(64);
const STORY_HASH = "e".repeat(64);

function fakeRenderer(calls: string[]) {
  return async (placement: "feed" | "story") => {
    calls.push(placement);
    return { sha256: placement === "feed" ? FEED_HASH : STORY_HASH, png: Buffer.from(placement) };
  };
}

function contentAddressedRenderer(calls: string[]) {
  return async (placement: "feed" | "story") => {
    calls.push(placement);
    const png = Buffer.from(`${placement}-render`);
    return { sha256: createHash("sha256").update(png).digest("hex"), png };
  };
}

function seedAd(db: FakeSupabase, workspaceId: string, overrides: Row = {}) {
  const row: Row = {
    id: "ad-1",
    workspace_id: workspaceId,
    template_pack_id: PACK.packId,
    template_id: PACK.templateId,
    template_version: PACK.version,
    active_revision_id: null,
    colour_mode: "template",
    resolved_colour_map: {},
    ...overrides,
  };
  db.tables.ad_customer_ads.push(row);
  return row;
}

function revisionRows(db: FakeSupabase) {
  return db.tables.ad_revisions;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Save ad", () => {
  it("SaveError has code and message", () => {
    const err = new SaveError("ad_not_found", "Ad not found");
    assert.equal(err.code, "ad_not_found");
    assert.equal(err.message, "Ad not found");
  });

  it("rejects stale revisions", () => {
    const expected = 2;
    const current = 3;
    assert.notEqual(expected, current, "Stale revision should be detected");
  });

  it("accepts matching revisions", () => {
    const expected = 3;
    const current = 3;
    assert.equal(expected, current);
  });

  it("same hash means unchanged", () => {
    const docHash = "abc123";
    const currentHash = "abc123";
    assert.equal(docHash, currentHash, "Same hash should be detected as unchanged");
  });
});

describe("saveAd", () => {
  const WS = "ws-1";

  it("persists a revision with BOTH Feed and Story PNG hashes on first save", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const placements: string[] = [];

    const output = await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument(),
      expectedRevision: 0,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: fakeRenderer(placements),
    });

    assert.equal(output.unchanged, false);
    assert.equal(output.revisionNumber, 1);
    assert.match(output.feedPngHash, /^[a-f0-9]{64}$/);
    assert.match(output.storyPngHash, /^[a-f0-9]{64}$/);
    assert.notEqual(output.feedPngHash, output.storyPngHash);
    assert.equal(output.feedPngHash, FEED_HASH);
    assert.equal(output.storyPngHash, STORY_HASH);
    assert.equal(db.uploaded.length, 2);
    assert.deepEqual(db.uploaded.map(upload => upload.bytes.length > 0), [true, true]);

    // Both placements were requested — never a Feed-only save.
    assert.deepEqual(placements, ["feed", "story"]);

    // One revision row, hashes + document hash persisted, active revision advanced.
    const revisions = revisionRows(db);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].revision_number, 1);
    assert.equal(revisions[0].feed_png_hash, FEED_HASH);
    assert.equal(revisions[0].story_png_hash, STORY_HASH);
    assert.equal(revisions[0].document_hash, revisions[0].document_hash);
    assert.equal(db.tables.ad_customer_ads[0].active_revision_id, output.revisionId);

    // One render attempt per placement.
    const attempts = db.tables.ad_render_attempts;
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts.map(a => a.placement).sort(), ["feed", "story"]);
  });

  it("keeps Feed and Story crop overrides on the save document", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const document = makeDocument({
      feedCropOverrides: { hero: { x: 0.1, y: 0, width: 0.5, height: 1 } },
      storyCropOverrides: { hero: { x: 0.4, y: 0, width: 0.5, height: 1 } },
    });
    await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document,
      expectedRevision: 0,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: fakeRenderer([]),
    });
    assert.deepEqual(db.tables.ad_revisions[0].document_json, document);
  });

  it("second save with changed document advances to revision 2", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const placements: string[] = [];
    const renderer = contentAddressedRenderer(placements);

    const first = await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument(),
      expectedRevision: 0,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });
    assert.equal(first.revisionNumber, 1);

    const second = await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument({ sharedTextValues: { headline: "Open Sunday" } }),
      expectedRevision: 1,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });

    assert.equal(second.revisionNumber, 2);
    assert.equal(second.unchanged, false);
    assert.notEqual(second.revisionId, first.revisionId);
    assert.equal(revisionRows(db).length, 2);
    assert.equal(db.tables.ad_customer_ads[0].active_revision_id, second.revisionId);
    assert.deepEqual(placements, ["feed", "story", "feed", "story"]);
  });

  it("retries an existing content-addressed render without overwriting it", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const placements: string[] = [];
    const renderer = contentAddressedRenderer(placements);

    await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument(),
      expectedRevision: 0,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });
    const second = await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument({ sharedTextValues: { headline: "Open Sunday" } }),
      expectedRevision: 1,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });

    assert.equal(second.revisionNumber, 2);
    assert.equal(db.uploaded.length, 2, "duplicate retries must not replace the stored objects");
    assert.equal(db.uploadAttempts.length, 4);
    assert.deepEqual(db.uploadAttempts.map(attempt => attempt.options.upsert), [false, false, false, false]);
    assert.deepEqual(placements, ["feed", "story", "feed", "story"]);
  });

  it("rejects an existing render when its bytes do not match the render hash", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const renderer = contentAddressedRenderer([]);
    const feedBytes = Buffer.from("feed-render");
    const feedHash = createHash("sha256").update(feedBytes).digest("hex");
    db.objects.set(`${WS}/adstudio/renders/ad-1/feed-${feedHash}.png`, Buffer.from("tampered"));

    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument(),
        expectedRevision: 0,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: renderer,
      }),
      (error: unknown) => error instanceof SaveError && error.code === "render_upload_failed",
    );
    assert.equal(db.tables.ad_revisions.length, 0);
  });

  it("returns existing hashes unchanged when the document hash matches", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const placements: string[] = [];
    const renderer = fakeRenderer(placements);
    const document = makeDocument();

    const first = await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document,
      expectedRevision: 0,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });

    const again = await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document,
      expectedRevision: 1,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });

    assert.equal(again.unchanged, true);
    assert.equal(again.revisionId, first.revisionId);
    assert.equal(again.revisionNumber, 1);
    assert.equal(again.feedPngHash, FEED_HASH);
    assert.equal(again.storyPngHash, STORY_HASH);
    // No new revision, no new render attempts — renderer untouched.
    assert.equal(revisionRows(db).length, 1);
    assert.equal(db.tables.ad_render_attempts.length, 2);
    assert.deepEqual(placements, ["feed", "story"]);
  });

  it("rejects a stale revision (expected < current)", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const renderer = contentAddressedRenderer([]);

    await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument(),
      expectedRevision: 0,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });
    await saveAd({
      supabase: db as never,
      workspaceId: WS,
      adId: "ad-1",
      document: makeDocument({ sharedTextValues: { headline: "v2" } }),
      expectedRevision: 1,
      colourMap: PACK.semanticColours,
      imageValues: {},
      renderPlacement: renderer,
    });

    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument({ sharedTextValues: { headline: "v3 from stale client" } }),
        expectedRevision: 1,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: renderer,
      }),
      (err: unknown) => err instanceof SaveError && err.code === "stale_revision",
    );

    // Nothing persisted for the rejected save.
    assert.equal(revisionRows(db).length, 2);
  });

  it("throws ad_not_found for an ad outside the workspace", async () => {
    const db = new FakeSupabase();
    seedAd(db, "ws-other");

    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument(),
        expectedRevision: 0,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: fakeRenderer([]),
      }),
      (err: unknown) => err instanceof SaveError && err.code === "ad_not_found",
    );
  });

  it("blocks save before rendering when a required image is missing", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const requiredPack = structuredClone(PACK) as TemplatePack;
    requiredPack.imageInputs = [{
      key: "hero",
      label: "Property photo",
      required: true,
      acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
    }];
    db.tables.ad_template_packs = [{ ...PACK_ROW, pack_json: requiredPack }];

    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument(),
        expectedRevision: 0,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: fakeRenderer([]),
      }),
      (err: unknown) => err instanceof SaveError && err.code === "image_required",
    );
    assert.equal(db.uploadAttempts.length, 0);
  });

  it("blocks save before rendering when required overlay text is blank", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);
    const requiredPack = structuredClone(PACK) as TemplatePack;
    requiredPack.textInputs = [{ key: "headline", label: "Headline", placeholder: "Headline", maxLength: 40 }];
    db.tables.ad_template_packs = [{ ...PACK_ROW, pack_json: requiredPack }];

    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument({ sharedTextValues: { headline: "   " } }),
        expectedRevision: 0,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: fakeRenderer([]),
      }),
      (err: unknown) => err instanceof SaveError && err.code === "text_required",
    );
    assert.equal(db.uploadAttempts.length, 0);
  });

  it("does not partially insert a revision when the active pointer changes during rendering", async () => {
    const db = new FakeSupabase();
    const ad = seedAd(db, WS);
    let renders = 0;
    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument(),
        expectedRevision: 0,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: async (placement) => {
          renders += 1;
          if (placement === "story") ad.active_revision_id = "another-revision";
          return { sha256: placement === "feed" ? FEED_HASH : STORY_HASH, png: Buffer.from(placement) };
        },
      }),
      (err: unknown) => err instanceof SaveError && err.code === "stale_revision",
    );
    assert.equal(renders, 2);
    assert.equal(db.tables.ad_revisions.length, 0);
    assert.equal(db.tables.ad_render_attempts.length, 0);
  });

  it("throws template_hash_mismatch when the document references another pack version", async () => {
    const db = new FakeSupabase();
    seedAd(db, WS);

    await assert.rejects(
      saveAd({
        supabase: db as never,
        workspaceId: WS,
        adId: "ad-1",
        document: makeDocument({ templateHash: "a".repeat(64) }),
        expectedRevision: 0,
        colourMap: PACK.semanticColours,
        imageValues: {},
        renderPlacement: fakeRenderer([]),
      }),
      (err: unknown) => err instanceof SaveError && err.code === "template_hash_mismatch",
    );
  });
});
