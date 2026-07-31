import { BrandStudio } from "@/components/adstudio/brand-studio";
import { applyBrandAssetRows, loadAdStudioBrandAssetRows } from "@/lib/adstudio/assets";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function safeAdStudioReturnTo(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return "/ad-studio";

  try {
    const parsed = new URL(candidate, "https://blockwise.local");
    if (parsed.origin !== "https://blockwise.local" || parsed.pathname !== "/ad-studio") return "/ad-studio";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/ad-studio";
  }
}

export default async function BrandStudioPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const brandKit = await loadLatestBrandKit(supabase, access.workspaceId);

  return <BrandStudio brandKit={brandKit} returnTo={safeAdStudioReturnTo(params.returnTo)} />;
}

async function loadLatestBrandKit(
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
