import { notFound } from "next/navigation";
import Link from "next/link";

import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import {
  CustomerAdNotFoundError,
  getOrCreateCustomerAd,
  parseCustomerAdId,
} from "@/lib/adstudio/create-customer-ad";
import { resolveAdvertiserDomain } from "@/lib/adstudio/advertiser-domain";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { isExampleBrandKitSourceUrl, rowToBrandKit } from "@/lib/adstudio/persistence";
import type { AdStudioBrandKit } from "@/lib/adstudio/types";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Ad Studio — layered editor for one direct template.
// Feed/Story tabs, layer list and canvas come from the existing EditorShell.
// A Library deep link opens its exact saved ad. Opening a template directly
// resumes the latest matching ad or creates the row the Save button persists.
// ---------------------------------------------------------------------------

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams?: SearchParams;
}) {
  const { templateId } = await params;
  const query = searchParams ? await searchParams : {};
  const requestedAdId = parseCustomerAdId(query.adId);
  if (query.adId !== undefined && !requestedAdId) notFound();

  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  const template = await getTemplate(supabase, templateId);
  if (!template) notFound();

  let adRef: Awaited<ReturnType<typeof getOrCreateCustomerAd>>;
  try {
    adRef = await getOrCreateCustomerAd(supabase, access.workspaceId, template, { adId: requestedAdId });
  } catch (error) {
    if (error instanceof CustomerAdNotFoundError) notFound();
    throw error;
  }

  // Brand Pack colours for the template-vs-brand toggle: the workspace's
  // latest non-demo kit, loaded server-side (same pattern as /ad-studio/brand).
  // Null → toggle disabled, editor stays on the template palette.
  const brandKit = await loadLatestBrandKit(supabase, access.workspaceId);

  return (
    <div className="flex h-[calc(100dvh-54px)] min-h-0 flex-col overflow-hidden bg-background text-foreground md:h-[calc(100dvh-64px)]">
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
          {template.metadata.title || template.templateId}
          <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">
          </span>
        </span>
        <Link
          href="/ad-studio/library"
          className="ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Library
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <EditorShell
          pack={template}
          adId={adRef.adId}
          workspaceId={access.workspaceId}
          canSave={true}
          brandColours={brandKit?.colours ?? null}
          brandPreview={brandKit ? {
            businessName: brandKit.identity.businessName || "Your business",
            displayDomain: resolveAdvertiserDomain({ brandKit }).host,
            logoUrl: brandKit.logos.primaryLogoUrl,
          } : null}
          initialDocument={adRef.initialDocument}
          initialRevision={adRef.revisionNumber}
        />
      </div>
    </div>
  );
}

/** Latest non-demo Brand Pack colours for a workspace, or null when none. */
async function loadLatestBrandKit(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>>,
  workspaceId: string,
): Promise<AdStudioBrandKit | null> {
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

    return rowToBrandKit(row);
  } catch {
    return null;
  }
}
