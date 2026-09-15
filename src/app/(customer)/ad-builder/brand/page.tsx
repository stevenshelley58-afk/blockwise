import { BrandStudio } from "@/components/adbuilder/brand-studio";
import { applyBrandAssetRows, loadAdBuilderBrandAssetRows } from "@/lib/adbuilder/assets";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adbuilder/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function safeAdBuilderReturnTo(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return "/ad-builder";

  try {
    const parsed = new URL(candidate, "https://blockwise.local");
    if (parsed.origin !== "https://blockwise.local" || parsed.pathname !== "/ad-builder") return "/ad-builder";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/ad-builder";
  }
}

export default async function BrandStudioPage({ searchParams }: { searchParams?: SearchParams }) {
  const params = searchParams ? await searchParams : {};
  const { supabase, access } = await requirePageSurfaceAccess("adbuilder");
  const brandKit = await loadLatestBrandKit(supabase, access.workspaceId);

  return <BrandStudio brandKit={brandKit} returnTo={safeAdBuilderReturnTo(params.returnTo)} />;
}

async function loadLatestBrandKit(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
) {
  try {
    const { data } = await supabase
      .from("adbuilder_brand_kits")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(10);

    const nonDemoRows = (data ?? []).filter((row) => !isExampleBrandKitSourceUrl(String(row.source_url ?? "")));
    const row = nonDemoRows.find((candidate) => String(candidate.source_url ?? "").trim()) ?? nonDemoRows[0];
    if (!row) return null;

    return applyBrandAssetRows(
      rowToBrandKit(row),
      await loadAdBuilderBrandAssetRows(supabase, workspaceId, String(row.id)),
    );
  } catch {
    return null;
  }
}
