import { notFound } from "next/navigation";

import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import { getImportedPack } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — layered editor for one imported template pack.
// Feed/Story tabs, layer list and canvas come from the existing EditorShell.
// Save/Publish are not wired yet (Save button is disabled via canSave=false).
// ---------------------------------------------------------------------------

export default async function PackEditorPage({
  params,
}: {
  params: Promise<{ packId: string }>;
}) {
  const { packId } = await params;
  const { supabase } = await requirePageSurfaceAccess("adstudio");
  const pack = await getImportedPack(supabase, packId);
  if (!pack) notFound();

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
        <EditorShell pack={pack} canSave={false} />
      </div>
    </main>
  );
}
