import type { SupabaseClient } from "@supabase/supabase-js";
import type { TemplatePack } from "../../../packages/ad-template-pack-contract/src/types.js";

// ---------------------------------------------------------------------------
// Customer ad rows (ad_customer_ads) — created server-side so the editor has
// an adId to Save against. One ad per (workspace, template pack): opening a
// pack reuses the existing row (idempotent), so re-saves keep revision history.
// ---------------------------------------------------------------------------

export interface CustomerAdRef {
  adId: string;
  workspaceId: string;
}

export async function getOrCreateCustomerAd(
  supabase: SupabaseClient,
  workspaceId: string,
  pack: TemplatePack,
): Promise<CustomerAdRef> {
  const { data: existing } = await supabase
    .from("ad_customer_ads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("template_pack_id", pack.packId)
    .maybeSingle();

  if (existing) {
    return { adId: (existing as { id: string }).id, workspaceId };
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
