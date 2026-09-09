import { VideoNewFlow } from "@/components/adstudio/video/video-new-flow";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import type { BrandSnapshot, VideoAsset } from "@/lib/adstudio/video/types";
import { assetUrlForRow, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function NewVideoPage() {
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const brandData = await loadApprovedBrandData(supabase, access.workspaceId);
  return <VideoNewFlow workspaceId={access.workspaceId} brandKitId={brandData.brandKitId} brandAssets={brandData.assets} brandSnapshot={brandData.snapshot} />;
}

async function loadApprovedBrandData(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<{ assets: VideoAsset[]; snapshot: BrandSnapshot; brandKitId?: string }> {
  try {
    const { data } = await supabase
      .from("adstudio_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("review_status", "approved")
      .order("updated_at", { ascending: false })
      .limit(1);
    const row = (data ?? []).find((candidate) => !isExampleBrandKitSourceUrl(String(candidate.source_url ?? "")));
    if (!row) return { assets: [], snapshot: {} };
    const brandKit = rowToBrandKit(row);
    const snapshot: BrandSnapshot = {
      businessName: brandKit.identity.businessName,
      primaryColour: brandKit.colours.primary,
      secondaryColour: brandKit.colours.secondary,
      voice: brandKit.tone.voice,
      logoAssetId: brandKit.logos.primaryLogoUrl ? `${brandKit.brandKitId}:primary-logo` : undefined,
    };
    const assets: VideoAsset[] = [];
    if (brandKit.logos.primaryLogoUrl) {
      assets.push({ id: `${brandKit.brandKitId}:primary-logo`, kind: "logo", url: brandKit.logos.primaryLogoUrl, alt: `${brandKit.identity.businessName} logo` });
    }
    for (const assetRow of await loadAdStudioBrandAssetRows(supabase, workspaceId, brandKit.brandKitId)) {
      const url = assetUrlForRow(workspaceId, assetRow) ?? "";
      if (!url) continue;
      const kind = String(assetRow.asset_type ?? "").toLowerCase();
      if (kind === "listing_image" || kind === "property_image") assets.push({ id: String(assetRow.id ?? url), kind: "photo", url });
      if (kind === "testimonial_image" || kind === "social_proof_image") assets.push({ id: String(assetRow.id ?? url), kind: "testimonial", url });
    }
    return { assets, snapshot, brandKitId: brandKit.brandKitId };
  } catch {
    return { assets: [], snapshot: {} };
  }
}
