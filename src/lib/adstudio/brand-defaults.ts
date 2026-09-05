import { isExampleBrandKitSourceUrl, rowToBrandKit } from "./persistence";
import type { SupabaseClient } from "@supabase/supabase-js";
export async function loadAdStudioBrandDefaults(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase.from("adstudio_brand_kits").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(10);
  if (error) throw new Error(`Failed to load brand defaults: ${error.message}`);
  const row = (data ?? []).find(r => !isExampleBrandKitSourceUrl(String(r.source_url ?? "")));
  if (!row) return { colours: null, businessName: "", logoUrl: null, voice: "" };
  const kit = rowToBrandKit(row);
  return { colours: kit.colours, businessName: kit.identity.businessName, logoUrl: kit.logos.primaryLogoUrl, voice: kit.tone.voice };
}
