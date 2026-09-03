import { notFound } from "next/navigation";
import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import { loadCustomerAd, InvalidActiveRevisionError, CustomerAdNotFoundError } from "@/lib/adstudio/create-customer-ad";
import { getTemplate } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadAdStudioBrandDefaults } from "@/lib/adstudio/brand-defaults";
import { loadAdStudioWorkspaceLibraryAssets } from "@/lib/adstudio/assets";

export const dynamic = "force-dynamic";

/** Stable customer-ad editor URL. Reading an ad never creates or mutates data. */
export default async function CustomerAdEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  let ad;
  try { ad = await loadCustomerAd(supabase, access.workspaceId, id); }
  catch (error) {
    if (error instanceof CustomerAdNotFoundError) notFound();
    if (error instanceof InvalidActiveRevisionError) return <RecoveryScreen adId={id} revisionId={error.revisionId} issues={error.issues} />;
    throw error;
  }
  const pack = await getTemplate(supabase, ad.templateId);
  if (!pack) notFound();
  const [brand, libraryAssets] = await Promise.all([
    loadAdStudioBrandDefaults(supabase, access.workspaceId),
    loadAdStudioWorkspaceLibraryAssets(supabase, access.workspaceId),
  ]);
  return <div className="flex min-h-[calc(100dvh-54px)] flex-col bg-background text-foreground md:min-h-[calc(100dvh-60px)]">
    <div className="min-h-0 flex-1"><EditorShell pack={pack} adId={ad.adId} workspaceId={access.workspaceId} canSave brandColours={brand.colours} brandBusinessName={brand.businessName} brandLogoUrl={brand.logoUrl} libraryAssets={libraryAssets} initialDocument={ad.initialDocument} initialRevision={ad.revisionNumber} adName={ad.name} /></div>
  </div>;
}

function RecoveryScreen({ adId, revisionId, issues }: { adId: string; revisionId: string | null; issues: string[] }) {
  return <div className="grid min-h-screen place-items-center p-6"><div role="alert" className="max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-red-900"><h1 className="font-semibold">We couldn&apos;t open this saved ad</h1><p className="mt-2 text-sm">The saved revision is preserved and needs recovery. Contact support and provide ad ID <code>{adId}</code> and revision ID <code>{revisionId ?? "unknown"}</code>.</p><ul className="mt-3 list-disc pl-5 text-sm">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div>;
}
