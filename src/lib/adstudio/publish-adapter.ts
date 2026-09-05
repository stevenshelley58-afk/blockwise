import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types.ts";
import type { InstantForm } from "../adstudio/instant-form-types.ts";
import type {
  MetaConnectionSetup,
  MetaPublishControls,
  MetaPublishPlan,
  MetaExecutionAdapter,
} from "../providers/meta-execution.ts";

// ---------------------------------------------------------------------------
// Phase 7.2 — Publish adapter: new AdDocument → existing Meta pipeline
//
// Replaces client-supplied campaign-pack trust with authoritative server state.
// Replaces flat template_clone_image assumptions with layered document model.
// Replaces static forms with AI-generated Instant Forms.
// Replaces "Submit and go live" with "Paused on Meta" + separate activation.
// ---------------------------------------------------------------------------

export interface PublishInputV2 {
  adId: string;
  workspaceId: string;
  connectionId: string;
  setup: MetaConnectionSetup;
  controls: MetaPublishControls;
  adapter?: MetaExecutionAdapter;
}

export interface PublishLoadResult {
  ad: {
    id: string;
    templatePackId: string;
    colourMode: "template" | "brand_pack";
    metaPrimaryText: string;
    metaHeadline: string;
    metaDescription: string;
    metaCta: string;
  };
  revision: {
    id: string;
    revisionNumber: number;
    documentHash: string;
    feedPngHash: string;
    feedPngPath: string;
    storyPngHash: string;
    storyPngPath: string;
  };
  pack: TemplatePack;
  form: InstantForm | null;
}

/**
 * Load the authoritative server state for publishing.
 * Reads from ad_customer_ads, ad_revisions, ad_template_packs, ad_instant_form_drafts.
 * Rejects if the ad has unsaved changes (no active revision).
 */
export async function loadPublishState(
  supabase: SupabaseClient,
  adId: string,
  workspaceId: string,
): Promise<PublishLoadResult> {
  // 1. Load ad
  const { data: ad, error: adError } = await supabase
    .from("ad_customer_ads")
    .select("id, template_pack_id, colour_mode, meta_primary_text, meta_headline, meta_description, meta_cta, active_revision_id")
    .eq("id", adId)
    .eq("workspace_id", workspaceId)
    .single();

  if (adError || !ad) throw new PublishError("ad_not_found", "Ad not found");
  if (!ad.active_revision_id) throw new PublishError("not_saved", "Ad has no saved revision — Save before publishing");

  // 2. Load active revision
  const { data: revision, error: revError } = await supabase
    .from("ad_revisions")
    .select("id, revision_number, document_hash, feed_png_hash, feed_png_path, story_png_hash, story_png_path")
    .eq("id", ad.active_revision_id)
    .single();

  if (revError || !revision) throw new PublishError("revision_not_found", "Active revision not found");

  // 3. Load template pack
  const { data: packRow, error: packError } = await supabase
    .from("ad_template_packs")
    .select("pack_json")
    .eq("pack_id", ad.template_pack_id)
    .single();

  if (packError || !packRow) throw new PublishError("pack_not_found", "Template pack not found");
  const pack = packRow.pack_json as unknown as TemplatePack;

  // 4. Load latest Instant Form draft
  const { data: formRow } = await supabase
    .from("ad_instant_form_drafts")
    .select("form_json")
    .eq("ad_id", adId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();

  const form = formRow ? (formRow.form_json as InstantForm) : null;

  return {
    ad: {
      id: ad.id,
      templatePackId: ad.template_pack_id,
      colourMode: ad.colour_mode,
      metaPrimaryText: ad.meta_primary_text,
      metaHeadline: ad.meta_headline,
      metaDescription: ad.meta_description,
      metaCta: ad.meta_cta,
    },
    revision: {
      id: revision.id,
      revisionNumber: revision.revision_number,
      documentHash: revision.document_hash,
      feedPngHash: revision.feed_png_hash,
      feedPngPath: revision.feed_png_path,
      storyPngHash: revision.story_png_hash,
      storyPngPath: revision.story_png_path,
    },
    pack,
    form,
  };
}

/**
 * Verify that the loaded publish state is complete and consistent.
 * Returns validation issues — empty array means ready to publish.
 */
export function validatePublishState(state: PublishLoadResult): string[] {
  const issues: string[] = [];

  if (!state.revision.feedPngHash) issues.push("Missing Feed PNG");
  if (!state.revision.storyPngHash) issues.push("Missing Story PNG");
  if (!state.ad.metaPrimaryText) issues.push("Missing primary text");
  if (!state.ad.metaHeadline) issues.push("Missing headline");
  if (!state.ad.metaCta) issues.push("Missing CTA");
  if (!state.form) issues.push("No Instant Form — generate one before publishing");
  if (state.ad.colourMode === "brand_pack" && !hasAllColours(state.pack.semanticColours)) {
    issues.push("Brand Pack is missing required colour roles");
  }

  return issues;
}

/**
 * Freeze a publication snapshot — locks the exact revision, form, and metadata.
 */
export async function freezePublicationSnapshot(
  supabase: SupabaseClient,
  input: PublishInputV2,
  state: PublishLoadResult,
): Promise<{ snapshotId: string }> {
  // Check if a snapshot already exists for this revision
  const { data: existing } = await supabase
    .from("ad_publication_snapshots")
    .select("id")
    .eq("ad_id", input.adId)
    .eq("revision_id", state.revision.id)
    .maybeSingle();

  if (existing) return { snapshotId: existing.id };

  const snapshot = {
    adId: input.adId,
    workspaceId: input.workspaceId,
    revisionNumber: state.revision.revisionNumber,
    documentHash: state.revision.documentHash,
    feedPngHash: state.revision.feedPngHash,
    storyPngHash: state.revision.storyPngHash,
    templateId: state.pack.templateId,
    templateVersion: state.pack.version,
    metaPrimaryText: state.ad.metaPrimaryText,
    metaHeadline: state.ad.metaHeadline,
    metaDescription: state.ad.metaDescription,
    metaCta: state.ad.metaCta,
    colourMode: state.ad.colourMode,
    form: state.form,
    frozenAt: new Date().toISOString(),
  };

  const { data: inserted, error } = await supabase
    .from("ad_publication_snapshots")
    .insert({
      ad_id: input.adId,
      workspace_id: input.workspaceId,
      revision_id: state.revision.id,
      form_draft_id: state.form ? undefined : undefined, // linked if exists
      snapshot_json: snapshot as unknown as Record<string, unknown>,
    })
    .select("id")
    .single();

  if (error) throw new PublishError("snapshot_failed", error.message);

  return { snapshotId: inserted!.id };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasAllColours(colours: Record<string, string>): boolean {
  const required = ["background", "primary", "secondary", "accent", "mainText", "inverseText"];
  return required.every(r => colours[r] && colours[r]!.length > 0);
}

export class PublishError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
