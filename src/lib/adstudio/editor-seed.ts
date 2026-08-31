import type { SupabaseClient } from "@supabase/supabase-js";
import { adDocumentSchema } from "../../../packages/ad-template-pack-contract/src/schema";
import type { ColourRole } from "../../../packages/ad-template-pack-contract/src/types";
import type { SavedEditorSeed } from "@/components/adstudio/editor/use-editor-state";

// ---------------------------------------------------------------------------
// Editor seed — restores the LAST SAVED revision into the editor when a
// customer reopens an existing ad.
//
// Outcomes are explicit:
//   - null                      → genuinely new ad, fresh empty editor.
//   - { status: "ok", seed }    → saved document parsed; restore it verbatim.
//   - { status: "unparsable" }  → the saved revision EXISTS but cannot be
//     parsed. The saved data is PRESERVED UNCHANGED, saving is BLOCKED, and
//     the editor shows a recovery error — a blank editor must never be able
//     to overwrite a historical document it could not read.
// ---------------------------------------------------------------------------

export type LoadedAdSeed =
  | { status: "ok"; seed: SavedEditorSeed }
  | { status: "unparsable"; revisionNumber: number; revisionId: string };

export async function loadSavedAdSeed(
  supabase: SupabaseClient,
  workspaceId: string,
  adId: string,
): Promise<LoadedAdSeed | null> {
  let activeRevisionId: string | null = null;
  try {
    const { data: ad } = await supabase
      .from("ad_customer_ads")
      .select("active_revision_id")
      .eq("id", adId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    activeRevisionId = (ad as { active_revision_id?: string } | null)?.active_revision_id ?? null;
  } catch {
    return null; // lookup failed — treat as new rather than block the editor
  }
  if (!activeRevisionId) return null;

  const { data: revision } = await supabase
    .from("ad_revisions")
    .select("id, revision_number, document_json")
    .eq("id", activeRevisionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const row = revision as { id: string; revision_number: number; document_json: unknown } | null;
  if (!row?.document_json) return null;

  const parsed = adDocumentSchema.safeParse(row.document_json);
  if (!parsed.success) {
    // Recovery path: keep the stored document intact, block saving, log for
    // diagnosis. Never hand back a fresh editor seeded over this revision.
    console.error(
      JSON.stringify({
        event: "adstudio_saved_document_unparsable",
        workspaceId,
        adId,
        revisionId: row.id,
        revisionNumber: row.revision_number,
        issues: parsed.error.issues.slice(0, 5).map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }),
    );
    return { status: "unparsable", revisionNumber: row.revision_number, revisionId: row.id };
  }

  const document = parsed.data;
  return {
    status: "ok",
    seed: {
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
      lastSavedRevision: row.revision_number,
      brandBusinessName: document.brandBusinessName ?? null,
    },
  };
}
