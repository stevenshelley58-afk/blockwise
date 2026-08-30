import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdTemplate } from "../../../packages/ad-template-contract/src/types";
import { adDocumentSchema, type AdDocumentParsed } from "../../../packages/ad-template-contract/src/schema.ts";

// ---------------------------------------------------------------------------
// Customer ad rows (ad_customer_ads) — created server-side so the editor has
// an adId to Save against. A workspace can have several saved ads from the same
// direct template, so Library deep links select an exact row while a plain
// template open resumes the most recently updated row.
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

/** A requested Library ad must never silently fall back to a different ad. */
export class CustomerAdNotFoundError extends Error {
  readonly code = "customer_ad_not_found" as const;

  constructor() {
    super("The saved ad could not be found.");
    this.name = "CustomerAdNotFoundError";
  }
}

export function parseCustomerAdId(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!candidate) return null;
  const normalized = candidate.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

export async function getOrCreateCustomerAd(
  supabase: SupabaseClient,
  workspaceId: string,
  template: AdTemplate,
  options: { adId?: string | null } = {},
): Promise<CustomerAdRef> {
  const hasRequestedAdId = options.adId !== undefined && options.adId !== null;
  const requestedAdId = hasRequestedAdId ? parseCustomerAdId(options.adId ?? undefined) : null;
  if (hasRequestedAdId && !requestedAdId) throw new CustomerAdNotFoundError();

  let existingQuery = supabase
    .from("ad_customer_ads")
    .select("id, active_revision_id")
    .eq("workspace_id", workspaceId)
    .eq("template_id", template.templateId);
  existingQuery = requestedAdId
    ? existingQuery.eq("id", requestedAdId)
    : existingQuery
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    throw new Error(`Failed to load customer ad: ${existingError.message}`);
  }
  if (requestedAdId && !existing) throw new CustomerAdNotFoundError();

  if (existing) {
    const existingRow = existing as { id: string; active_revision_id?: string | null };
    if (!existingRow.active_revision_id) return { adId: existingRow.id, workspaceId };
    const { data: revision, error: revisionError } = await supabase
      .from("ad_revisions")
      .select("document_json, revision_number")
      .eq("id", existingRow.active_revision_id)
      .eq("workspace_id", workspaceId)
      .eq("ad_id", existingRow.id)
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
      template_id: template.templateId,
      colour_mode: "template",
      resolved_colour_map: template.semanticColours,
    })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(error?.message ?? "Failed to create customer ad");
  }

  return { adId: (created as { id: string }).id, workspaceId };
}
