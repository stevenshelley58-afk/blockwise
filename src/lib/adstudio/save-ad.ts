import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDocumentParsed } from "../../../packages/ad-template-pack-contract/src/schema.js";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types.js";
import { sha256Hex } from "../../../packages/ad-template-pack-contract/src/hash.ts";

// ---------------------------------------------------------------------------
// Types
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
  /** Resolved image buffers keyed by input key. */
  imageValues: Record<string, Buffer>;
  /**
   * Test-only injection point (mirrors import-pack's fetchPack): skips the
   * real renderer and returns a caller-supplied sha256 per placement.
   * Production callers omit it and get the @blockwise/ad-deterministic-renderer.
   */
  renderPlacement?: (placement: "feed" | "story") => Promise<{ sha256: string }>;
}

export interface SaveAdOutput {
  adId: string;
  revisionId: string;
  revisionNumber: number;
  feedPngHash: string;
  storyPngHash: string;
  unchanged: boolean;
}

// ---------------------------------------------------------------------------
// Save transaction
// ---------------------------------------------------------------------------

export async function saveAd(input: SaveAdInput): Promise<SaveAdOutput> {
  // 1. Load the ad + template pack
  const { data: ad } = await input.supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id, template_pack_id")
    .eq("id", input.adId)
    .eq("workspace_id", input.workspaceId)
    .single();

  if (!ad) throw new SaveError("ad_not_found", "Ad not found");

  const { data: pack } = await input.supabase
    .from("ad_template_packs")
    .select("pack_json, manifest_sha256")
    .eq("pack_id", ad.template_pack_id)
    .single();

  if (!pack) throw new SaveError("pack_not_found", "Template pack not found");

  const templatePack = pack.pack_json as unknown as TemplatePack;

  // 2. Validate document against pinned pack
  if (input.document.templateHash !== pack.manifest_sha256) {
    throw new SaveError("template_hash_mismatch", "Document references a different pack version");
  }

  // 3. Canonicalize and hash the document
  const documentJson = input.document as unknown as Record<string, unknown>;
  const documentHash = sha256Hex(documentJson);

  // 4. Check for unchanged save — same hash, same revision
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

  // 5. Reject stale revisions
  if (currentRevision && input.expectedRevision !== currentRevision.revision_number) {
    throw new SaveError("stale_revision", `Expected revision ${input.expectedRevision}, current is ${currentRevision.revision_number}`);
  }

  const nextRevision = (currentRevision?.revision_number ?? 0) + 1;

  // 6. Render Feed and Story (deferred to render service in real impl)
  const feedResult = await renderPlacementSafe(templatePack, input, "feed");
  const storyResult = await renderPlacementSafe(templatePack, input, "story");

  // 7. Atomic transaction: insert revision + render attempts + advance active
  const { data: revision, error } = await input.supabase
    .from("ad_revisions")
    .insert({
      ad_id: input.adId,
      workspace_id: input.workspaceId,
      revision_number: nextRevision,
      document_json: documentJson,
      document_hash: documentHash,
      feed_png_hash: feedResult.hash,
      feed_png_path: feedResult.path,
      story_png_hash: storyResult.hash,
      story_png_path: storyResult.path,
      template_hash: pack.manifest_sha256,
      renderer_version: templatePack.rendererVersion,
    })
    .select("id, revision_number")
    .single();

  if (error) throw new SaveError("revision_insert_failed", error.message);

  // Insert render attempts
  await input.supabase.from("ad_render_attempts").insert([
    {
      revision_id: revision.id,
      workspace_id: input.workspaceId,
      placement: "feed",
      png_hash: feedResult.hash,
      png_path: feedResult.path,
      renderer_version: templatePack.rendererVersion,
    },
    {
      revision_id: revision.id,
      workspace_id: input.workspaceId,
      placement: "story",
      png_hash: storyResult.hash,
      png_path: storyResult.path,
      renderer_version: templatePack.rendererVersion,
    },
  ]);

  // Advance active revision
  await input.supabase
    .from("ad_customer_ads")
    .update({ active_revision_id: revision.id, updated_at: new Date().toISOString() })
    .eq("id", input.adId);

  return {
    adId: input.adId,
    revisionId: revision!.id,
    revisionNumber: revision!.revision_number,
    feedPngHash: feedResult.hash,
    storyPngHash: storyResult.hash,
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

interface RenderOutput {
  hash: string;
  path: string;
}

async function renderPlacementSafe(
  pack: TemplatePack,
  input: SaveAdInput,
  placement: "feed" | "story",
): Promise<RenderOutput> {
  let sha256: string;

  if (input.renderPlacement) {
    // Test injection point — caller supplies the hash, no renderer import.
    const result = await input.renderPlacement(placement);
    sha256 = result.sha256;
  } else {
    // Production — full render via @blockwise/ad-deterministic-renderer.
    // Renders the pack with customer image/text values and colour map.
    const renderer = await import("../../../packages/ad-deterministic-renderer/src/renderer.js");
    const result = await renderer.renderPlacement(
      {
        pack,
        imageValues: input.imageValues,
        textValues: input.document.sharedTextValues,
        colourMap: input.colourMap,
      },
      placement,
    );
    sha256 = result.sha256;
  }

  // Upload to workspace-scoped temp storage
  const path = `${input.workspaceId}/adstudio/renders/${input.adId}/${placement}-${sha256}.png`;

  return { hash: sha256, path };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class SaveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
