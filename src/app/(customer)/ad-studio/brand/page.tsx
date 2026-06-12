import { BrandStudio } from "@/components/adstudio/brand-studio";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function BrandStudioPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const liveBundle = await loadLiveAdStudioBundle(supabase, access.workspaceId);
  // B2 (simplification): an extracted-but-unapproved kit must be editable here —
  // previously unapproved users were shown the demo kit instead of their own.
  const draftBrandKit = liveBundle ? null : await loadDraftBrandKit(supabase, access.workspaceId);
  const brandKit = liveBundle?.brandKit ?? draftBrandKit;

  return <BrandStudio brandKit={brandKit} />;
}

async function loadDraftBrandKit(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
) {
  try {
    const { data } = await supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(10);

    const nonDemoRows = (data ?? []).filter((row) => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
    const row = nonDemoRows.find((candidate) => String(candidate.source_url ?? "").trim()) ?? nonDemoRows[0];
    if (!row) return null;

    return applyBrandAssetRows(
      rowToBrandKit(row),
      await loadAdStudioBrandAssetRows(supabase, workspaceId, String(row.id)),
    );
  } catch {
    return null;
  }
}
