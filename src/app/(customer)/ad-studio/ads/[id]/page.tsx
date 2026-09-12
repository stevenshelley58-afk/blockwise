import { notFound, redirect } from "next/navigation";
import { EditorShell } from "@/components/adstudio/editor/editor-shell";
import { TryVueEditorButton } from "@/components/adstudio/vue-editor/try-vue-editor-button";
import { readVueNativeEditor } from "@/components/adstudio/vue-editor/fabric-scene";
import { loadCustomerAd, InvalidActiveRevisionError, CustomerAdNotFoundError } from "@/lib/adstudio/create-customer-ad";
import { getTemplateForExistingCustomerAd } from "@/lib/adstudio/pack-gallery";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";
import { loadAdStudioBrandDefaults } from "@/lib/adstudio/brand-defaults";
import { loadAdStudioWorkspaceLibraryAssets } from "@/lib/adstudio/assets";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { loadNativeTrialIdentity } from "@/lib/adstudio/vue-native-copy";

export const dynamic = "force-dynamic";

/** Stable customer-ad editor URL. Reading an ad never creates or mutates data. */
export default async function CustomerAdEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ editor?: string }> }) {
  const { id } = await params;
  const { editor } = await searchParams;
  const { supabase, access } = await requirePageSurfaceAccess("adstudio");
  let ad;
  try { ad = await loadCustomerAd(supabase, access.workspaceId, id); }
  catch (error) {
    if (error instanceof CustomerAdNotFoundError) notFound();
    if (error instanceof InvalidActiveRevisionError) return <RecoveryScreen adId={id} revisionId={error.revisionId} issues={error.issues} />;
    throw error;
  }
  // A native scene can contain freeform objects the legacy document model cannot
  // represent. Never open it here, where a legacy save would discard that work.
  if (readVueNativeEditor(ad.initialDocument)) redirect(`/ad-studio/ads/${encodeURIComponent(ad.adId)}/canvas`);
  const nativeIdentity = await loadNativeTrialIdentity(supabase, access.workspaceId, ad.adId);
  if (nativeIdentity) redirect("/ad-studio/ads/" + encodeURIComponent(ad.adId) + "/canvas");
  if (editor !== "legacy") return <TryVueEditorButton adId={ad.adId} workspaceId={access.workspaceId} automatic />;
  const pack = await getTemplateForExistingCustomerAd({
    customerSupabase: supabase,
    internalSupabase: createSupabaseServiceClient(),
    workspaceId: access.workspaceId,
    adId: ad.adId,
    templateId: ad.templateId,
  });
  if (!pack) notFound();
  const [brand, libraryAssets] = await Promise.all([
    loadAdStudioBrandDefaults(supabase, access.workspaceId),
    loadAdStudioWorkspaceLibraryAssets(supabase, access.workspaceId),
  ]);
  return <div className="flex h-[calc(100dvh-54px-4.75rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)-var(--consent-banner-height,0px))] min-h-[200px] flex-col overflow-hidden bg-background text-foreground md:h-[calc(100dvh-60px)] md:min-h-[360px]">
    <TryVueEditorButton adId={ad.adId} workspaceId={access.workspaceId} />
    <div className="min-h-0 flex-1"><EditorShell pack={pack} adId={ad.adId} workspaceId={access.workspaceId} canSave brandColours={brand.colours} brandBusinessName={brand.businessName} brandLogoUrl={brand.logoUrl} libraryAssets={libraryAssets} initialDocument={ad.initialDocument} initialRevision={ad.revisionNumber} adName={ad.name} /></div>
  </div>;
}

function RecoveryScreen({ adId, revisionId, issues }: { adId: string; revisionId: string | null; issues: string[] }) {
  return <div className="h-full min-h-0 overflow-y-auto p-6"><div className="grid min-h-full place-items-center"><div role="alert" className="max-w-lg rounded-(--r-card) border border-(--ui-error)/25 bg-(--ui-error-soft) p-6 text-(--ui-error)"><h1 className="font-display text-[17px] font-extrabold">We couldn&apos;t open this saved ad</h1><p className="mt-2 text-sm">The saved revision is preserved and needs recovery. Contact support and provide ad ID <code>{adId}</code> and revision ID <code>{revisionId ?? "unknown"}</code>.</p>{issues.length > 0 ? <ul className="mt-3 list-disc pl-5 text-sm">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}</div></div></div>;
}
