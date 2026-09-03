import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdTemplate } from "../../../packages/ad-template-contract/src/types";
import { adDocumentSchema, type AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";

// ---------------------------------------------------------------------------
// Customer ad rows (ad_customer_ads) — created only by an explicit action.
// A template is a starting point, not an identity: a workspace may create
// multiple intentional ads from the same template.
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

export async function createCustomerAd(
  supabase: SupabaseClient,
  workspaceId: string,
  pack: AdTemplate,
  idempotencyKey?: string,
): Promise<CustomerAdRef> {
  const { data: created, error } = await supabase
    .from("ad_customer_ads")
    .insert({
      workspace_id: workspaceId,
      template_id: pack.templateId,
      colour_mode: "template",
      resolved_colour_map: pack.semanticColours,
      creation_key: idempotencyKey ?? null,
    })
    .select("id")
    .single();

  if (error?.code === "23505" && idempotencyKey) {
    const { data: replay } = await supabase.from("ad_customer_ads").select("id").eq("workspace_id", workspaceId).eq("creation_key", idempotencyKey).single();
    if (replay) return { adId: String(replay.id), workspaceId };
  }
  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create customer ad");
  }

  return { adId: (created as { id: string }).id, workspaceId };
}

/** Load an existing ad and its active revision. This function is read-only. */
export async function loadCustomerAd(supabase: SupabaseClient, workspaceId: string, adId: string): Promise<CustomerAdRef & { templateId: string }> {
  const { data: ad, error } = await supabase.from("ad_customer_ads").select("id, template_id, active_revision_id").eq("id", adId).eq("workspace_id", workspaceId).maybeSingle();
  if (error || !ad) throw new Error(error?.message ?? "Ad not found");
  const row = ad as { id: string; template_id: string; active_revision_id?: string | null };
  if (!row.active_revision_id) return { adId: row.id, workspaceId, templateId: row.template_id };
  const { data: revision, error: revisionError } = await supabase.from("ad_revisions").select("document_json, revision_number").eq("id", row.active_revision_id).eq("workspace_id", workspaceId).maybeSingle();
  if (revisionError || !revision) throw new InvalidActiveRevisionError(row.active_revision_id, ["The saved revision row could not be loaded."]);
  const parsed = adDocumentSchema.safeParse(revision.document_json);
  if (!parsed.success) throw new InvalidActiveRevisionError(row.active_revision_id, parsed.error.issues.map(i => `${i.path.join(".") || "(document)"}: ${i.message}`));
  return { adId: row.id, workspaceId, templateId: row.template_id, initialDocument: parsed.data, revisionNumber: Number(revision.revision_number) };
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
