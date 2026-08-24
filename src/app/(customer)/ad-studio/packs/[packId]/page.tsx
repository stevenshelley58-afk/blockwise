import { notFound } from "next/navigation";

import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import { getOrCreateCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getImportedPack } from "@/lib/adstudio/pack-gallery";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio/types";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — layered editor for one imported template pack.
// Feed/Story tabs, layer list and canvas come from the existing EditorShell.
// Opening a pack server-side creates (idempotently) the customer ad row the
// Save button persists against; Save renders Feed + Story PNGs via saveAd.
// Publish is not wired yet.
// ---------------------------------------------------------------------------

export default async function PackEditorPage({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const pack = await getImportedPack(supabase, packId);
  if (!pack) notFound();

  const adRef = await getOrCreateCustomerAd(supabase, access.workspaceId, pack);

  // Brand Pack colours for the template-vs-brand toggle: the workspace's
  // latest non-demo kit, loaded server-side (same pattern as /ad-studio/brand).
  // Null → toggle disabled, editor stays on the template palette.
  const brandColours = await loadLatestBrandColours(supabase, access.workspaceId);

  return (
    <main className="fixed inset-0 flex flex-col bg-(--canvas) text-foreground">
      <header className="flex h-12 shrink-0 items-center border-b border-(--line) bg-(--surface) px-5">
        <a
          href="/ad-studio"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M8.5 3.5 5 7l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          All templates
        </a>
        <span className="ml-4 truncate text-sm font-medium">
          {pack.classification.label || pack.templateId}
          <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
            v{pack.version}
          </span>
        </span>
      </header>
      <div className="min-h-0 flex-1">
        <EditorShell
          pack={pack}
          adId={adRef.adId}
          workspaceId={access.workspaceId}
          canSave={true}
          brandColours={brandColours}
          initialDocument={adRef.initialDocument}
          initialRevision={adRef.revisionNumber}
        />
      </div>
    </main>
  );
}

/** Latest non-demo Brand Pack colours for a workspace, or null when none. */
async function loadLatestBrandColours(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<AdStudioBrandKit["colours"] | null> {
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

    return rowToBrandKit(row).colours;
  } catch {
    return null;
  }
}
