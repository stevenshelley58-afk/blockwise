import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types";
import { adDocumentSchema, type AdDocumentParsed } from "../../../packages/ad-template-pack-contract/src/schema.ts";

// ---------------------------------------------------------------------------
// Customer ad rows (ad_customer_ads) — created server-side so the editor has
// an adId to Save against. One ad per (workspace, template pack): opening a
// pack reuses the existing row (idempotent), so re-saves keep revision history.
// ---------------------------------------------------------------------------

export interface CustomerAdRef {
  adId: string;
  workspaceId: string;
  initialDocument?: AdDocumentParsed;
  revisionNumber?: number;
}

/** A saved revision is user data; never replace it with a blank document. */
export class InvalidActiveRevisionError extends Error {
  readonly code = "invalid_active_revision" as const;

  constructor() {
    super("The saved ad revision is invalid and cannot be loaded safely.");
    this.name = "InvalidActiveRevisionError";
  }
}

export async function getOrCreateCustomerAd(
  supabase: SupabaseClient,
  workspaceId: string,
  pack: TemplatePack,
): Promise<CustomerAdRef> {
  const { data: existing, error: existingError } = await supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id")
    .eq("workspace_id", workspaceId)
    .eq("template_pack_id", pack.packId)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Failed to load customer ad: ${existingError.message}`);
  }

  if (existing) {
    const existingRow = existing as { id: string; active_revision_id?: string | null };
    if (!existingRow.active_revision_id) return { adId: existingRow.id, workspaceId };
    const { data: revision, error: revisionError } = await supabase
      .from("ad_revisions")
      .select("document_json, revision_number")
      .eq("id", existingRow.active_revision_id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (revisionError) {
      throw new Error(`Failed to load saved ad revision: ${revisionError.message}`);
    }
    // An active revision is authoritative user data. If it is absent or fails
    // validation, fail closed so the editor cannot silently hydrate defaults
    // and overwrite the user's saved content on the next save.
    if (!revision) throw new InvalidActiveRevisionError();
    const parsedRevision = adDocumentSchema.safeParse(revision.document_json);
    if (!parsedRevision.success) throw new InvalidActiveRevisionError();
    return {
      adId: existingRow.id,
      workspaceId,
      initialDocument: parsedRevision.data as AdDocumentParsed,
      revisionNumber: revision.revision_number as number | undefined,
    };
  }

  const { data: created, error } = await supabase
    .from("ad_customer_ads")
    .insert({
      workspace_id: workspaceId,
      template_pack_id: pack.packId,
      template_id: pack.templateId,
      template_version: pack.version,
      colour_mode: "template",
      resolved_colour_map: pack.semanticColours,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create customer ad");
  }

  return { adId: (created as { id: string }).id, workspaceId };
}
