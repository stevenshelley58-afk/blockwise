import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdDocumentParsed } from "../../../packages/ad-template-pack-contract/src/schema";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types";
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
  renderPlacement?: (placement: "feed" | "story") => Promise<{ sha256: string; png?: Buffer }>;
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
  const { data: ad, error: adError } = await input.supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id, template_pack_id")
    .eq("id", input.adId)
    .eq("workspace_id", input.workspaceId)
    .single();

  if (adError || !ad) throw new SaveError("ad_not_found", "Ad not found");
  const expectedActiveRevisionId = ad.active_revision_id ?? null;

  const { data: pack, error: packError } = await input.supabase
    .from("ad_template_packs")
    .select("pack_json, manifest_sha256")
    .eq("pack_id", ad.template_pack_id)
    .single();

  if (packError || !pack) throw new SaveError("pack_not_found", "Template pack not found");

  const templatePack = pack.pack_json as unknown as TemplatePack;

  // 2. Validate document against pinned pack
  if (input.document.templateHash !== pack.manifest_sha256) {
    throw new SaveError("template_hash_mismatch", "Document references a different pack version");
  }
  if (
    input.document.templateId !== templatePack.templateId ||
    input.document.templateVersion !== templatePack.version ||
    input.document.rendererVersion !== templatePack.rendererVersion
  ) {
    throw new SaveError("template_contract_mismatch", "Document does not match the pinned template contract");
  }
  validateRequiredInputs(templatePack, input);

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
  if (!currentRevision && input.expectedRevision !== 0) {
    throw new SaveError("stale_revision", `Expected revision ${input.expectedRevision}, current is 0`);
  }

  const nextRevision = (currentRevision?.revision_number ?? 0) + 1;

  // 6. Render Feed and Story (deferred to render service in real impl)
  const feedResult = await renderPlacementSafe(templatePack, input, "feed");
  const storyResult = await renderPlacementSafe(templatePack, input, "story");

  await uploadRender(input, "feed", feedResult);
  await uploadRender(input, "story", storyResult);

  // 7. One PostgreSQL transaction inserts the revision and attempts, then
  // advances the active pointer while holding the customer-ad row lock.
  const { data: revisionData, error: revisionError } = await input.supabase.rpc("commit_ad_revision", {
    p_ad_id: input.adId,
    p_workspace_id: input.workspaceId,
    p_expected_active_revision_id: expectedActiveRevisionId,
    p_revision: {
      revision_number: nextRevision,
      document_json: documentJson,
      document_hash: documentHash,
      feed_png_hash: feedResult.hash,
      feed_png_path: feedResult.path,
      story_png_hash: storyResult.hash,
      story_png_path: storyResult.path,
      template_hash: pack.manifest_sha256,
      renderer_version: templatePack.rendererVersion,
    },
    p_attempts: [
      {
        placement: "feed",
        png_hash: feedResult.hash,
        png_path: feedResult.path,
        renderer_version: templatePack.rendererVersion,
      },
      {
        placement: "story",
        png_hash: storyResult.hash,
        png_path: storyResult.path,
        renderer_version: templatePack.rendererVersion,
      },
    ],
  });
  if (revisionError) {
    const message = revisionError.message ?? "Could not commit the ad revision";
    if (message.includes("stale_revision")) throw new SaveError("stale_revision", "This ad changed in another editor. Reload and try again.");
    if (message.includes("ad_not_found")) throw new SaveError("ad_not_found", "Ad not found");
    throw new SaveError("revision_commit_failed", message);
  }
  const revision = (Array.isArray(revisionData) ? revisionData[0] : revisionData) as {
    id?: unknown; revision_number?: unknown;
  } | null;
  if (!revision || typeof revision.id !== "string" || typeof revision.revision_number !== "number") {
    throw new SaveError("revision_commit_failed", "Transactional save returned an invalid revision");
  }

  return {
    adId: input.adId,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
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
  const { data, error } = await supabase
    .from("ad_revisions")
    .select("id, revision_number, document_hash, feed_png_hash, story_png_hash")
    .eq("id", revisionId)
    .maybeSingle();
  if (error || !data) throw new SaveError("active_revision_invalid", "The active saved revision could not be loaded");
  return data as any;
}

function validateRequiredInputs(pack: TemplatePack, input: SaveAdInput): void {
  for (const image of pack.imageInputs) {
    if (image.required === false) continue;
    const bytes = input.imageValues[image.key];
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new SaveError("image_required", `Add an image for ${image.label} before saving.`);
    }
  }

  for (const text of pack.textInputs) {
    const value = input.document.sharedTextValues[text.key];
    if (typeof value !== "string" || !value.trim()) {
      throw new SaveError("text_required", `Enter ${text.label} before saving.`);
    }
    if (value.length > text.maxLength) {
      throw new SaveError("text_too_long", `${text.label} must be ${text.maxLength} characters or fewer.`);
    }
  }
}

interface RenderOutput {
  hash: string;
  path: string;
  png?: Buffer;
}

async function renderPlacementSafe(
  pack: TemplatePack,
  input: SaveAdInput,
  placement: "feed" | "story",
): Promise<RenderOutput> {
  let sha256: string;
  let png: Buffer | undefined;

  if (input.renderPlacement) {
    // Test injection point — caller supplies the hash, no renderer import.
    const result = await input.renderPlacement(placement);
    sha256 = result.sha256;
    png = result.png;
  } else {
    // Production — full render via @blockwise/ad-deterministic-renderer.
    // Renders the pack with customer image/text values and colour map.
    const renderer = await import("../../../packages/ad-deterministic-renderer/src/renderer");
    const result = await renderer.renderPlacement(
      {
        pack,
        imageValues: input.imageValues,
        textValues: input.document.sharedTextValues,
        colourMap: input.colourMap,
        cropOverrides: placement === "feed" ? input.document.feedCropOverrides : input.document.storyCropOverrides,
      },
      placement,
    );
    sha256 = result.sha256;
    png = result.png;
  }

  // Upload to workspace-scoped temp storage
  const path = `${input.workspaceId}/adstudio/renders/${input.adId}/${placement}-${sha256}.png`;

  return { hash: sha256, path, png };
}

async function uploadRender(
  input: SaveAdInput,
  placement: "feed" | "story",
  render: RenderOutput,
): Promise<void> {
  if (!render.png) {
    throw new SaveError("render_bytes_missing", "The " + placement + " render did not return PNG bytes.");
  }
  const { error } = await input.supabase.storage
    .from("workspace-artifacts")
    .upload(render.path, render.png, { contentType: "image/png", upsert: false });
  if (!error) return;

  // Render paths are content-addressed. A create-only retry can therefore
  // treat an existing object as success only after downloading and verifying
  // its bytes, never by overwriting it or trusting the upload error alone.
  const existing = await input.supabase.storage.from("workspace-artifacts").download(render.path);
  if (!existing.error && existing.data) {
    const existingBytes = Buffer.from(await existing.data.arrayBuffer());
    const existingHash = createHash("sha256").update(existingBytes).digest("hex");
    if (existingHash === render.hash) return;
  }

  throw new SaveError("render_upload_failed", "Could not store the " + placement + " render: " + error.message);
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
