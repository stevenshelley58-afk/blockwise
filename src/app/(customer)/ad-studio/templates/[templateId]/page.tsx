import { notFound } from "next/navigation";
import Link from "next/link";

import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import { getOrCreateCustomerAd, InvalidActiveRevisionError } from "@/lib/adstudio/create-customer-ad";
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

  let adRef;
  try {
    adRef = await getOrCreateCustomerAd(supabase, access.workspaceId, pack);
  } catch (error) {
    // A saved revision that cannot be parsed is preserved UNCHANGED: the
    // editor never opens, saving is impossible, and the customer gets an
    // explicit recovery path. Only genuinely new ads get a fresh document.
    if (error instanceof InvalidActiveRevisionError) {
      return (
        <RecoveryScreen
          templateId={templateId}
          templateTitle={pack.metadata.title || pack.templateId}
          revisionId={error.revisionId}
          issues={error.issues}
        />
      );
    }
    throw error;
  }

  // Brand Pack defaults for the editor: colours for the template/workspace/
  // custom colour modes, the business name as the default display name for
  // Meta previews, and Brand Studio uploads as the per-slot asset library.
  // Null → workspace mode disabled, editor stays on the template palette.
  const brandPack = await loadLatestBrandPack(supabase, access.workspaceId);

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
          brandColours={brandPack?.colours ?? null}
          brandBusinessName={brandPack?.businessName ?? ""}
          brandLogoUrl={brandPack?.logoUrl ?? null}
          libraryAssets={brandPack?.libraryAssets ?? []}
          initialDocument={adRef.initialDocument}
          initialRevision={adRef.revisionNumber}
        />
      </div>
    </div>
  );
}

/** The workspace's latest non-demo Brand Pack, or null when none exists. */
async function loadLatestBrandPack(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<{
  colours: AdStudioBrandKit["colours"];
  businessName: string;
  libraryAssets: Array<{ url: string; label: string }>;
  logoUrl: string | null;
} | null> {
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
    const library = [
      ...(kit.logos.primaryLogoUrl ? [{ url: kit.logos.primaryLogoUrl, label: "Primary logo" }] : []),
      ...kit.assets.headshots.map(url => ({ url, label: "Headshot" })),
      ...kit.assets.officeImages.map(url => ({ url, label: "Office image" })),
      ...kit.assets.listingImages.map(url => ({ url, label: "Listing image" })),
      ...kit.assets.socialProofImages.map(url => ({ url, label: "Social proof image" })),
    ];
    const seen = new Set<string>();
    const libraryAssets = library.filter(asset => {
      if (seen.has(asset.url)) return false;
      seen.add(asset.url);
      return true;
    });
    return { colours: kit.colours, businessName: kit.identity.businessName, logoUrl: kit.logos.primaryLogoUrl, libraryAssets };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recovery — a saved revision that cannot be parsed is preserved untouched.
// The editor does not open (nothing can silently overwrite the document) and
// the customer sees the revision ID plus a single explicit recovery action:
// detaching the damaged revision as the ACTIVE one. The revision row itself
// stays in ad_revisions for support; nothing is deleted.
// ---------------------------------------------------------------------------

async function detachDamagedRevision(formData: FormData) {
  "use server";
  const { detachActiveRevision } = await import("@/lib/adstudio/create-customer-ad");
  const revisionId = String(formData.get("revisionId") ?? "");
  await detachActiveRevision(revisionId);
}

function RecoveryScreen({
  templateId,
  templateTitle,
  revisionId,
  issues,
}: {
  templateId: string;
  templateTitle: string;
  revisionId: string | null;
  issues: string[];
}) {
  return (
    <div className="flex min-h-[calc(100dvh-54px)] flex-col bg-background text-foreground md:min-h-[calc(100dvh-60px)]">
      <header className="flex min-h-12 shrink-0 items-center border-b border-border bg-card px-4 md:px-5">
        <Link
          href="/ad-studio"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M8.5 3.5 5 7l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All templates
        </Link>
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-(--r-card) border border-red-200 bg-red-50 p-6" role="alert" data-testid="editor-recovery-screen">
          <h1 className="mb-2 text-base font-semibold text-red-900">We couldn&apos;t open your saved ad</h1>
          <p className="text-sm leading-relaxed text-red-800">
            Your saved version of <span className="font-medium">{templateTitle}</span> is still stored
            exactly as you left it — nothing was changed or deleted. But it can&apos;t be opened in the
            editor right now, and saving over it is blocked until it&apos;s recovered.
          </p>
          {revisionId ? (
            <p className="mt-3 rounded-(--r-ctl) bg-white/60 px-3 py-2 font-mono text-xs text-red-900">
              Saved version: {revisionId}
            </p>
          ) : null}
          {issues.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-red-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Technical details
              </summary>
              <ul className="mt-1 space-y-1">
                {issues.slice(0, 8).map((issue, i) => (
                  <li key={i} className="break-words font-mono text-[11px] text-red-800">• {issue}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-red-800">
            Contact support and quote the saved version above to restore your ad.
            If you prefer, you can detach this version and start the ad fresh — the
            original stays in your workspace history either way.
          </p>
          <form action={detachDamagedRevision} className="mt-4">
            <input type="hidden" name="revisionId" value={revisionId ?? ""} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full border border-red-300 bg-white px-5 py-2 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Detach this version and start fresh
            </button>
          </form>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Template: {templateId}
          </p>
        </div>
      </div>
    </div>
  );
}
