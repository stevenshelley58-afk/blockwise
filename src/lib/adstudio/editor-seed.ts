import type { SupabaseClient } from "@supabase/supabase-js";
import { adDocumentSchema } from "../../../packages/ad-template-pack-contract/src/schema";
import type { ColourRole } from "../../../packages/ad-template-pack-contract/src/types";
import type { SavedEditorSeed } from "@/components/adstudio/editor/use-editor-state";

// ---------------------------------------------------------------------------
// Editor seed — restores the LAST SAVED revision into the editor when a
// customer reopens an existing ad. Parsing is migration-safe: an old or
// malformed document never crashes the editor — it simply starts empty and
// the customer's saved revision stays untouched until the next Save.
// ---------------------------------------------------------------------------

export async function loadSavedAdSeed(
  supabase: SupabaseClient,
  workspaceId: string,
  adId: string,
): Promise<SavedEditorSeed | null> {
  try {
    const { data: ad } = await supabase
      .from("ad_customer_ads")
      .select("active_revision_id")
      .eq("id", adId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const activeRevisionId = (ad as { active_revision_id?: string } | null)?.active_revision_id;
    if (!activeRevisionId) return null;

    const { data: revision } = await supabase
      .from("ad_revisions")
      .select("revision_number, document_json")
      .eq("id", activeRevisionId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!revision?.document_json) return null;

    const parsed = adDocumentSchema.safeParse(revision.document_json);
    if (!parsed.success) return null; // migration-safe: old docs degrade to a fresh editor

    const document = parsed.data;
    return {
      textValues: { ...document.sharedTextValues },
      metaCopy: {
        primaryText: document.metaPrimaryText,
        headline: document.metaHeadline,
        description: document.metaDescription,
        cta: document.metaCta,
      },
      colourMode: document.colourMode,
      // Saved documents always carry the full role map (the editor writes all
      // six roles); the zod record type is just structurally partial.
      resolvedColourMap: document.resolvedColourMap as Record<ColourRole, string>,
      lastSavedRevision: revision.revision_number,
    };
  } catch {
    return null;
  }
}
