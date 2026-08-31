import { notFound } from "next/navigation";

import { EditorShell, type EditorBrandPack, type EditorLibrary } from "@/components/adstudio/editor/editor-shell";
import { getOrCreateCustomerAd } from "@/lib/adstudio/create-customer-ad";
import { loadSavedAdSeed } from "@/lib/adstudio/editor-seed";
import { getImportedPack } from "@/lib/adstudio/pack-gallery";
import { loadAdStudioLibraryPage } from "@/lib/adstudio/library-read-model";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — layered editor for one imported template pack.
// Feed/Story tabs, live Meta previews and the Creative / Ad copy / Colours
// tabs come from the existing EditorShell. Opening a pack server-side creates
// (idempotently) the customer ad row the Save button persists against; the
// LAST SAVED revision is restored into the editor so saved customer copy is
// never erased on reopen. New ads start with empty placeholders.
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

  const { adId } = await getOrCreateCustomerAd(supabase, access.workspaceId, pack);

  // Saved revision for an EXISTING ad — restores copy, assets and colour
  // mode. Null for a brand new ad (empty placeholders + template suggestions).
  // An unparsable saved revision blocks saving (recovery mode) instead of
  // silently starting fresh over the customer's history.
  const saved = await loadSavedAdSeed(supabase, access.workspaceId, adId);
  const savedSeed = saved?.status === "ok" ? saved.seed : null;
  const savedUnparsable = saved?.status === "unparsable";

  // Brand Pack for the Colours tab and the Meta previews (avatar, business
  // name, palette): the workspace's latest non-demo kit, loaded server-side
  // (same pattern as /ad-studio/brand). Null → Brand Pack mode disabled.
  const brandPack = await loadLatestBrandPack(supabase, access.workspaceId);

  // Workspace asset library (Brand-Studio uploads) offered as creative
  // sources; newest first, small page so the editor payload stays light.
  let library: EditorLibrary = { brandKitId: null, assets: [] };
  try {
    const page = await loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "assets", limit: 24 });
    library = {
      brandKitId: brandPack?.brandKitId ?? null,
      assets: page.items
        .filter((item): item is Extract<typeof item, { id: string }> => "id" in item)
        .map((item) => ({ id: item.id, src: item.src, label: item.label })),
    };
  } catch {
    // Library is optional — the editor works with direct uploads alone.
  }

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
          adId={adId}
          workspaceId={access.workspaceId}
          canSave={true}
          brandPack={brandPack}
          savedSeed={savedSeed}
          savedUnparsable={savedUnparsable}
          library={library}
        />
      </div>
    </main>
  );
}

/**
 * Latest non-demo Brand Pack for a workspace (colours, business name, logo),
 * or null when none. Logo/business defaults feed the Meta previews; sensible
 * initials apply when no logo exists (handled by the preview component).
 */
async function loadLatestBrandPack(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<EditorBrandPack | null> {
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

    const kit = rowToBrandKit(row);
    return {
      brandKitId: kit.brandKitId,
      colours: kit.colours,
      businessName: kit.identity.businessName?.trim() || "",
      logoUrl: kit.logos.primaryLogoUrl,
    };
  } catch {
    return null;
  }
}
