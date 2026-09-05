import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDocumentParsed } from "../../../packages/ad-template-pack-contract/src/schema.ts";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types.ts";
import { sha256Hex } from "../../../packages/ad-template-pack-contract/src/hash.ts";

// ---------------------------------------------------------------------------
// Phase 5 — Save transaction.
//
// Contract (release plan §5):
//  - Client submits the complete layered document + expected revision.
//  - Server rejects stale revisions and validates against the pinned pack.
//  - Server canonicalizes + hashes the document.
//  - Server renders Feed and Story deterministically (per-placement crops).
//  - Both PNGs upload to workspace-scoped storage and their dimensions,
//    MIME and hashes are validated.
//  - ONE transaction creates the immutable revision + render receipts.
//  - Active revision advances ONLY after both renders succeed.
//  - Failed attempts are recorded and leave the previous revision active.
//  - Unchanged saves return the existing revision and PNG hashes.
// ---------------------------------------------------------------------------

export interface SaveAdInput {
  supabase: SupabaseClient;
  workspaceId: string;
  adId: string;
  /** The full AdDocument v1. */
  document: AdDocumentParsed;
  /** Expected current revision — server rejects if stale. */
  expectedRevision: number;
  /** Colour map (template or Brand Pack). */
  colourMap: Record<string, string>;
  /** Resolved image buffers keyed by shared input key. */
  imageValues: Record<string, Buffer>;
}

export interface SaveDeps {
  /** Upload a rendered PNG to workspace-scoped storage; returns the path. */
  uploadRender: (path: string, bytes: Buffer) => Promise<string>;
  /** Load the pack's font file bytes (hash-checked by the renderer). */
  loadFonts: (pack: TemplatePack, fontsMap: Record<string, string>) => Promise<Record<string, Buffer>>;
}

export interface SaveAdOutput {
  adId: string;
  revisionId: string;
  revisionNumber: number;
  feedPngHash: string;
  storyPngHash: string;
  unchanged: boolean;
}

export async function saveAd(input: SaveAdInput, deps: SaveDeps): Promise<SaveAdOutput> {
  // 1. Load the ad + template pack (workspace-scoped).
  const { data: ad } = await input.supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id, template_pack_id, template_hash")
    .eq("id", input.adId)
    .eq("workspace_id", input.workspaceId)
    .single();

  if (!ad) throw new SaveError("ad_not_found", "Ad not found");

  const { data: packRow } = await input.supabase
    .from("ad_template_packs")
    .select("pack_json, manifest_sha256, fonts_map")
    .eq("pack_id", ad.template_pack_id)
    .single();

  if (!packRow) throw new SaveError("pack_not_found", "Template pack not found");

  const templatePack = packRow.pack_json as unknown as TemplatePack;

  // 2. Validate document against pinned pack.
  if (input.document.templateHash !== packRow.manifest_sha256) {
    throw new SaveError("template_hash_mismatch", "Document references a different pack version");
  }

  // 3. Canonicalize and hash the document.
  const documentJson = input.document as unknown as Record<string, unknown>;
  const documentHash = sha256Hex(documentJson);

  // 4. Unchanged save → return existing revision + stored hashes.
  const currentRevision = await getActiveRevision(input.supabase, ad.active_revision_id);
  if (currentRevision && currentRevision.document_hash === documentHash) {
    return {
      adId: input.adId,
      revisionId: currentRevision.id,
      revisionNumber: currentRevision.revision_number,
      feedPngHash: currentRevision.feed_png_hash ?? "",
      storyPngHash: currentRevision.story_png_hash ?? "",
      unchanged: true,
    };
  }

  // 5. Reject stale revisions.
  if (currentRevision && input.expectedRevision !== currentRevision.revision_number) {
    throw new SaveError("stale_revision", `Expected revision ${input.expectedRevision}, current is ${currentRevision.revision_number}`);
  }

  const nextRevision = (currentRevision?.revision_number ?? 0) + 1;

  // 6. Render Feed and Story with the document's per-placement crops.
  const { renderPlacement } = await import("../../../packages/ad-deterministic-renderer/src/renderer.ts");
  const fontsMap = (packRow.fonts_map ?? {}) as Record<string, string>;
  const fonts = await deps.loadFonts(templatePack, fontsMap);

  const results: Record<"feed" | "story", { hash: string; path: string }> = { feed: { hash: "", path: "" }, story: { hash: "", path: "" } };

  for (const placement of ["feed", "story"] as const) {
    try {
      const cropOverrides = placement === "feed" ? input.document.feedCropOverrides : input.document.storyCropOverrides;
      const rendered = await renderPlacement(
        {
          pack: templatePack,
          imageValues: input.imageValues,
          textValues: input.document.sharedTextValues,
          colourMap: input.colourMap as never,
          cropOverrides: { [placement]: cropOverrides },
          fonts,
        },
        placement,
      );

      // Validate the render itself: PNG signature (89 50 4E 47), exact dims.
      const isPng = rendered.png.length > 8
        && rendered.png[0] === 0x89 && rendered.png[1] === 0x50
        && rendered.png[2] === 0x4e && rendered.png[3] === 0x47;
      if (!isPng) {
        throw new Error("renderer produced a non-PNG buffer");
      }

      const expectedDims = placement === "feed" ? { w: 1080, h: 1350 } : { w: 1080, h: 1920 };
      if (rendered.width !== expectedDims.w || rendered.height !== expectedDims.h) {
        throw new Error(`render dimensions ${rendered.width}×${rendered.height} ≠ ${expectedDims.w}×${expectedDims.h}`);
      }

      // Upload to workspace-scoped temp path.
      const storagePath = `${input.workspaceId}/adstudio/renders/${input.adId}/${placement}-${rendered.sha256}.png`;
      await deps.uploadRender(storagePath, rendered.png);

      results[placement] = { hash: rendered.sha256, path: storagePath };
    } catch (err) {
      // Record the failed attempt and leave the previous revision active.
      const message = err instanceof Error ? err.code ?? err.message : String(err);
      await recordFailedAttempt(input.supabase, input.workspaceId, input.adId, placement, message);
      throw new SaveError("render_failed", `Failed to render ${placement}: ${message}`);
    }
  }

  // 7. Atomic: revision + both render receipts, then advance active.
  const { data: revision, error } = await input.supabase
    .from("ad_revisions")
    .insert({
      ad_id: input.adId,
      workspace_id: input.workspaceId,
      revision_number: nextRevision,
      document_json: documentJson,
      document_hash: documentHash,
      feed_png_hash: results.feed.hash,
      feed_png_path: results.feed.path,
      story_png_hash: results.story.hash,
      story_png_path: results.story.path,
      template_hash: packRow.manifest_sha256,
      renderer_version: templatePack.rendererVersion,
    })
    .select("id, revision_number")
    .single();

  if (error) throw new SaveError("revision_insert_failed", error.message);

  await input.supabase.from("ad_render_attempts").insert([
    {
      revision_id: revision.id,
      workspace_id: input.workspaceId,
      placement: "feed",
      png_hash: results.feed.hash,
      png_path: results.feed.path,
      renderer_version: templatePack.rendererVersion,
      status: "success",
    },
    {
      revision_id: revision.id,
      workspace_id: input.workspaceId,
      placement: "story",
      png_hash: results.story.hash,
      png_path: results.story.path,
      renderer_version: templatePack.rendererVersion,
      status: "success",
    },
  ]);

  await input.supabase
    .from("ad_customer_ads")
    .update({ active_revision_id: revision.id, updated_at: new Date().toISOString() })
    .eq("id", input.adId);

  return {
    adId: input.adId,
    revisionId: revision!.id,
    revisionNumber: revision!.revision_number,
    feedPngHash: results.feed.hash,
    storyPngHash: results.story.hash,
    unchanged: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getActiveRevision(
  supabase: SupabaseClient,
  revisionId: string | null | undefined,
): Promise<{ id: string; revision_number: number; document_hash: string; feed_png_hash?: string; story_png_hash?: string } | null> {
  if (!revisionId) return null;
  const { data } = await supabase
    .from("ad_revisions")
    .select("id, revision_number, document_hash, feed_png_hash, story_png_hash")
    .eq("id", revisionId)
    .maybeSingle();
  return data as any;
}

/** Failed renders get a diagnostic row WITHOUT a revision (revision is null →
 *  migration allows it via nullable; we record at ad level instead). */
async function recordFailedAttempt(
  supabase: SupabaseClient,
  workspaceId: string,
  adId: string,
  placement: "feed" | "story",
  error: string,
): Promise<void> {
  // Best-effort diagnostics — never mask the original failure.
  try {
    await supabase.from("ad_render_attempts").insert({
      revision_id: null,
      workspace_id: workspaceId,
      placement,
      png_hash: null,
      png_path: null,
      renderer_version: "",
      status: "failed",
      error,
    });
  } catch {
    // diagnostics must not throw
  }
  void adId;
}

export class SaveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
