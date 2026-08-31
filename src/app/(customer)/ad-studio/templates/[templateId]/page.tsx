import { notFound } from "next/navigation";
import Link from "next/link";

import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import { getOrCreateCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio/types";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — layered editor for one imported template.
// Feed/Story tabs, layer list and canvas come from the existing EditorShell.
// Opening a pack server-side creates (idempotently) the customer ad row the
// Save button persists against; Save renders Feed + Story PNGs via saveAd.
// ---------------------------------------------------------------------------

export default async function PackEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const pack = await getTemplate(supabase, templateId);
  if (!pack) notFound();

  const adRef = await getOrCreateCustomerAd(supabase, access.workspaceId, pack);

  // Brand Pack colours for the template-vs-brand toggle: the workspace's
  // latest non-demo kit, loaded server-side (same pattern as /ad-studio/brand).
  // Null → toggle disabled, editor stays on the template palette.
  const brandColours = await loadLatestBrandColours(supabase, access.workspaceId);

  return (
    <div className="flex min-h-[calc(100dvh-54px)] flex-col bg-background text-foreground md:min-h-[calc(100dvh-60px)]">
      <header className="flex min-h-12 shrink-0 items-center border-b border-border bg-card px-4 md:px-5">
        <Link
          href="/ad-studio"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        </Link>
        <span className="ml-4 truncate text-sm font-medium">
          {pack.metadata.title || pack.templateId}
          <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
          </span>
        </span>
      </header>
      <div className="min-h-0 flex-1 h-full">
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
    </div>
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
