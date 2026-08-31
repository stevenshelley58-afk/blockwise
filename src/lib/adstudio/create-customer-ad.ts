import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdTemplate } from "../../../packages/ad-template-contract/src/types";
import { adDocumentSchema, type AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";

// ---------------------------------------------------------------------------
// Customer ad rows (ad_customer_ads) — created server-side so the editor has
// an adId to Save against. One ad per (workspace, direct template): opening a
// template reuses the existing row (idempotent), so re-saves keep revision history.
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
  /** The revision row that could not be parsed (for logs and recovery UI). */
  readonly revisionId: string | null;
  /** Human-readable zod issues, safe to show in the recovery screen. */
  readonly issues: string[];

  constructor(revisionId: string | null = null, issues: string[] = []) {
    super("The saved ad revision is invalid and cannot be loaded safely.");
    this.name = "InvalidActiveRevisionError";
    this.revisionId = revisionId;
    this.issues = issues;
  }
}

export async function getOrCreateCustomerAd(
  supabase: SupabaseClient,
  workspaceId: string,
  pack: AdTemplate,
): Promise<CustomerAdRef> {
  const { data: existing, error: existingError } = await supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id")
    .eq("workspace_id", workspaceId)
    .eq("template_id", pack.templateId)
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
    // and overwrite the user's saved content on the next save. The revision ID
    // and validation issues are logged for recovery support.
    if (!revision) {
      console.error("[adstudio] active revision row missing for ad", {
        adId: existingRow.id,
        revisionId: existingRow.active_revision_id,
      });
      throw new InvalidActiveRevisionError(existingRow.active_revision_id, ["The saved revision row could not be loaded."]);
    }
    const parsedRevision = adDocumentSchema.safeParse(revision.document_json);
    if (!parsedRevision.success) {
      const issues = parsedRevision.error.issues.map(issue => `${issue.path.join(".") || "(document)"}: ${issue.message}`);
      console.error("[adstudio] saved ad revision failed document validation", {
        adId: existingRow.id,
        revisionId: existingRow.active_revision_id,
        revisionNumber: revision.revision_number,
        issues,
      });
      throw new InvalidActiveRevisionError(existingRow.active_revision_id, issues);
    }
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
      template_id: pack.templateId,
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

/**
 * Explicit recovery action: detach the damaged revision as the ad's ACTIVE
 * revision so the editor can open with a fresh document. The revision row
 * itself is NOT deleted — it stays in ad_revisions for support recovery.
 */
export async function detachActiveRevision(revisionId: string): Promise<void> {
  if (!revisionId) throw new Error("A revision ID is required to detach a damaged revision.");
  const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
  const service = createSupabaseServiceClient();
  const { error } = await service
    .from("ad_customer_ads")
    .update({ active_revision_id: null })
    .eq("active_revision_id", revisionId);
  if (error) throw new Error(`Failed to detach the damaged revision: ${error.message}`);
}
